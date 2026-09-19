// Opt-in measurements only: the normal experience does not issue GPU queries.
const summary=values=>{
 if(!values.length)return null;
 const sorted=values.slice().sort((a,b)=>a-b);
 return {mean:values.reduce((a,b)=>a+b,0)/values.length,p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],max:sorted.at(-1)};
};
export class FrameProfile{
 constructor(){this.run=null;this.queryPending=false;}
 record(frameMs,cpuMs,renderer){
  const run=this.run;
  if(run){run.frame.push(frameMs);run.cpu.push(cpuMs);run.triangles=renderer.info.render.triangles;run.drawCalls=renderer.info.render.drawCalls;}
  if(renderer.backend.trackTimestamp&&!this.queryPending){
   this.queryPending=true;
   renderer.resolveTimestampsAsync().then(ms=>{if(run&&this.run===run&&Number.isFinite(ms))run.gpu.push(ms);}).finally(()=>{this.queryPending=false;});
  }
 }
 async measure(seconds,snapshot){
  if(this.run)throw new Error('A measurement is already running');
  if(!Number.isFinite(seconds)||seconds<5||seconds>30)throw new Error('Use 5–30 seconds');
  const start=snapshot(),at=performance.now(),heap=performance.memory?.usedJSHeapSize;
  const run=this.run={frame:[],cpu:[],gpu:[]};
  await new Promise(resolve=>setTimeout(resolve,seconds*1000));
  this.run=null;
  const elapsed=(performance.now()-at)/1000,end=snapshot(),canvas=document.querySelector('canvas');
  return this.last={seconds:elapsed,frames:run.frame.length,frameMs:summary(run.frame),cpuMs:summary(run.cpu),gpuMs:summary(run.gpu),simulationRate:(end.renderTime-start.renderTime)/elapsed,triangles:run.triangles,drawCalls:run.drawCalls,viewport:[innerWidth,innerHeight],buffer:[canvas.width,canvas.height],devicePixelRatio,heapBytes:{start:heap,end:performance.memory?.usedJSHeapSize},userAgent:navigator.userAgent,start,end};
 }
}
