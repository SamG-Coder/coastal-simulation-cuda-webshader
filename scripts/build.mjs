import {cp,mkdir,rm,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve,dirname} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url)),dist=resolve(root,'dist');
if(dirname(dist)!==resolve(root))throw Error('Build output must be inside the project root.');
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
for(const name of ['index.html','style.css','initial-state.bin.gz','src','vendor','README.md','LICENSE','CREDITS.md']){
 await cp(join(root,name),join(dist,name),{recursive:true});
}
await writeFile(join(dist,'.nojekyll'),'');
for(const forbidden of ['tests','src/worker.js','src/simulation.js','src/solver-kernels.wasm','src/solver-accelerator.js','src/spray.js','src/noise.js']){
 const exists=await access(join(dist,forbidden)).then(()=>true,()=>false);
 if(exists)throw Error(`Development/CPU fallback code must not be deployed: ${forbidden}`);
}
console.log('Static site built in dist/');
