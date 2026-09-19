import {packSurface} from './surface.js?v=1.3.0';
import {GRID, bedHeight, terrainHeight, WAVES, clamp, smooth} from './coast.js?v=1.3.0';

// A conservative staggered-grid shallow-water solver. Pressure gradients drive
// face velocities; donor-cell fluxes transport actual water volume. The outgoing
// volume limiter keeps cells positive at moving wet/dry boundaries. Persistent
// foam and material coordinates follow the same velocity field.
export class ShoreSimulation {
 constructor(config=GRID) {
  this.g=config; const {nx,nz,dx,dz,x0,z0}=config; const n=nx*nz;
  this.n=n;this.time=0;this.steps=0;
  this.state={strength:1,wind:0,tide:0};this.target={...this.state};
  for(const name of ['bed','sand','h','next','u','v','fluxX','fluxZ','limit','foam','old','foamNext','oldNext','wet','film','qx','qz','qxNext','qzNext'])this[name]=new Float32Array(n);
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
   const k=j*nx+i,x=x0+i*dx,z=z0+j*dz;
   this.bed[k]=bedHeight(x,z);this.sand[k]=terrainHeight(x,z);
   this.h[k]=Math.max(0,-this.bed[k]);
   this.wet[k]=smooth(.3,-.1,this.sand[k]);
   this.qx[k]=x;this.qz[k]=z;
  }
  // These weights and coordinates depend on the fixed grid, not on time.
  this.sponge=new Float32Array(n);this.gridX=new Float32Array(nx);this.gridZ=new Float32Array(nz);
  for(let i=0;i<nx;i++)this.gridX[i]=x0+i*dx;
  for(let j=0;j<nz;j++)this.gridZ[j]=z0+j*dz;
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)this.sponge[j*nx+i]=Math.max(smooth(nx-26,nx-2,i),smooth(12,0,j),smooth(nz-13,nz-1,j));
  // Separate the incoming phase into fixed x and time-dependent row terms.
  // cos(x + row) preserves the same wave, with O(nx+nz) trigonometry.
  this.waveX=WAVES.map(w=>({cos:Float64Array.from(this.gridX,x=>Math.cos(w.k*(x-52))*w.a),sin:Float64Array.from(this.gridX,x=>Math.sin(w.k*(x-52))*w.a)}));
  this.waveRows=WAVES.map(()=>({cos:new Float64Array(nz),sin:new Float64Array(nz)}));
  this.waveGroup=new Float64Array(nz);this.spongeBlend=new Float64Array(n);this.boundaryDt=0;
 }
 configure(p){Object.assign(this.target,p);}
 sample(a,x,z) {
  const {nx,nz}=this.g;x=clamp(x,0,nx-1.001);z=clamp(z,0,nz-1.001);
  const i=x|0,j=z|0,fx=x-i,fz=z-j,k=j*nx+i;
  return (a[k]*(1-fx)+a[k+1]*fx)*(1-fz)+(a[k+nx]*(1-fx)+a[k+nx+1]*fx)*fz;
 }
 prepareBoundary(dt){
  const {nz}=this.g,t=this.time,dir=this.state.wind*Math.PI/180;
  if(dt!==this.boundaryDt){for(let k=0;k<this.n;k++)this.spongeBlend[k]=1-Math.exp(-dt*this.sponge[k]*9);this.boundaryDt=dt;}
  for(let j=0;j<nz;j++){
   const z=this.gridZ[j];this.waveGroup[j]=this.state.strength*(.79+.16*Math.sin(t*.071+z*.018)+.10*Math.sin(t*.117-z*.031));
   for(let w=0;w<WAVES.length;w++){const wave=WAVES[w],phase=z*(wave.z+dir*.055)+wave.w*t+wave.p;this.waveRows[w].cos[j]=Math.cos(phase);this.waveRows[w].sin[j]=Math.sin(phase);}
  }
 }
 step(dt=1/60) {
  const {nx,nz,dx,dz,x0,z0}=this.g;
  const {bed,h,u,v,fluxX,fluxZ,limit,next}=this;
  const grav=9.81,drain=Math.exp(-dt*1.5);
  for(const key of Object.keys(this.state))this.state[key]+=(this.target[key]-this.state[key])*Math.min(1,dt*.55);
  this.time+=dt;this.steps++;this.prepareBoundary(dt);
  if(this.kernels)this.kernels.pressure(this,dt);
  else {
  // Staggered face velocities. Dry raised cells act as solid walls until overtopped.
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++) {
   const k=j*nx+i,eta=bed[k]+h[k];
   if(i<nx-1){
    const q=k+1,e2=bed[q]+h[q],crest=Math.max(bed[k],bed[q]);
    const faceH=Math.max(0,Math.max(eta,e2)-crest);
    if(faceH<.001) {u[k]=0;fluxX[k]=0;}
    else {
     const drag=.065+.08/(faceH+.075);
     u[k]=clamp((u[k]-grav*dt*(e2-eta)/dx)/(1+dt*drag),-5,5);
     const donor=u[k]>0?Math.max(0,eta-crest):Math.max(0,e2-crest);
     fluxX[k]=u[k]*donor;
     // The centred pressure update can ring at a steep hydraulic bore,
     // generating a one-cell overshoot and a sharp, cloth-like crest. A local
     // conservative face flux dissipates only unresolved steep wet fronts.
     // It vanishes for resting water and gentle swells, and never crosses a
     // dry obstacle. The existing shared positivity limiter still applies.
     if(h[k]>.008&&h[q]>.008){const steep=smooth(.12,.48,Math.abs(e2-eta)/dx);fluxX[k]-=.32*steep*(e2-eta)/dx;}
    }
   }else fluxX[k]=0;
   if(j<nz-1){
    const q=k+nx,e2=bed[q]+h[q],crest=Math.max(bed[k],bed[q]);
    const faceH=Math.max(0,Math.max(eta,e2)-crest);
    if(faceH<.001) {v[k]=0;fluxZ[k]=0;}
    else {
     const drag=.065+.08/(faceH+.075);
     v[k]=clamp((v[k]-grav*dt*(e2-eta)/dz)/(1+dt*drag),-5,5);
     const donor=v[k]>0?Math.max(0,eta-crest):Math.max(0,e2-crest);
     fluxZ[k]=v[k]*donor;
     if(h[k]>.008&&h[q]>.008){const steep=smooth(.12,.48,Math.abs(e2-eta)/dz);fluxZ[k]-=.32*steep*(e2-eta)/dz;}
    }
   }else fluxZ[k]=0;
  }
  // Positivity-preserving flux limiter (shared face flux, conserved volume).
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
   const k=j*nx+i;
   const outgoing=(Math.max(fluxX[k],0)+(i?Math.max(-fluxX[k-1],0):0))/dx+(Math.max(fluxZ[k],0)+(j?Math.max(-fluxZ[k-nx],0):0))/dz;
   limit[k]=outgoing>0?Math.min(1,h[k]/(dt*outgoing+1e-10)):1;
  }
  for(let k=0;k<this.n;k++){
   fluxX[k]*=fluxX[k]>=0?limit[k]:limit[Math.min(k+1,this.n-1)];
   fluxZ[k]*=fluxZ[k]>=0?limit[k]:limit[Math.min(k+nx,this.n-1)];
  }
  }
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
   const k=j*nx+i;
   if(!this.kernels)next[k]=Math.max(0,h[k]-dt*((fluxX[k]-(i?fluxX[k-1]:0))/dx+(fluxZ[k]-(j?fluxZ[k-nx]:0))/dz));
   // Gentle radiation boundaries beyond the accessible beach and analytic sea.
   const edge=this.sponge[k];
   if(edge>0){
    let wave=0;
    for(let w=0;w<WAVES.length;w++)wave+=this.waveX[w].cos[i]*this.waveRows[w].cos[j]-this.waveX[w].sin[i]*this.waveRows[w].sin[j];
    const arrival=this.state.tide+wave*this.waveGroup[j];
    const targetH=Math.max(0,arrival-bed[k]);
    const blend=this.spongeBlend[k];
    next[k]+=(targetH-next[k])*blend;
    const waveU=-(arrival-this.state.tide)*Math.sqrt(grav/Math.max(.45,this.state.tide-bed[k]));
    u[k]+=(waveU-u[k])*blend;v[k]*=1-blend*.5;
   }
   // A sub-millimetre residual drains rather than leaving permanent isolated cells.
   if(next[k]<.0015)next[k]*=drain;
  }
  this.h=next;this.next=h;
  // Advection and lifecycle at 30 Hz; fluid integration remains 60 Hz.
  if(this.steps%2===0)this.transport(dt*2);
 }
 transport(dt){
  const {nx,nz,dx,dz,x0,z0}=this.g;
  const {h,bed,u,v,foam,old,foamNext,oldNext,wet,film,qx,qz,qxNext,qzNext}=this;
  const freshDecay=Math.exp(-dt*.65),oldDecay=Math.exp(-dt*.145),wetDecay=Math.exp(-dt*.011),filmDecay=Math.exp(-dt*.31),restore=dt*.017;
  if(this.kernels)this.kernels.transport(this,dt,freshDecay,oldDecay,wetDecay,filmDecay);
  else for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
   const k=j*nx+i;
   const ux=(u[k]+(i?u[k-1]:u[k]))*.5,vz=(v[k]+(j?v[k-nx]:v[k]))*.5;
   const bx=clamp(i-ux*dt/dx,0,nx-1.001),bz=clamp(j-vz*dt/dz,0,nz-1.001);
   const ix=bx|0,iz=bz|0,k0=iz*nx+ix,fx=bx-ix,fz=bz-iz,ax=1-fx,az=1-fz;
   const f=(foam[k0]*ax+foam[k0+1]*fx)*az+(foam[k0+nx]*ax+foam[k0+nx+1]*fx)*fz;
   const o=(old[k0]*ax+old[k0+1]*fx)*az+(old[k0+nx]*ax+old[k0+nx+1]*fx)*fz;
   const ex=i>0&&i<nx-1?Math.abs(bed[k+1]+h[k+1]-bed[k-1]-h[k-1])/(2*dx):0;
   const ez=j>0&&j<nz-1?Math.abs(bed[k+nx]+h[k+nx]-bed[k-nx]-h[k-nx])/(2*dz):0;
   const gradient=Math.sqrt(ex*ex+ez*ez);
   const compression=-((u[k]-(i?u[k-1]:u[k]))/dx+(v[k]-(j?v[k-nx]:v[k]))/dz);
   const speed=Math.sqrt(ux*ux+vz*vz);
   const front=smooth(.009,.035,h[k])*(1-smooth(.14,.46,h[k]));
   const bore=smooth(.11,.28,gradient)*smooth(.025,.58,compression)*smooth(.055,.16,h[k])*(1-smooth(1.2,2.6,h[k]));
   const obstacle=bed[k]-this.sand[k]>.08;
   const impact=obstacle?smooth(.65,1.6,speed)*smooth(.04,.3,h[k])*(1-smooth(.3,.9,h[k]))*smooth(.12,1,compression):0;
   const advancingEdge=front*smooth(.15,.95,-ux)*(obstacle?.08:1);
   const source=(bore*(obstacle?.65:2.65)+advancingEdge*.90+impact*.9)*this.state.strength;
   if(h[k]>.002){
    foamNext[k]=clamp(f*freshDecay+dt*source,0,1);
    oldNext[k]=clamp(o*oldDecay+f*dt*.35,0,.85);
    wet[k]=Math.min(1,wet[k]+dt*2.5);
    film[k]=Math.max(film[k],Math.min(1,h[k]*5));
   }else{
    foamNext[k]=0;oldNext[k]=0;
    wet[k]*=wetDecay;
    // Sheen drains quickly; absorbed moisture remains for more than a minute.
    film[k]*=filmDecay;
   }
   qxNext[k]=((qx[k0]*ax+qx[k0+1]*fx)*az+(qx[k0+nx]*ax+qx[k0+nx+1]*fx)*fz)*(1-restore)+(x0+i*dx)*restore;
   qzNext[k]=((qz[k0]*ax+qz[k0+1]*fx)*az+(qz[k0+nx]*ax+qz[k0+nx+1]*fx)*fz)*(1-restore)+(z0+j*dz)*restore;
  }
  this.foam=foamNext;this.foamNext=foam;this.old=oldNext;this.oldNext=old;
  this.qx=qxNext;this.qxNext=qx;this.qz=qzNext;this.qzNext=qz;
 }
 pack(reuse){return packSurface(this,reuse);}
 metrics(){
  let maxH=0,volume=0,foam=0,wetCells=0,nonfinite=0;
  for(let k=0;k<this.n;k++){
   maxH=Math.max(maxH,this.h[k]);volume+=this.h[k]*this.g.dx*this.g.dz;
   foam+=this.foam[k]+this.old[k];wetCells+=this.h[k]>.006?1:0;
   if(!Number.isFinite(this.h[k]+this.u[k]+this.v[k]))nonfinite++;
  }
  return {time:this.time,maxH,volume,foam,wetCells,nonfinite};
 }
}
