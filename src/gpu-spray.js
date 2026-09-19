import * as THREE from 'three/webgpu';
import {instanceIndex,positionLocal,cameraWorldMatrix,color,mix,float,smoothstep,length,uv,varying,texture,vec2} from 'three/tsl';

export class GpuSpray {
 constructor(scene,shaders,shared,count){
  const geometry=new THREE.PlaneGeometry(1,1);
  const material=new THREE.MeshBasicNodeMaterial({transparent:true,depthWrite:false});
  const center=shared.node.element(instanceIndex.mul(2)),size=shared.node.element(instanceIndex.mul(2).add(1));
  material.positionNode=center.xyz.add(cameraWorldMatrix[0].xyz.mul(positionLocal.x.mul(size.x))).add(cameraWorldMatrix[1].xyz.mul(positionLocal.y.mul(size.y)));
  const kind=varying(size.z),seed=varying(size.w);
  const breakup=texture(shaders.noiseTex,uv().mul(.055).add(vec2(seed,seed.mul(.73)))).g;
  const edge=float(1).sub(smoothstep(.12,.5,length(uv().sub(.5))));
  const mistShape=smoothstep(.22,.7,breakup).mul(edge);
  material.colorNode=mix(color('#eef7fa'),color('#fff9e9'),float(1).sub(shaders.U.overcast).mul(.35));
  material.opacityNode=varying(center.w).mul(mix(edge,mistShape,kind.clamp()));
  this.mesh=new THREE.InstancedMesh(geometry,material,count);this.mesh.frustumCulled=false;this.mesh.renderOrder=4;
  scene.add(this.mesh);this.totalEmitted=0;
 }
 update(){} // CUDA computes particle motion; no per-frame attribute uploads.
}
