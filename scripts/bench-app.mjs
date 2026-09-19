import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(`http://127.0.0.1:${server.address().port}/?profile`);
 await page.waitForFunction(()=>window.saltreach?.diagnostics.ready,null,{timeout:120000});
 await page.waitForTimeout(2000);
 const result=await page.evaluate(async()=>{
  const app=window.saltreach,recorded=[],history=app.diagnostics.frameTimes,originalPush=history.push;
  history.push=function(...values){recorded.push(...values);return originalPush.apply(this,values);};
  const start=app.snapshot(),at=performance.now();
  await new Promise(r=>setTimeout(r,8000));
  const elapsed=(performance.now()-at)/1000,end=app.snapshot();
  history.push=originalPush;
  const frames=recorded.sort((a,b)=>a-b);
  return {viewport:[innerWidth,innerHeight],elapsed,frames:frames.length,fps:frames.length/elapsed,frameMeanMs:frames.reduce((a,b)=>a+b,0)/frames.length,frameP95Ms:frames[Math.floor(frames.length*.95)],simulationRate:(end.time-start.time)/elapsed,start,end};
 });
 result.mode='GPU resident';result.note='Exploratory browser-paced FPS; not completed-GPU throughput. See realism-performance.json for the controlled benchmark.';
 await writeFile(process.argv[2]||'reports/performance-current.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
