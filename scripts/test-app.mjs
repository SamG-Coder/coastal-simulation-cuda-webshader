import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
import {createServer} from './serve.mjs';
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],loaded=[];
 page.on('request',r=>loaded.push(r.url()));
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}/?profile`);
 await page.waitForFunction(()=>window.saltreach?.diagnostics.ready||!document.querySelector('#error').hidden,null,{timeout:120000});
 if(!await page.evaluate(()=>window.saltreach?.diagnostics.ready))throw Error(await page.locator('#error-detail').textContent());
 await page.evaluate(()=>{
  const resident=window.saltreach.resident;
  if('step' in resident.sim||'pack' in resident.sim||'h' in resident.sim)throw Error('CPU solver/state remains in the application');
  resident.solver.sync=()=>{throw Error('Full-state readback used in render path');};
  resident.sim.pack=resident.sim.step=()=>{throw Error('CPU simulation/packing used in render path');};
 });
 await page.waitForFunction(()=>window.saltreach.time>39,null,{timeout:30000});
 const initial=await page.evaluate(()=>({...window.saltreach.snapshot(),solver:window.saltreach.diagnostics.solver}));
 await page.screenshot({path:'reports/coastal-cuda.png'});
 await page.evaluate(()=>{window.saltreach.setPause(true);window.saltreach.configure({strength:1.5,wind:12,tide:.15});});
 await page.waitForTimeout(200);
 const pausedAt=await page.evaluate(()=>window.saltreach.time);
 await page.waitForTimeout(400);
 const pauseStable=pausedAt===await page.evaluate(()=>window.saltreach.time);
 // Verify actual sampled renderer textures, including aligned row padding.
 const textureCopies=await page.evaluate(async()=>{
  const app=window.saltreach,gpu=app.resident.solver,device=gpu.runtime.device,{nx,nz}=gpu.sim.g,row=gpu.pitch*16,size=row*nz;
  const staging=device.createBuffer({size:size*3,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
   const encoder=device.createCommandEncoder();
   for(const [i,key] of ['surface','material','flow'].entries())encoder.copyTextureToBuffer({texture:app.renderer.backend.get(app.fields[key]).texture},{buffer:staging,offset:i*size,bytesPerRow:row,rowsPerImage:nz},[nx,nz,1]);
   device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);
   const actual=new Float32Array(staging.getMappedRange().slice(0)),expected=await gpu.runtime.read(gpu.Out);let maxError=0;
   for(let f=0;f<3;f++)for(let j=0;j<nz;j++)for(let i=0;i<nx*4;i++){const k=f*size/4+j*row/4+i;maxError=Math.max(maxError,Math.abs(actual[k]-expected[k]));}
   return {maxError,passed:maxError===0};
  }finally{staging.destroy();}
 });
 await page.evaluate(()=>window.saltreach.setPause(false));
 await page.waitForFunction(t=>window.saltreach.time>t+.5,pausedAt,{timeout:10000});
 const resumed=await page.evaluate(()=>window.saltreach.snapshot());
 const noFieldUploads=initial.worker.stats.dataBytesUploaded===resumed.worker.stats.dataBytesUploaded;
 const cachedBindings=initial.worker.stats.bindGroupsCreated===resumed.worker.stats.bindGroupsCreated;
 const report={passed:initial.solver==='CUDA WebShader / WebGPU'&&pauseStable&&errors.length===0&&resumed.errors.length===0&&resumed.metrics.nonfinite===0&&noFieldUploads&&cachedBindings&&textureCopies.passed,initial,pauseStable,noFieldUploads,cachedBindings,textureCopies,resumed,errors};
 await page.goto(`http://127.0.0.1:${server.address().port}/?solver=cpu&webgl`);
 await page.waitForFunction(()=>window.saltreach?.diagnostics.ready,null,{timeout:120000});
 report.obsoleteFallbackQuery=await page.evaluate(()=>({ready:window.saltreach.diagnostics.ready,solver:window.saltreach.diagnostics.solver,backend:window.saltreach.diagnostics.backend,workers:typeof window.saltreach.resident.sim.step}));
 report.noCpuModulesLoaded=!loaded.some(url=>/\/(reference|worker\.js|simulation\.js|solver-accelerator\.js|solver-kernels\.wasm|noise\.js|spray\.js)/.test(new URL(url).pathname));
 report.passed&&=report.obsoleteFallbackQuery.solver==='CUDA WebShader / WebGPU'&&report.obsoleteFallbackQuery.backend==='WebGPU'&&report.noCpuModulesLoaded;
 await page.route('**/coastal-kernels.cu',route=>route.fulfill({status:503,body:'Unavailable for error-path test'}));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>!document.querySelector('#error').hidden,null,{timeout:120000});
 report.cudaFailure=await page.evaluate(()=>({message:document.querySelector('#error-detail').textContent,fallback:!!document.querySelector('#error a'),ready:window.saltreach?.diagnostics.ready}));
 report.passed&&=report.cudaFailure.message.includes('CUDA source: HTTP 503')&&!report.cudaFailure.fallback&&report.cudaFailure.ready!==true;
 await page.unroute('**/coastal-kernels.cu');
 await page.route('**/initial-state.bin.gz',route=>route.fulfill({status:404,body:'Cold-start test'}));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.saltreach?.diagnostics.ready||!document.querySelector('#error').hidden,null,{timeout:120000});
 report.coldStart=await page.evaluate(()=>({ready:window.saltreach?.diagnostics.ready,time:window.saltreach?.time,metrics:window.saltreach?.diagnostics.metrics,error:document.querySelector('#error-detail').textContent}));
 report.passed&&=report.coldStart.ready&&report.coldStart.time>=36-.000001&&report.coldStart.metrics.nonfinite===0;
 const unavailable=await browser.newPage();
 await unavailable.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined}));
 await unavailable.goto(`http://127.0.0.1:${server.address().port}/`);
 await unavailable.waitForFunction(()=>!document.querySelector('#error').hidden);
 report.webgpuRequired=await unavailable.evaluate(()=>({message:document.querySelector('#error-detail').textContent,canvas:!!document.querySelector('canvas'),fallback:!!document.querySelector('#error a')}));
 report.passed&&=report.webgpuRequired.message.includes('WebGPU is unavailable')&&!report.webgpuRequired.canvas&&!report.webgpuRequired.fallback;
 await unavailable.close();
 await mkdir('reports',{recursive:true});await writeFile('reports/app-validation.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}finally{await browser?.close();await new Promise(r=>server.close(r));}
