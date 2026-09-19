import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(`http://127.0.0.1:${server.address().port}/?profile`);
 await page.waitForFunction(()=>window.saltreach?.diagnostics.ready,null,{timeout:120000});
 const report=await page.evaluate(async()=>{
  const app=window.saltreach;app.setPause(true);app.renderer.setAnimationLoop(null);
  const device=app.renderer.backend.device;await device.queue.onSubmittedWorkDone();
  const {ShoreSimulation}=await import('/src/simulation.js'),{CudaSolver}=await import('/src/cuda-solver.js');
  const response=await fetch('/initial-state.bin.gz'),baked=new Float32Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const summary=a=>{const b=a.slice().sort((x,y)=>x-y);return {meanMs:a.reduce((x,y)=>x+y,0)/a.length,medianMs:b[Math.floor(b.length/2)],p95Ms:b[Math.floor(b.length*.95)],samplesMs:a};};
  async function run(resident){
   const sim=new ShoreSimulation();['h','u','v','foam','old','wet','film','qx','qz'].forEach((key,i)=>sim[key].set(baked.subarray(8+i*sim.n,8+(i+1)*sim.n)));sim.time=baked[3];sim.steps=baked[4];
   const solver=await CudaSolver.create(sim,{device}),{nx,nz}=sim.g,textures=Array.from({length:3},()=>device.createTexture({size:[nx,nz],format:'rgba32float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING}));
   let reuse;const samples=[];const before={...solver.runtime.stats};
   try{
    for(let frame=0;frame<110;frame++){
     const start=performance.now();
     if(resident){
      const batch=solver.runtime.batch();solver.step(1/60,batch);solver.step(1/60,batch);solver.pack(batch);solver.animateSpray(batch,sim.time);batch.endPass();
      for(let i=0;i<3;i++)batch.encoder.copyBufferToTexture({buffer:solver.Out.gpuBuffer,offset:i*solver.pitch*nz*16,bytesPerRow:solver.pitch*16,rowsPerImage:nz},{texture:textures[i]},[nx,nz,1]);batch.submit();
     }else{
      solver.step();solver.step();await solver.sync();reuse=sim.pack(reuse);
      for(const [i,key] of ['surface','material','flow'].entries())device.queue.writeTexture({texture:textures[i]},reuse[key],{bytesPerRow:nx*16,rowsPerImage:nz},[nx,nz,1]);
     }
     await device.queue.onSubmittedWorkDone();
     if(frame>=10)samples.push(performance.now()-start);
    }
    return {...summary(samples),dataUploadBytes:solver.runtime.stats.dataBytesUploaded-before.dataBytesUploaded,readbackBytes:solver.runtime.stats.readbackBytes-before.readbackBytes,textureUploadBytes:resident?0:110*sim.n*3*16};
   }finally{textures.forEach(t=>t.destroy());solver.dispose();}
  }
  // Alternate order to limit warm-up / thermal bias; each sample awaits GPU completion.
  const rounds=[];
  for(let i=0;i<3;i++){
   let legacy,resident;if(i%2){resident=await run(true);legacy=await run(false);}else{legacy=await run(false);resident=await run(true);}
   rounds.push({legacy,resident,speedup:legacy.meanMs/resident.meanMs});
  }
  const legacyMeanMs=rounds.reduce((s,r)=>s+r.legacy.meanMs,0)/3,residentMeanMs=rounds.reduce((s,r)=>s+r.resident.meanMs,0)/3;
  return {description:'Two 60 Hz simulation steps plus production of three render textures; each sample waits for completed GPU work. Drawing is paused. Resident includes CUDA spray; legacy excludes CPU spray, conservatively favouring legacy.',grid:[241,401],samplesPerRound:100,warmupPerRound:10,rounds,legacyMeanMs,residentMeanMs,speedup:legacyMeanMs/residentMeanMs,notAnFpsBenchmark:true};
 });
 await writeFile('reports/pipeline-performance.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,rounds:report.rounds.map(r=>({legacyMs:r.legacy.meanMs,residentMs:r.resident.meanMs,speedup:r.speedup}))},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
