import * as THREE from 'three/webgpu';
import {instanceIndex,positionLocal,cameraWorldMatrix,color,mix,float,smoothstep,length,uv,varying} from 'three/tsl';

export class GpuSpray {
 constructor(scene,shaders,shared,count){
  const geometry=new THREE.PlaneGeometry(1,1);
  const material=new THREE.MeshBasicNodeMaterial({transparent:true,depthWrite:false});
  const center=shared.node.element(instanceIndex.mul(2)),size=shared.node.element(instanceIndex.mul(2).add(1));
  material.positionNode=center.xyz.add(cameraWorldMatrix[0].xyz.mul(positionLocal.x.mul(size.x))).add(cameraWorldMatrix[1].xyz.mul(positionLocal.y.mul(size.y)));
  material.colorNode=color('#c9d9d3').mul(mix(1,.7,shaders.U.overcast));
  material.opacityNode=varying(center.w).mul(float(1).sub(smoothstep(.12,.5,length(uv().sub(.5)))));
  this.mesh=new THREE.InstancedMesh(geometry,material,count);this.mesh.frustumCulled=false;this.mesh.renderOrder=4;
  scene.add(this.mesh);this.totalEmitted=0;
 }
 update(){} // CUDA computes particle motion; no per-frame attribute uploads.
}
