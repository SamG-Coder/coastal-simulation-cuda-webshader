import * as THREE from 'three/webgpu';
import {storage} from 'three/tsl';

// Pinned r185 backend adapter. The renderer owns resources on its own device;
// CUDA borrows their buffers and copies its output directly to their textures.
function check(renderer,solver){
 if(THREE.REVISION!=='185'||!renderer.backend.isWebGPUBackend||renderer.backend.device!==solver.runtime.device)throw Error('GPU interop requires Three r185 and the same WebGPU device.');
}
export function shareStorage(renderer,solver,key,width=1){
 check(renderer,solver);
 const old=solver[key],array=new Float32Array(old.byteLength/4);
 const attribute=new THREE.StorageInstancedBufferAttribute(array,width);attribute.name=key;
 renderer.backend.createStorageAttribute(attribute);
 const buffer=renderer.backend.get(attribute).buffer;
 if(!buffer)throw Error(`Missing shared GPU buffer: ${key}`);
 const resource=solver.runtime.importBuffer(buffer,old.byteLength,key);
 solver.runtime.batch().copy(old,resource).submit();
 solver.runtime.destroyBuffer(old);solver[key]=resource;solver.bindings.clear();
 return {attribute,node:storage(attribute,width===4?'vec4':'float',array.length/width).toReadOnly()};
}
export function initializeFieldTextures(renderer,solver,fields){
 check(renderer,solver);
 for(const key of ['surface','previous','material','previousMaterial','flow','previousFlow']){
  const texture=fields[key];renderer.initTexture(texture);
  const gpu=renderer.backend.get(texture).texture;
  if(!gpu||gpu.format!=='rgba32float'||!(gpu.usage&GPUTextureUsage.COPY_DST))throw Error(`Unsupported GPU field texture: ${key}`);
 }
}
export function copyFields(renderer,solver,fields,batch,initial=false){
 batch.endPass();
 const {nx,nz}=solver.sim.g,row=solver.pitch*16,size=row*nz;
 for(const [i,key,previous] of [[0,'surface','previous'],[1,'material','previousMaterial'],[2,'flow','previousFlow']]){
  if(!initial){const spare=fields[previous];fields[previous]=fields[key];fields[key]=spare;}
  for(const name of initial?[key,previous]:[key]){
   batch.encoder.copyBufferToTexture({buffer:solver.Out.gpuBuffer,offset:i*size,bytesPerRow:row,rowsPerImage:nz},{texture:renderer.backend.get(fields[name]).texture},[nx,nz,1]);
  }
 }
}
export function makeGpuNoise(renderer,solver,size=512){
 check(renderer,solver);
 const texture=new THREE.DataTexture(new Uint8Array(size*size*4),size,size,THREE.RGBAFormat);
 texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;
 texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
 renderer.initTexture(texture);
 solver.Noise=solver.runtime.createBuffer(size*size*4);
 const batch=solver.runtime.batch();solver.dispatch(batch,'generateNoise',{size},Math.ceil(size*size/128));batch.endPass();
 batch.encoder.copyBufferToTexture({buffer:solver.Noise.gpuBuffer,bytesPerRow:size*4},{texture:renderer.backend.get(texture).texture},[size,size,1]);batch.submit();
 renderer.backend.generateMipmaps(texture);
 return texture;
}
