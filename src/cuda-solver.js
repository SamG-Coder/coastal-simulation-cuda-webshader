import {GpuRuntime} from '../vendor/cuda-webshader/runtime/runtime.js';
import {ROCKS,WAVES} from './coast.js?v=1.5.1';

export const FIELDS=['bed','sand','h','u','v','foam','old','wet','film','qx','qz','next','fluxX','fluxZ','limit','foamNext','oldNext','qxNext','qzNext'];
export const ENTRIES=['advectMomentum','faces','limits','limitFlux','integrate','boundary','transport','commitTransport','initializeWaves','initializeState','initializeContacts','updateControls','prepareRows','reconstruct','surfaceDetail','packFields','rockSpray','sprayVertices','metricsPartials','metricsFinish','generateNoise'];

// One device/queue is shared with Three. No simulation readback in the render path.
export class CudaSolver {
 static async create(sim,options={}){
  const {enhanced=true,...runtimeOptions}=options;
  const sources=await Promise.all(['coastal-kernels.cu','coastal-render.cu'].map(async name=>{
   const response=await fetch(new URL(name+'?v=1.5.1',import.meta.url));
   if(!response.ok)throw new Error(`CUDA source: HTTP ${response.status}`);
   return response.text();
  }));
  const runtime=await GpuRuntime.create({uniformCapacity:262144,...runtimeOptions});
  try{
   const kernels={};
   for(const entry of ENTRIES)kernels[entry]=await runtime.kernel(sources.join('\n'),{entry,workgroupSize:[128,1,1]});
   return new CudaSolver(sim,runtime,kernels,enhanced);
  }catch(error){runtime.dispose();throw error;}
 }
 constructor(sim,runtime,kernels,enhanced){
  this.sim=sim;this.runtime=runtime;this.kernels=kernels;this.bindings=new Map();
  this.enhanced=enhanced;
  const {nx,nz}=sim.g,n=sim.n;
  const data=new Float32Array(n*FIELDS.length);
  FIELDS.forEach((name,i)=>{if(sim[name])data.set(sim[name],i*n);});
  this.S=runtime.createBuffer(data,{label:'Coastal state'});
  // Immutable advected face velocities plus ping-pong breaking turbulence.
  this.Aux=runtime.createBuffer(n*4*4,{label:'Momentum and breaking turbulence'});
  const detail=Array.from({length:8},(_,i)=>{
   const wavelength=8.5*Math.pow(.79,i),angle=[.24,-.42,.67,-.16,.93,-.72,.38,-.95][i];
   const k=2*Math.PI/wavelength;
   return [k*Math.cos(angle),k*Math.sin(angle),Math.sqrt(9.81*k),.043*Math.pow(.77,i)];
  });
  this.DetailW=runtime.createBuffer(new Float32Array(detail.flat()));
  const boundary=new Float32Array(n+8*nx+9*nz);if(sim.sponge)boundary.set(sim.sponge);
  this.B=runtime.createBuffer(boundary,{label:'Coastal boundary'});
  this.W=runtime.createBuffer(new Float32Array(WAVES.flatMap(w=>[w.a,w.k,w.w,w.z,w.p])));
  this.Controls=runtime.createBuffer(new Float32Array([sim.state.strength,sim.state.wind,sim.state.tide]));
  this.R=runtime.createBuffer(new Float32Array(ROCKS.flatMap(r=>[r.x,r.z,r.rx,r.rz,r.h,r.seed,r.base,r.c,r.s,0])));
  this.RockState=runtime.createBuffer((ROCKS.length+1)*8*4);
  this.spraySlots=384;this.particleCount=ROCKS.length*this.spraySlots;
  this.Particles=runtime.createBuffer(this.particleCount*12*4);
  this.Spray=runtime.createBuffer(this.particleCount*2*16);
  this.Eta=runtime.createBuffer(n*4);
  this.pitch=Math.ceil(nx/16)*16;
  this.Out=runtime.createBuffer(this.pitch*nz*16*3);
  this.metricGroups=Math.ceil(n/256);
  this.Part=runtime.createBuffer(this.metricGroups*5*4);this.Result=runtime.createBuffer(8*4);
  this.groups=[Math.ceil(n/128),1,1];this.name='CUDA WebShader / WebGPU';
  const batch=runtime.batch();this.dispatch(batch,'initializeWaves',{...sim.g},Math.ceil(nx/128));this.dispatch(batch,'initializeContacts',{rockCount:ROCKS.length,time:sim.time},1);batch.submit();
 }
 dispatch(batch,entry,values,groups=this.groups){
  const kernel=this.kernels[entry],meta=kernel.artifact.metadata;
  const scalars=Object.fromEntries(meta.scalars.map(p=>[p.name,values[p.name]]));
  let binding=this.bindings.get(entry);
  if(!binding){binding=kernel.bind(Object.fromEntries(meta.bindings.map(p=>[p.name,this[p.name]])),scalars);this.bindings.set(entry,binding);}
  else binding.setScalars(scalars);
  batch.dispatch(binding,groups);
 }
 step(dt=1/60,batch=null){
  const s=this.sim,r=this.runtime,owned=!batch;batch??=r.batch();
  // Host copies of three UI controls also drive navigation and renderer uniforms.
  for(const key of Object.keys(s.state))s.state[key]+=(s.target[key]-s.state[key])*Math.min(1,dt*.55);
  s.time+=dt;s.steps++;
  const all={...s.g,dt,time:s.time,enhanced:Number(this.enhanced)};
  this.dispatch(batch,'updateControls',{dt,strengthTarget:s.target.strength,windTarget:s.target.wind,tideTarget:s.target.tide},1);
  this.dispatch(batch,'prepareRows',all,Math.ceil(s.g.nz/128));
  if(this.enhanced)this.dispatch(batch,'advectMomentum',all);
  for(const entry of ['faces','limits','limitFlux','integrate','boundary'])this.dispatch(batch,entry,all);
  if(s.steps%2===0){
   const t=dt*2;
   this.dispatch(batch,'transport',{...all,dt:t});
   this.dispatch(batch,'commitTransport',all);
  }
  if(owned)batch.submit();
 }
 pack(batch,withSpray=true){
  const s=this.sim,values={...s.g,pitch:this.pitch,time:s.time,strength:s.state.strength,rockCount:ROCKS.length,slots:this.spraySlots,step:s.steps,enhanced:Number(this.enhanced)};
  this.dispatch(batch,'reconstruct',values);
  if(this.enhanced)this.dispatch(batch,'surfaceDetail',values);
  this.dispatch(batch,'packFields',values);
  if(withSpray)this.dispatch(batch,'rockSpray',values,1);
 }
 initialize(hydrated=false){
  const batch=this.runtime.batch();this.dispatch(batch,'initializeState',{...this.sim.g,rockCount:ROCKS.length,hydrated:Number(hydrated)});batch.submit();
 }
 animateSpray(batch,time){this.dispatch(batch,'sprayVertices',{count:this.particleCount,time},Math.ceil(this.particleCount/128));}
 async metrics(){
  const s=this.sim,batch=this.runtime.batch();
  this.dispatch(batch,'metricsPartials',s.g,Math.ceil(this.metricGroups/128));
  this.dispatch(batch,'metricsFinish',{groups:this.metricGroups,rockCount:ROCKS.length,time:s.time},1);batch.submit();
  const a=await this.runtime.read(this.Result);
  return {maxH:a[0],volume:a[1],foam:a[2],wetCells:a[3],nonfinite:a[4],sprayEmitted:a[5],rockWetReach:a[6],time:a[7]};
 }
 // Explicit testing/export only. Never called by the resident renderer.
 async sync(){
  const s=this.sim,n=s.n,data=await this.runtime.read(this.S,Float32Array,9*n*4,2*n*4);
  FIELDS.slice(2,11).forEach((name,i)=>{s[name]??=new Float32Array(n);s[name].set(data.subarray(i*n,(i+1)*n));});
 }
 dispose(){this.runtime.dispose();}
}
