import * as THREE from 'three/webgpu';
import {axis,land} from './terrain-grid.js?v=1.3.0';
import {terrainHeight,rockTop,ROCKS,shoreline,smooth,GRID} from './coast.js?v=1.3.0';
export function gridGeometry(xs,zs,height){
 const nx=xs.length,nz=zs.length,positions=new Float32Array(nx*nz*3),indices=[];
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const k=(j*nx+i)*3;positions[k]=xs[i];positions[k+1]=height(xs[i],zs[j]);positions[k+2]=zs[j];
  if(i<nx-1&&j<nz-1){let a=j*nx+i,b=a+1,c=a+nx,d=c+1;indices.push(a,c,b,b,c,d);}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();return g;
}
export function buildWorld(scene,shaders){
 const terrain=new THREE.Mesh(gridGeometry(axis(GRID.x0,22,GRID.dx,1600),axis(GRID.z0,28,GRID.dz,2200),land),shaders.sand);
 terrain.receiveShadow=true;scene.add(terrain);
 const rocks=[];
 for(const r of ROCKS){
  const positions=[],indices=[],N=100,R=34;
  for(let j=0;j<=R;j++)for(let i=0;i<=N;i++){
   const theta=i/N*Math.PI*2,rr=j/R;
   // Superelliptic footprint exactly matches the obstacle height function.
   const edge=1+.075*Math.sin(theta*3+r.seed)+.037*Math.cos(theta*5-r.seed);
   const ct=Math.cos(theta),st=Math.sin(theta),shape=Math.pow(Math.abs(ct)**2.65+Math.abs(st)**2.65,-1/2.65);
   const a=ct*rr*edge*shape,b=st*rr*edge*shape;
   const x=r.x+r.c*a*r.rx-r.s*b*r.rz,z=r.z+r.s*a*r.rx+r.c*b*r.rz;
   let y=j===R?r.base-.10:rockTop(x,z,r);
   positions.push(x,Math.max(r.base-.12,y),z);
   if(j<R&&i<N){const k=j*(N+1)+i;indices.push(k,k+1,k+N+1,k+1,k+N+2,k+N+1);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('wetLevel',new THREE.Float32BufferAttribute(new Float32Array(positions.length/3).fill(.24),1));g.setIndex(indices);g.computeVertexNormals();
  // Broad geological faces control the light response; the retained small
  // geometric strata and TSL grain should not become sunlit corrugated stripes.
  const normals=g.attributes.normal,n=new THREE.Vector3(),broad=new THREE.Vector3();
  for(let j=0;j<R;j++)for(let i=0;i<=N;i++){
   const k=j*(N+1)+i,x=positions[k*3],z=positions[k*3+2],e=.055;
   const blend=smooth(.94,.70,j/R);if(blend===0)continue;
   const gx=(rockTop(x+e,z,r,0)-rockTop(x-e,z,r,0))/(2*e),gz=(rockTop(x,z+e,r,0)-rockTop(x,z-e,r,0))/(2*e);
   if(Math.abs(gx)+Math.abs(gz)>60)continue;
   broad.set(-gx,1,-gz).normalize();n.fromBufferAttribute(normals,k).lerp(broad,blend).normalize();normals.setXYZ(k,n.x,n.y,n.z);
  }
  const m=new THREE.Mesh(g,shaders.rock);m.castShadow=m.receiveShadow=true;m.userData.rock=r;m.userData.wetReach=.24;scene.add(m);rocks.push(m);
 }
 const waterGeometry=gridGeometry(axis(GRID.x0,58,GRID.dx,2600),axis(GRID.z0,28,GRID.dz,2600),()=>0);
 const positions=waterGeometry.attributes.position,bed=new Float32Array(positions.count);
 for(let i=0;i<positions.count;i++)bed[i]=land(positions.getX(i),positions.getZ(i));
 waterGeometry.setAttribute('sandHeight',new THREE.BufferAttribute(bed,1));
 const water=new THREE.Mesh(waterGeometry,shaders.water);
 water.frustumCulled=false;water.renderOrder=3;scene.add(water);scene.add(shaders.mirror.target);
 const sky=new THREE.Mesh(new THREE.SphereGeometry(4200,48,24),shaders.skyMaterial);sky.renderOrder=-100;sky.frustumCulled=false;scene.add(sky);
 const light=shaders.sunLight;light.position.copy(shaders.U.sun.value).multiplyScalar(90);light.castShadow=true;
 // Fixed rocks and pebbles cast static geometry shadows. Lighting and quality
 // changes explicitly invalidate this map; wetness does not change silhouettes.
 light.shadow.autoUpdate=false;light.shadow.needsUpdate=true;
 light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-48;light.shadow.camera.right=48;light.shadow.camera.top=48;light.shadow.camera.bottom=-48;light.shadow.camera.near=2;light.shadow.camera.far=180;light.shadow.bias=-.00025;light.shadow.normalBias=.02;
 light.target.position.set(2,0,-25);light.position.add(light.target.position);scene.add(light,light.target);
 const hemi=new THREE.HemisphereLight('#c4dce9','#908470',1.2);scene.add(hemi);
 scene.fog=new THREE.FogExp2('#b4c5cb',.00064);
 // Sparse small stones and shell fragments at the margins of the main groups.
 let seed=712;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const pebbleG=new THREE.IcosahedronGeometry(1,1);
 pebbleG.setAttribute('wetLevel',new THREE.Float32BufferAttribute(new Float32Array(pebbleG.attributes.position.count).fill(.2),1));
 const pebbles=new THREE.InstancedMesh(pebbleG,shaders.rock,240);const dummy=new THREE.Object3D();
 for(let i=0;i<240;i++){
  const r=ROCKS[Math.floor(rand()*ROCKS.length)],a=rand()*Math.PI*2,d=1.2+rand()*2.1;
  const x=r.x+Math.cos(a)*r.rx*d,z=r.z+Math.sin(a)*r.rz*d;
  const scale=.025+rand()**3*.17;
  dummy.position.set(x,terrainHeight(x,z)+scale*.25,z);dummy.scale.set(scale,scale*(.24+rand()*.4),scale*(.6+rand()));dummy.rotation.set(rand(),rand()*6,rand());dummy.updateMatrix();pebbles.setMatrixAt(i,dummy.matrix);
 }
 pebbles.castShadow=pebbles.receiveShadow=true;scene.add(pebbles);
 return {terrain,water,rocks,sky,light,hemi,pebbles};
}
