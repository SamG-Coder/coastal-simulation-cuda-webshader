// Development-only export: warm the current terrain/model entirely on WebGPU.
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createServer} from './serve.mjs';
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();
 await page.route('**/tests/gpu.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/gpu.html`);
 const result=await page.evaluate(async()=>{
  const {GpuState}=await import('/src/gpu-state.js'),{CudaSolver}=await import('/src/cuda-solver.js');
  const sim=new GpuState(),solver=await CudaSolver.create(sim);
  try{
   solver.initialize();
   for(let block=0;block<36;block++){
    const batch=solver.runtime.batch();for(let i=0;i<60;i++)solver.step(1/60,batch);batch.submit();await solver.runtime.idle();
   }
   const metrics=await solver.metrics();if(metrics.nonfinite||metrics.maxH>10)throw Error('Unstable state');
   const fields=await solver.runtime.read(solver.S,Float32Array,9*sim.n*4,2*sim.n*4);
   const data=new Float32Array(8+fields.length);data.set([185,sim.g.nx,sim.g.nz,sim.time,sim.steps,1,0,0]);data.set(fields,8);
   const bytes=new Uint8Array(data.buffer);let encoded='';for(let i=0;i<bytes.length;i+=32768)encoded+=String.fromCharCode(...bytes.subarray(i,i+32768));
   return {base64:btoa(encoded),metrics};
  }finally{solver.dispose();}
 });
 const compressed=gzipSync(Buffer.from(result.base64,'base64'));
 await writeFile(new URL('../initial-state.bin.gz',import.meta.url),compressed);
 console.log(JSON.stringify({bytes:compressed.length,metrics:result.metrics}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
