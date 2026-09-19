// A wet node is the solver's free surface, never a blend with a dry extension.
// Dry extensions only determine the sub-cell shoreline intersection. They carry
// negative depth and cannot create water, foam, or a film on exposed ground.
export const FILM_DEPTH=.0005;
export function reconstructSurface(sim,eta){
 const {nx,nz}=sim.g,{bed,h,n}=sim;
 const raw=sim.renderRaw||(sim.renderRaw=new Float32Array(n));
 for(let k=0;k<n;k++)raw[k]=bed[k]+h[k];
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i;
  if(h[k]>=FILM_DEPTH){eta[k]=raw[k];continue;}
  // Extrapolate from one adjacent wet region; never average the levels on
  // opposite sides of an exposed stone. Prefer the closest free-surface level.
  let level=bed[k]-.025,found=false,best=Infinity;
  for(let axis=0;axis<4;axis++){
   const d=axis===0?-1:axis===1?1:axis===2?-nx:nx;
   if((axis===0&&i===0)||(axis===1&&i===nx-1)||(axis===2&&j===0)||(axis===3&&j===nz-1))continue;
   const q=k+d;if(h[q]<FILM_DEPTH)continue;
   const score=Math.abs(raw[q]-bed[k]);
   if(score<best){best=score;level=raw[q];found=true;}
  }
  // A small, continuous residual turns into the sand's draining sheen. No
  // physically resolved wash (>=0.5 mm) is lowered or spread across dry cells.
  const dry=Math.min(bed[k]-.0005,found?level:bed[k]-.025);
  const t=h[k]/FILM_DEPTH;
  eta[k]=dry+(raw[k]-dry)*t*t;
 }
 return eta;
}
export function packSurface(sim,reuse){
 const {n,bed,h}=sim,{nx,nz,dx,dz}=sim.g;
 const surface=reuse?.surface||new Float32Array(n*4),material=reuse?.material||new Float32Array(n*4),flow=reuse?.flow||new Float32Array(n*4);
 const eta=sim.renderEta||(sim.renderEta=new Float32Array(n));
 const start=performance.now();reconstructSurface(sim,eta);sim.reconstructionMs=performance.now()-start;
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i,q=k*4,e=eta[k];
  surface[q]=e;surface[q+1]=e-bed[k];surface[q+2]=sim.foam[k];surface[q+3]=sim.old[k];
  material[q]=sim.wet[k];material[q+1]=sim.film[k];material[q+2]=sim.qx[k];material[q+3]=sim.qz[k];
  // Only fluid-connected neighbours contribute to a water normal. Dry rock
  // heights cannot tilt reflections or join the flows on opposite faces.
  const l=i>0&&h[k-1]>=FILM_DEPTH&&Math.min(e,eta[k-1])>Math.max(bed[k],bed[k-1]);
  const r=i<nx-1&&h[k+1]>=FILM_DEPTH&&Math.min(e,eta[k+1])>Math.max(bed[k],bed[k+1]);
  const b=j>0&&h[k-nx]>=FILM_DEPTH&&Math.min(e,eta[k-nx])>Math.max(bed[k],bed[k-nx]);
  const f=j<nz-1&&h[k+nx]>=FILM_DEPTH&&Math.min(e,eta[k+nx])>Math.max(bed[k],bed[k+nx]);
  flow[q]=sim.u[k];flow[q+1]=sim.v[k];
  flow[q+2]=(r||l)?((r?eta[k+1]:e)-(l?eta[k-1]:e))/(dx*(l&&r?2:1)):0;
  flow[q+3]=(b||f)?((f?eta[k+nx]:e)-(b?eta[k-nx]:e))/(dz*(b&&f?2:1)):0;
 }
 return{surface,material,flow,time:sim.time,state:{...sim.state}};
}
