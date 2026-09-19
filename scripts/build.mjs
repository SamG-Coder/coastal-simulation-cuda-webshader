import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve,dirname} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url)),dist=resolve(root,'dist');
if(dirname(dist)!==resolve(root))throw Error('Build output must be inside the project root.');
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
for(const name of ['index.html','style.css','initial-state.bin.gz','src','vendor','README.md','LICENSE','CREDITS.md']){
 await cp(join(root,name),join(dist,name),{recursive:true});
}
await writeFile(join(dist,'.nojekyll'),'');
console.log('Static site built in dist/');
