import {readFile,readdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const aliases={'three':'vendor/three.webgpu.js','three/webgpu':'vendor/three.webgpu.js','three/tsl':'vendor/three.tsl.js'};
const seen=new Set();
async function visit(path){
 if(seen.has(path))return;seen.add(path);
 const text=await readFile(path,'utf8');
 // All application imports are literal ES module imports. Include literal
 // dynamic imports and worker URLs so future additions cannot evade the audit.
 const imports=/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\bnew\s+URL\(\s*)['"]([^'"]+)['"]/g;
 for(const [,specifier] of text.matchAll(imports)){
  const clean=specifier.split('?')[0];
  // Vendor documentation contains external example imports; only local
  // deployment dependencies are part of this closure.
  if(!clean.startsWith('.')&&!aliases[clean])continue;
  if(!clean.endsWith('.js')&&!aliases[clean])continue;
  const target=aliases[clean]?resolve(root,aliases[clean]):resolve(dirname(path),clean);
  if(!target.startsWith(root))throw Error(`Import leaves the project: ${specifier}`);
  await visit(target);
 }
}
async function files(path){
 const result=[];for(const entry of await readdir(path,{withFileTypes:true})){
  const full=resolve(path,entry.name);if(entry.isDirectory())result.push(...await files(full));else if(entry.name.endsWith('.js'))result.push(full);
 }return result;
}
await visit(resolve(root,'src/main.js'));
const shipped=[...await files(resolve(root,'src')),...await files(resolve(root,'vendor'))];
const unused=shipped.filter(path=>!seen.has(path));
if(unused.length)throw Error(`Unreachable deployed modules: ${unused.map(p=>relative(root,p)).join(', ')}`);
console.log(`Import audit: all ${shipped.length} deployed JavaScript modules are reachable; no missing imports.`);
