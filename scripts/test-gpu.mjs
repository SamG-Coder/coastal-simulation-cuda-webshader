import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
import {createServer} from './serve.mjs';
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/gpu.html`);
 await page.waitForFunction(()=>window.__gpuReport!==undefined,null,{timeout:180000});
 const report=await page.evaluate(()=>window.__gpuReport);
 await mkdir('reports',{recursive:true});
 await writeFile('reports/gpu-validation.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 if(!report.passed)process.exitCode=1;
}finally{await browser?.close();await new Promise(r=>server.close(r));}
