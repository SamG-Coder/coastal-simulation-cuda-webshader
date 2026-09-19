// Same finite-volume and transport equations as simulation.js, compiled with
// AssemblyScript 0.27.31. f64 intermediates and f32 stores match JavaScript arrays.
// asc solver-kernels.ts -o solver-kernels.wasm -O3 --runtime stub --importMemory --noAssert
@inline function get(p:usize,k:i32):f64{return f64(load<f32>(p+(usize(k)<<2)));}
@inline function put(p:usize,k:i32,v:f64):void{store<f32>(p+(usize(k)<<2),f32(v));}
@inline function cap(v:f64,a:f64,b:f64):f64{return max(a,min(b,v));}
@inline function smooth(a:f64,b:f64,v:f64):f64{const t=cap((v-a)/(b-a),0,1);return t*t*(3-2*t);}
@inline function adv(p:usize,k:i32,nx:i32,ax:f64,fx:f64,az:f64,fz:f64):f64{return (get(p,k)*ax+get(p,k+1)*fx)*az+(get(p,k+nx)*ax+get(p,k+nx+1)*fx)*fz;}
export function pressure(nx:i32,nz:i32,dx:f64,dz:f64,dt:f64,bed:usize,h:usize,u:usize,v:usize,fluxX:usize,fluxZ:usize,limit:usize,next:usize):void{
 const n=nx*nz;
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i,eta=get(bed,k)+get(h,k);
  if(i<nx-1){
   const q=k+1,e2=get(bed,q)+get(h,q),crest=max(get(bed,k),get(bed,q)),faceH=max(0,max(eta,e2)-crest);
   if(faceH<.001){put(u,k,0);put(fluxX,k,0);}else{
    const drag=.065+.08/(faceH+.075);
    put(u,k,cap((get(u,k)-9.81*dt*(e2-eta)/dx)/(1+dt*drag),-5,5));
    const speed=get(u,k),donor=speed>0?max(0,eta-crest):max(0,e2-crest);
    put(fluxX,k,speed*donor);
    if(get(h,k)>.008&&get(h,q)>.008)put(fluxX,k,get(fluxX,k)-.32*smooth(.12,.48,abs(e2-eta)/dx)*(e2-eta)/dx);
   }
  }else put(fluxX,k,0);
  if(j<nz-1){
   const q=k+nx,e2=get(bed,q)+get(h,q),crest=max(get(bed,k),get(bed,q)),faceH=max(0,max(eta,e2)-crest);
   if(faceH<.001){put(v,k,0);put(fluxZ,k,0);}else{
    const drag=.065+.08/(faceH+.075);
    put(v,k,cap((get(v,k)-9.81*dt*(e2-eta)/dz)/(1+dt*drag),-5,5));
    const speed=get(v,k),donor=speed>0?max(0,eta-crest):max(0,e2-crest);
    put(fluxZ,k,speed*donor);
    if(get(h,k)>.008&&get(h,q)>.008)put(fluxZ,k,get(fluxZ,k)-.32*smooth(.12,.48,abs(e2-eta)/dz)*(e2-eta)/dz);
   }
  }else put(fluxZ,k,0);
 }
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i,outgoing=(max(get(fluxX,k),0)+(i>0?max(-get(fluxX,k-1),0):0))/dx+(max(get(fluxZ,k),0)+(j>0?max(-get(fluxZ,k-nx),0):0))/dz;
  put(limit,k,outgoing>0?min(1,get(h,k)/(dt*outgoing+1e-10)):1);
 }
 for(let k=0;k<n;k++){
  put(fluxX,k,get(fluxX,k)*(get(fluxX,k)>=0?get(limit,k):get(limit,min(k+1,n-1))));
  put(fluxZ,k,get(fluxZ,k)*(get(fluxZ,k)>=0?get(limit,k):get(limit,min(k+nx,n-1))));
 }
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i;
  put(next,k,max(0,get(h,k)-dt*((get(fluxX,k)-(i>0?get(fluxX,k-1):0))/dx+(get(fluxZ,k)-(j>0?get(fluxZ,k-nx):0))/dz)));
 }
}
export function transport(nx:i32,nz:i32,dx:f64,dz:f64,x0:f64,z0:f64,dt:f64,strength:f64,freshDecay:f64,oldDecay:f64,wetDecay:f64,filmDecay:f64,h:usize,bed:usize,sand:usize,u:usize,v:usize,foam:usize,old:usize,foamNext:usize,oldNext:usize,wet:usize,film:usize,qx:usize,qz:usize,qxNext:usize,qzNext:usize):void{
 const restore=dt*.017;
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i,ux=(get(u,k)+(i>0?get(u,k-1):get(u,k)))*.5,vz=(get(v,k)+(j>0?get(v,k-nx):get(v,k)))*.5;
  const bx=cap(f64(i)-ux*dt/dx,0,f64(nx)-1.001),bz=cap(f64(j)-vz*dt/dz,0,f64(nz)-1.001);
  const ix=i32(bx),iz=i32(bz),k0=iz*nx+ix,fx=bx-f64(ix),fz=bz-f64(iz),ax=1-fx,az=1-fz;
  const f=adv(foam,k0,nx,ax,fx,az,fz),o=adv(old,k0,nx,ax,fx,az,fz);
  const ex=i>0&&i<nx-1?abs(get(bed,k+1)+get(h,k+1)-get(bed,k-1)-get(h,k-1))/(2*dx):0;
  const ez=j>0&&j<nz-1?abs(get(bed,k+nx)+get(h,k+nx)-get(bed,k-nx)-get(h,k-nx))/(2*dz):0;
  const gradient=sqrt(ex*ex+ez*ez),compression=-((get(u,k)-(i>0?get(u,k-1):get(u,k)))/dx+(get(v,k)-(j>0?get(v,k-nx):get(v,k)))/dz);
  const speed=sqrt(ux*ux+vz*vz),depth=get(h,k);
  const front=smooth(.009,.035,depth)*(1-smooth(.14,.46,depth));
  const bore=smooth(.11,.28,gradient)*smooth(.025,.58,compression)*smooth(.055,.16,depth)*(1-smooth(1.2,2.6,depth));
  const obstacle=get(bed,k)-get(sand,k)>.08;
  const impact=obstacle?smooth(.65,1.6,speed)*smooth(.04,.3,depth)*(1-smooth(.3,.9,depth))*smooth(.12,1,compression):0;
  const advancingEdge=front*smooth(.15,.95,-ux)*(obstacle?.08:1);
  const source=(bore*(obstacle?.65:2.65)+advancingEdge*.90+impact*.9)*strength;
  if(depth>.002){
   put(foamNext,k,cap(f*freshDecay+dt*source,0,1));put(oldNext,k,cap(o*oldDecay+f*dt*.35,0,.85));
   put(wet,k,min(1,get(wet,k)+dt*2.5));put(film,k,max(get(film,k),min(1,depth*5)));
  }else{put(foamNext,k,0);put(oldNext,k,0);put(wet,k,get(wet,k)*wetDecay);put(film,k,get(film,k)*filmDecay);}
  put(qxNext,k,adv(qx,k0,nx,ax,fx,az,fz)*(1-restore)+(x0+f64(i)*dx)*restore);
  put(qzNext,k,adv(qz,k0,nx,ax,fx,az,fz)*(1-restore)+(z0+f64(j)*dz)*restore);
 }
}
