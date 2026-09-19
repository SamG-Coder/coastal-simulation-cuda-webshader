import {readFile} from 'node:fs/promises';
import {compile} from '../vendor/cuda-webshader/compiler/compiler.js';
import {ENTRIES} from '../src/cuda-solver.js';
const source=(await Promise.all(['coastal-kernels.cu','coastal-render.cu'].map(name=>readFile(new URL('../src/'+name,import.meta.url),'utf8')))).join('\n');
for(const entry of ENTRIES){
 const artifact=compile(source,{entry,workgroupSize:[128,1,1]});
 if(!artifact.wgsl.includes('@compute'))throw Error(`${entry}: missing compute shader`);
 console.log(`${entry}: compiled`);
}
