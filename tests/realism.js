import {ShoreSimulation} from './reference/simulation.js';
import {CudaSolver} from '../src/cuda-solver.js';

// Independent invariants for the enhanced model. The original CPU solver is
// retained as a parity oracle only for the explicit reference mode.
export async function checkRealism(report){
 const g={nx:41,nz:39,dx:.3,dz:.3,x0:0,z0:0};
 async function check(name,setup,body){
  const sim=new ShoreSimulation(g);sim.bed.fill(-1);sim.sand.fill(-1);sim.h.fill(1);sim.sponge.fill(0);sim.foam.fill(0);sim.old.fill(0);
  setup?.(sim);const solver=await CudaSolver.create(sim);
  try{const result=await body(sim,solver);report.cases.push({name,...result});report.passed&&=result.passed;}
  finally{solver.dispose();}
 }
 await check('enhanced: lake at rest',null,async(s,gpu)=>{
  for(let i=0;i<120;i++)gpu.step();await gpu.sync();
  const maxDrift=Math.max(...s.h.map(h=>Math.abs(h-1)),...s.u.map(Math.abs),...s.v.map(Math.abs));
  const aux=await gpu.runtime.read(gpu.Aux),maxTurbulence=Math.max(...aux.subarray(s.n*2,s.n*3));
  return {passed:maxDrift<1e-6&&maxTurbulence===0,maxDrift,maxTurbulence};
 });
 await check('enhanced: closed-domain volume',s=>{
  for(let j=0;j<g.nz;j++)for(let i=0;i<g.nx;i++)s.h[j*g.nx+i]=1+.2*Math.exp(-((i-18)**2+(j-20)**2)/35);
 },async(s,gpu)=>{
  const before=s.metrics().volume;for(let i=0;i<600;i++)gpu.step();await gpu.sync();
  const relativeVolumeError=Math.abs(s.metrics().volume-before)/before,positive=s.h.every(h=>h>=0),finite=['h','u','v','foam','old'].every(f=>s[f].every(Number.isFinite));
  return {passed:relativeVolumeError<1e-6&&positive&&finite,relativeVolumeError,positive,finite};
 });
 await check('enhanced: momentum carried by cross-flow',s=>{
  s.u.fill(1);for(let k=0;k<s.n;k++)s.v[k]=.2*Math.exp(-(((k%g.nx-20)/4)**2));
 },async(s,gpu)=>{
  const batch=gpu.runtime.batch();gpu.dispatch(batch,'advectMomentum',{...g,dt:.15});batch.submit();
  const aux=await gpu.runtime.read(gpu.Aux);let maxError=0;
  for(let j=2;j<g.nz-2;j++)for(let i=2;i<g.nx-2;i++){
   const k=j*g.nx+i;maxError=Math.max(maxError,Math.abs(aux[k]-1),Math.abs(aux[s.n+k]-(s.v[k]+s.v[k-1])*.5));
  }
  return {passed:maxError<1e-6,maxError};
 });
 await check('enhanced: breaking turbulence persists, decays and dries',s=>{
  for(let k=0;k<s.n;k++){const i=k%g.nx;s.h[k]=.5+i*.05;s.u[k]=-i*.1;}
 },async(s,gpu)=>{
  const transport=()=>{const b=gpu.runtime.batch();gpu.dispatch(b,'transport',{...g,dt:1/30,enhanced:1});gpu.dispatch(b,'commitTransport',{...g,enhanced:1});b.submit();};
  for(let i=0;i<30;i++)transport();
  const k=19*g.nx+10,initial=(await gpu.runtime.read(gpu.Aux))[2*s.n+k];
  // Remove the breaking source without clearing the carried reservoir.
  gpu.runtime.write(gpu.S,new Float32Array(s.n).fill(1),s.n*2*4);
  gpu.runtime.write(gpu.S,new Float32Array(s.n*2),s.n*3*4);
  for(let i=0;i<30;i++)transport();
  const decayed=(await gpu.runtime.read(gpu.Aux))[2*s.n+k],expected=initial*Math.exp(-.85);
  gpu.runtime.write(gpu.S,new Float32Array(s.n),s.n*2*4);transport();
  const dry=(await gpu.runtime.read(gpu.Aux))[2*s.n+k];
  return {passed:initial>.01&&Math.abs(decayed-expected)<1e-5&&dry===0,initial,decayed,expected,dry};
 });
 await check('enhanced: moving wave detail preserves physical depth and dry cells',s=>{
  s.h[20*g.nx+20]=0;
 },async(s,gpu)=>{
  async function pack(time){s.time=time;const b=gpu.runtime.batch();gpu.pack(b,false);b.submit();return gpu.runtime.read(gpu.Eta);}
  const a=await pack(36),b=await pack(36.5);await gpu.sync();
  let maxDisplacement=0,maxMotion=0;
  for(let k=0;k<s.n;k++)if(s.h[k]>0){maxDisplacement=Math.max(maxDisplacement,Math.abs(a[k]));maxMotion=Math.max(maxMotion,Math.abs(a[k]-b[k]));}
  const depthUnchanged=s.h.every((h,k)=>h===(k===20*g.nx+20?0:1)),dryUnchanged=a[20*g.nx+20]===b[20*g.nx+20];
  return {passed:depthUnchanged&&dryUnchanged&&maxDisplacement>.04&&maxDisplacement<.2&&maxMotion>.03,depthUnchanged,dryUnchanged,maxDisplacement,maxMotion};
 });
}
