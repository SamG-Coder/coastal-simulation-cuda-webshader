import {enableSolverAcceleration} from './solver-accelerator.js?v=1.3.0';
import {ShoreSimulation} from './simulation.js?v=1.3.0';
const sim=new ShoreSimulation();
let paused=true,ready=false,publishCount=0,allocated=0,timer=null,lastWall=0,debt=0,nextPublish=0,packetInterval=1/30;
const pool=[];
let profiling=false,stepMs=0,stepCount=0,stepPeak=0;

// The worker owns elapsed time. A delayed drawing frame must not slow the sea.
// Only three transferable packet sets may exist: rendering, interpolation and
// transit share them. If the page cannot consume one, solve without publishing.
// The next deadline includes time already spent solving and packing. Waiting
// a fresh interval after that work produces unnecessary catch-up bursts.
function schedule(){clearTimeout(timer);if(!paused&&ready)timer=setTimeout(tick,Math.max(1,(1/60-debt)*1000-(performance.now()-lastWall)));}
function tick(){
 if(paused||!ready)return;
 const now=performance.now();debt+=(now-lastWall)/1000;lastWall=now;
 const count=Math.min(6,Math.floor((debt+1e-7)*60));
 const stepStart=profiling?performance.now():0;
 for(let i=0;i<count;i++)sim.step(1/60);
 if(profiling&&count){const elapsed=performance.now()-stepStart;stepMs+=elapsed;stepCount+=count;stepPeak=Math.max(stepPeak,elapsed/count);}
 debt-=count/60;
 if(sim.time>=nextPublish&&(pool.length||allocated<3)){publish();nextPublish=sim.time+packetInterval-.00001;}
 schedule();
}
function resume(){lastWall=performance.now();debt=0;nextPublish=sim.time;schedule();}
function publish(type='frame'){
 const reuse=pool.pop();if(!reuse)allocated++;const packStart=profiling?performance.now():0;const p=sim.pack(reuse);const profile=profiling?{kernel:sim.kernels?'WebAssembly':'JavaScript',stepMeanMs:stepMs/Math.max(1,stepCount),stepPeakMs:stepPeak,packMs:performance.now()-packStart,reconstructionMs:sim.reconstructionMs,debtMs:debt*1000,steps:stepCount}:undefined;postMessage({type,...p,profile,metrics:type!=='frame'||publishCount++%6===0?sim.metrics():undefined},[p.surface.buffer,p.material.buffer,p.flow.buffer]);
}
onmessage=async ({data})=>{
 if(data.type==='init'){
  profiling=!!data.profile;
  await enableSolverAcceleration(sim);
  // A reproducible procedural warm start avoids an empty shoreline on opening.
  // If unavailable, generate exactly the same state locally in this worker.
  let hydrated=false;
  try{
   const response=await fetch(new URL('../initial-state.bin.gz',import.meta.url));
   if(!response.ok)throw new Error('No baked state');
   const raw=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
   const a=new Float32Array(raw),keys=['h','u','v','foam','old','wet','film','qx','qz'];
   if(a[0]!==185||a[1]!==sim.g.nx||a[2]!==sim.g.nz||a.length!==8+sim.n*keys.length)throw new Error('Incompatible state');
   keys.forEach((key,i)=>sim[key].set(a.subarray(8+i*sim.n,8+(i+1)*sim.n)));
   sim.time=a[3];sim.steps=a[4];hydrated=true;
   postMessage({type:'progress',value:1});
  }catch{}
  for(let block=0;!hydrated&&block<9;block++){
   for(let i=0;i<240;i++)sim.step(1/60);
   postMessage({type:'progress',value:(block+1)/9});
   await new Promise(r=>setTimeout(r,0));
  }
  ready=true;publish('ready');
 }else if(data.type==='recycle'){
  if(pool.length<3)pool.push({surface:data.surface,material:data.material,flow:data.flow});
 }else if(data.type==='step'&&ready){
  if(!paused)for(let i=0;i<data.count;i++)sim.step(1/60);
  publish();
 }else if(data.type==='configure')sim.configure(data.value);
 else if(data.type==='pause'){paused=data.value;if(paused)clearTimeout(timer);else resume();}
 else if(data.type==='quality')packetInterval=data.interval;
};
