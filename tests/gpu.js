import {ShoreSimulation} from './reference/simulation.js';
import {CudaSolver} from '../src/cuda-solver.js';
import {GRID} from '../src/coast.js';
import {makeNoiseTexture} from './reference/noise.js';
import {checkRealism} from './realism.js';
const fields=['h','u','v','foam','old','wet','film','qx','qz'];
const report={passed:true,cases:[]};
async function run(name,config,steps,setup,tolerance,closed=false){
 const cpu=new ShoreSimulation(config),gpuSim=new ShoreSimulation(config);
 if(setup){await setup(cpu);await setup(gpuSim);}
 // Keep exact upstream parity as an explicit reference mode; enhanced physics
 // is covered by separate conservation, equilibrium and turbulence tests.
 const gpu=await CudaSolver.create(gpuSim,{enhanced:false});
 const initialVolume=gpuSim.metrics().volume;
 try{
  report.adapter=gpu.runtime.describe();
  const errors=[];gpu.runtime.onError=e=>errors.push(String(e));
  const start=performance.now();
  for(let i=0;i<steps;i++){cpu.step();gpu.step();}
  await gpu.sync();
  const delta={};let finite=true,positive=true;
  for(const field of fields){let max=0;for(let k=0;k<cpu.n;k++){
   const value=gpuSim[field][k];finite&&=Number.isFinite(value);
   if(field==='h')positive&&=value>=0;
   max=Math.max(max,Math.abs(value-cpu[field][k]));
  }delta[field]=max;}
  const volumeError=Math.abs(gpuSim.metrics().volume-cpu.metrics().volume)/Math.max(1,cpu.metrics().volume);
  const batch=gpu.runtime.batch();gpu.pack(batch,false);batch.submit();
  const packed=await gpu.runtime.read(gpu.Out),reference=gpuSim.pack(),packingErrors={};
  for(const [f,field] of ['surface','material','flow'].entries()){
   let max=0;
   for(let j=0;j<config.nz;j++)for(let i=0;i<config.nx;i++)for(let c=0;c<4;c++)max=Math.max(max,Math.abs(packed[(f*gpu.pitch*config.nz+j*gpu.pitch+i)*4+c]-reference[field][(j*config.nx+i)*4+c]));
   packingErrors[field]=max;
  }
  const conservationError=closed?Math.abs(gpuSim.metrics().volume-initialVolume)/initialVolume:null;
  const passed=finite&&positive&&errors.length===0&&Object.values(delta).every(x=>x<tolerance)&&Object.values(packingErrors).every(x=>x<.0001)&&volumeError<.0001&&(!closed||conservationError<.000001);
  report.cases.push({name,grid:[config.nx,config.nz],steps,passed,finite,positive,delta,packingErrors,volumeError,conservationError,errors,elapsedMs:performance.now()-start});report.passed&&=passed;
 }finally{gpu.dispose();}
}
try{
 await checkRealism(report);
 const initCpu=new ShoreSimulation(GRID),initGpu=new ShoreSimulation(GRID,{initialize:false}),initSolver=await CudaSolver.create(initGpu);
 try{
  initSolver.initialize();const data=await initSolver.runtime.read(initSolver.S),names=['bed','sand','h','u','v','foam','old','wet','film','qx','qz'],delta={};
  for(const [field,name] of names.entries()){let max=0;for(let k=0;k<initCpu.n;k++)max=Math.max(max,Math.abs(data[field*initCpu.n+k]-initCpu[name][k]));delta[name]=max;}
  const passed=Object.values(delta).every(x=>x<.0003);report.cases.push({name:'CUDA procedural initialization',passed,delta});report.passed&&=passed;
  const size=512;initSolver.Noise=initSolver.runtime.createBuffer(size*size*4);
  const batch=initSolver.runtime.batch();initSolver.dispatch(batch,'generateNoise',{size},Math.ceil(size*size/128));batch.submit();
  const actual=new Uint8Array((await initSolver.runtime.read(initSolver.Noise,Uint32Array)).buffer),reference=makeNoiseTexture(size).image.data;
  let maxChannelError=0;for(let i=0;i<actual.length;i++)maxChannelError=Math.max(maxChannelError,Math.abs(actual[i]-reference[i]));
  report.cases.push({name:'512 x 512 CUDA material noise',passed:maxChannelError<=1,maxChannelError});report.passed&&=maxChannelError<=1;
  initSolver.runtime.write(initSolver.Particles,new Float32Array([1,2,3,10,.5,.25,1,.5,.02,0,0,0]));
  const sprayBatch=initSolver.runtime.batch();initSolver.animateSpray(sprayBatch,10.2);sprayBatch.submit();
  const spray=await initSolver.runtime.read(initSolver.Spray,Float32Array,32),expectedSpray=[1.05,2+.2-4.905*.2*.2,3.1,.68*.6,.02,.02*1.6,0,0];
  const maxSprayError=Math.max(...spray.map((v,i)=>Math.abs(v-expectedSpray[i])));
  report.cases.push({name:'CUDA spray ballistic motion and fade',passed:maxSprayError<.00001,maxSprayError});report.passed&&=maxSprayError<.00001;
 }finally{initSolver.dispose();}
 await run('resting water / partial workgroup',{nx:17,nz:19,dx:.3,dz:.3,x0:0,z0:0},120,s=>{
  s.bed.fill(-1);s.h.fill(1);s.sponge.fill(0);s.foam.fill(0);s.old.fill(0);
 },.0001);
 await run('closed domain water conservation',{nx:31,nz:29,dx:.3,dz:.3,x0:0,z0:0},240,s=>{
  s.bed.fill(-1);s.sponge.fill(0);
  for(let k=0;k<s.n;k++)s.h[k]=1+.15*Math.sin(k*.21);
 },.001,true);
 await run('wet dry front, obstacles and controls',{nx:37,nz:43,dx:.3,dz:.3,x0:-4,z0:-6},120,s=>{
  for(let k=0;k<s.n;k++){s.h[k]=Math.max(0,-s.bed[k]+.1*Math.sin(k*.37));s.u[k]=Math.sin(k*.23)*.2;s.foam[k]=.2;s.old[k]=.1;}
  s.configure({strength:1.6,wind:18,tide:.15});
 },.003);
 await run('full grid baked shoreline',GRID,60,async s=>{
  const response=await fetch('../initial-state.bin.gz');
  const data=new Float32Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  fields.forEach((key,i)=>s[key].set(data.subarray(8+i*s.n,8+(i+1)*s.n)));
  s.time=data[3];s.steps=data[4];
 },.006);
 const stable=new ShoreSimulation(GRID),solver=await CudaSolver.create(stable);
 try{
  stable.configure({strength:1.7,wind:-20,tide:.3});
  for(let i=0;i<1800;i++)solver.step();
  await solver.sync();
  const metrics=stable.metrics(),finite=fields.every(f=>stable[f].every(Number.isFinite));
  const reduced=await solver.metrics(),volumeReductionError=Math.abs(reduced.volume-metrics.volume)/metrics.volume;
  const positive=stable.h.every(v=>v>=0),passed=finite&&positive&&metrics.maxH<10;
  report.cases.push({name:'30 simulated seconds from cold start',steps:1800,passed:passed&&volumeReductionError<.00001,finite,positive,metrics,volumeReductionError});report.passed&&=passed&&volumeReductionError<.00001;
 }finally{solver.dispose();}
}catch(e){report.passed=false;report.error=String(e.stack||e);}
window.__gpuReport=report;
document.body.textContent=JSON.stringify(report,null,2);
