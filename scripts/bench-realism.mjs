import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.saltreach?.diagnostics.ready,null,{timeout:120000});
 const report=await page.evaluate(async()=>{
  const app=window.saltreach;app.setPause(true);app.renderer.setAnimationLoop(null);
  const device=app.renderer.backend.device;await device.queue.onSubmittedWorkDone();
  const {GpuState}=await import('/src/gpu-state.js'),{CudaSolver,FIELDS}=await import('/src/cuda-solver.js');
  const response=await fetch('/initial-state.bin.gz'),baked=new Float32Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  async function run(enhanced){
   const sim=new GpuState();FIELDS.slice(2,11).forEach((key,i)=>sim[key]=baked.subarray(8+i*sim.n,8+(i+1)*sim.n));sim.time=baked[3];sim.steps=baked[4];
   const solver=await CudaSolver.create(sim,{device,enhanced});solver.initialize(true);
   const {nx,nz}=sim.g,textures=Array.from({length:3},()=>device.createTexture({size:[nx,nz],format:'rgba32float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING}));
   const samples=[];const before={...solver.runtime.stats};
   try{
    await device.queue.onSubmittedWorkDone();
    for(let frame=0;frame<110;frame++){
     const start=performance.now(),batch=solver.runtime.batch();solver.step(1/60,batch);solver.step(1/60,batch);solver.pack(batch);solver.animateSpray(batch,sim.time);batch.endPass();
     for(let i=0;i<3;i++)batch.encoder.copyBufferToTexture({buffer:solver.Out.gpuBuffer,offset:i*solver.pitch*nz*16,bytesPerRow:solver.pitch*16,rowsPerImage:nz},{texture:textures[i]},[nx,nz,1]);batch.submit();
     await device.queue.onSubmittedWorkDone();if(frame>=10)samples.push(performance.now()-start);
    }
    const sorted=samples.slice().sort((a,b)=>a-b);
    return {meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:sorted[95],samplesMs:samples,readbackBytes:solver.runtime.stats.readbackBytes-before.readbackBytes,dataUploadBytes:solver.runtime.stats.dataBytesUploaded-before.dataBytesUploaded};
   }finally{textures.forEach(t=>t.destroy());solver.dispose();}
  }
  const rounds=[];
  for(let i=0;i<3;i++){
   let original,enhanced;if(i%2){enhanced=await run(true);original=await run(false);}else{original=await run(false);enhanced=await run(true);}rounds.push({original,enhanced});
  }
  const originalMeanMs=rounds.reduce((s,r)=>s+r.original.meanMs,0)/3,enhancedMeanMs=rounds.reduce((s,r)=>s+r.enhanced.meanMs,0)/3;
  return {description:'Both GPU-resident: two 60 Hz solver steps, packing, spray, three texture copies, await GPU completion. Drawing paused. Three alternating-order rounds, 10 warm-up + 100 measured updates each. Wall time includes command submission and completion notification; not an FPS benchmark.',grid:[241,401],originalMeanMs,enhancedMeanMs,additionalMs:enhancedMeanMs-originalMeanMs,rounds};
 });
 await writeFile('reports/realism-performance.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,rounds:report.rounds.map(r=>({original:r.original.meanMs,enhanced:r.enhanced.meanMs}))},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
