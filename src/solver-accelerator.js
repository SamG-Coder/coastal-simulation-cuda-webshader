const arrays=['bed','sand','h','next','u','v','fluxX','fluxZ','limit','foam','old','foamNext','oldNext','wet','film','qx','qz','qxNext','qzNext'];
// The worker and its Float32 arrays stay in charge. Only arithmetic kernels
// run in Wasm; there are no per-step copies, shared-memory requirements or threads.
export async function enableSolverAcceleration(sim,bytes){
 try{
  if(!bytes){const response=await fetch(new URL('./solver-kernels.wasm?v=1.3.0',import.meta.url));if(!response.ok)return false;bytes=await response.arrayBuffer();}
  const memory=new WebAssembly.Memory({initial:Math.ceil((65536+sim.n*4*arrays.length)/65536)});
  const {instance}=await WebAssembly.instantiate(bytes,{env:{memory}}),kernel=instance.exports;
  if(typeof kernel.pressure!=='function'||typeof kernel.transport!=='function')return false;
  const views=arrays.map((name,i)=>{const a=new Float32Array(memory.buffer,65536+i*sim.n*4,sim.n);a.set(sim[name]);return a;});
  arrays.forEach((name,i)=>{sim[name]=views[i];});
  sim.kernels={
   pressure(s,dt){const {nx,nz,dx,dz}=s.g;kernel.pressure(nx,nz,dx,dz,dt,s.bed.byteOffset,s.h.byteOffset,s.u.byteOffset,s.v.byteOffset,s.fluxX.byteOffset,s.fluxZ.byteOffset,s.limit.byteOffset,s.next.byteOffset);},
   transport(s,dt,fresh,old,wet,film){const {nx,nz,dx,dz,x0,z0}=s.g;kernel.transport(nx,nz,dx,dz,x0,z0,dt,s.state.strength,fresh,old,wet,film,s.h.byteOffset,s.bed.byteOffset,s.sand.byteOffset,s.u.byteOffset,s.v.byteOffset,s.foam.byteOffset,s.old.byteOffset,s.foamNext.byteOffset,s.oldNext.byteOffset,s.wet.byteOffset,s.film.byteOffset,s.qx.byteOffset,s.qz.byteOffset,s.qxNext.byteOffset,s.qzNext.byteOffset);}
  };
  return true;
 }catch{return false;}
}
