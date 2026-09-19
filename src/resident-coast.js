import {GpuState} from './gpu-state.js?v=1.5.1';
import {CudaSolver,FIELDS} from './cuda-solver.js?v=1.5.1';
import {shareStorage,initializeFieldTextures,copyFields} from './gpu-interop.js?v=1.5.1';
import {GRID,ROCKS} from './coast.js?v=1.5.1';

export class ResidentCoast {
 static async create(renderer,fields){
  const sim=new GpuState(GRID);let hydrated=false;
  try{
   const response=await fetch(new URL('../initial-state.bin.gz?v=1.5.1',import.meta.url));
   if(!response.ok)throw Error('No baked state');
   const a=new Float32Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
   if(a[0]!==185||a[1]!==sim.g.nx||a[2]!==sim.g.nz||a.length!==8+sim.n*9)throw Error('Incompatible state');
   FIELDS.slice(2,11).forEach((key,i)=>sim[key]=a.subarray(8+i*sim.n,8+(i+1)*sim.n));
   sim.time=a[3];sim.steps=a[4];hydrated=true;
  }catch{}
  const solver=await CudaSolver.create(sim,{device:renderer.backend.device});
  // The one-time baked upload no longer needs a host-side copy.
  for(const key of FIELDS)delete sim[key];
  solver.initialize(hydrated);
  if(!hydrated){
   for(let block=0;block<36;block++){
    const batch=solver.runtime.batch();for(let i=0;i<60;i++)solver.step(1/60,batch);batch.submit();
    await solver.runtime.idle();
   }
  }
  const resident=new ResidentCoast(renderer,fields,solver);
  resident.rock=shareStorage(renderer,solver,'RockState');fields.gpuRockState=resident.rock.node;
  resident.spray=shareStorage(renderer,solver,'Spray',4);
  initializeFieldTextures(renderer,solver,fields);
  const batch=solver.runtime.batch();solver.dispatch(batch,'initializeContacts',{rockCount:ROCKS.length,time:sim.time},1);solver.pack(batch,false);copyFields(renderer,solver,fields,batch,true);batch.submit();
  return resident;
 }
 constructor(renderer,fields,solver){
  this.renderer=renderer;this.fields=fields;this.solver=solver;this.sim=solver.sim;
  this.debt=0;this.interval=1/30;this.lastPublish=this.sim.time;this.previousTime=this.sim.time-1/30;
  this.currentTime=this.sim.time;this.previousState={...this.sim.state};this.currentState={...this.sim.state};
  this.cpuMs=0;this.frames=0;this.metricPending=false;this.lastMetricWall=0;
 }
 frame(seconds){
  const start=performance.now();this.debt+=seconds;
  const count=Math.min(6,Math.floor((this.debt+1e-7)*60));
  const gpu=this.solver,batch=gpu.runtime.batch();let published=false;
  for(let i=0;i<count;i++){
   gpu.step(1/60,batch);
   if(this.sim.time-this.lastPublish>=this.interval-1e-7){
    gpu.pack(batch);copyFields(this.renderer,gpu,this.fields,batch);
    this.previousTime=this.currentTime;this.currentTime=this.sim.time;
    this.previousState=this.currentState;this.currentState={...this.sim.state};this.lastPublish=this.sim.time;published=true;
   }
  }
  this.debt-=count/60;
  const renderTime=this.sim.time+this.debt-this.interval;
  gpu.animateSpray(batch,Math.max(this.previousTime,Math.min(this.currentTime,renderTime)));batch.submit();
  this.cpuMs+=performance.now()-start;this.frames++;
  return {published,renderTime,alpha:Math.max(0,Math.min(1,(renderTime-this.previousTime)/(this.currentTime-this.previousTime)))};
 }
 profile(){return {kernel:this.solver.name,resident:true,submissionMeanMs:this.cpuMs/Math.max(1,this.frames),readbackMs:0,packMs:0,reconstructionMs:0,debtMs:this.debt*1000,steps:this.sim.steps,stats:{...this.solver.runtime.stats}};}
}
