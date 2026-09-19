import * as THREE from 'three/webgpu';
import {attribute,uv,float,color,smoothstep,length,mix} from 'three/tsl';
import {GRID,ROCKS,rockTop,clamp} from './coast.js?v=1.3.0';
export function sampleField(data,x,z,component=0){
 const ix=clamp((x-GRID.x0)/GRID.dx,0,GRID.nx-1.001),iz=clamp((z-GRID.z0)/GRID.dz,0,GRID.nz-1.001),i=ix|0,j=iz|0,a=ix-i,b=iz-j;
 const k=(j*GRID.nx+i)*4+component;
 return (data[k]*(1-a)+data[k+4]*a)*(1-b)+(data[k+GRID.nx*4]*(1-a)+data[k+(GRID.nx+1)*4]*a)*b;
}
export class ContactSpray{
 constructor(scene,shaders){
  this.count=240;this.cursor=0;this.seed=871;this.totalEmitted=0;this.particles=[];this.last=ROCKS.map(()=>({level:0,time:0,hit:-10}));
  const geometry=new THREE.PlaneGeometry(1,1);this.alpha=new THREE.InstancedBufferAttribute(new Float32Array(this.count),1);this.alpha.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('sprayAlpha',this.alpha);
  const material=new THREE.MeshBasicNodeMaterial({transparent:true,depthWrite:false});material.colorNode=color('#c9d9d3').mul(mix(1,.7,shaders.U.overcast));material.opacityNode=attribute('sprayAlpha','float').mul(float(1).sub(smoothstep(.12,.5,length(uv().sub(.5)))));
  this.mesh=new THREE.InstancedMesh(geometry,material,this.count);this.mesh.frustumCulled=false;this.mesh.renderOrder=4;this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(this.mesh);this.dummy=new THREE.Object3D();
  for(let i=0;i<this.count;i++){this.dummy.scale.setScalar(0);this.dummy.updateMatrix();this.mesh.setMatrixAt(i,this.dummy.matrix);}
 }
 random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
 arrival(data){
  const {surface,flow,time,state}=data;
  ROCKS.forEach((r,index)=>{
   const x=r.x+r.rx*1.1,z=r.z,level=sampleField(surface,x,z),speed=-sampleField(flow,x,z),depth=sampleField(surface,x,z,1);
   const prev=this.last[index],rise=(level-prev.level)/Math.max(.02,time-prev.time);
   if(depth>.08&&speed>.6&&rise>.08&&time-prev.hit>.35&&r.base+r.h>level+.15){
    const amount=Math.min(12,Math.floor(2+speed*3*state.strength));
    for(let j=0;j<amount;j++){
     const zz=r.z+(this.random()-.5)*r.rz*1.3;
     let xx=r.x+r.rx*1.5;for(let k=0;k<25;k++){if(rockTop(xx,zz,r)>level)break;xx-=r.rx*.06;}
     const life=.28+this.random()*.35;
     this.particles[this.cursor]={x:xx+.03,y:level+.025,z:zz,birth:time,life,vx:.25+this.random()*.55,vy:.9+this.random()*1.2,vz:(this.random()-.5)*.65,size:.012+this.random()*.021};this.cursor=(this.cursor+1)%this.count;
    }
    this.totalEmitted+=amount;
    prev.hit=time;
   }
   prev.level=level;prev.time=time;
  });
 }
 update(time,camera){
  for(let i=0;i<this.count;i++){
   const p=this.particles[i],t=p?time-p.birth:100;
   if(!p||t<0||t>p.life){this.alpha.array[i]=0;continue;}
   this.dummy.position.set(p.x+p.vx*t,p.y+p.vy*t-4.905*t*t,p.z+p.vz*t);this.dummy.quaternion.copy(camera.quaternion);this.dummy.scale.set(p.size,p.size*(1.4+t),p.size);this.dummy.updateMatrix();this.mesh.setMatrixAt(i,this.dummy.matrix);this.alpha.array[i]=(1-t/p.life)*.68;
  }
  this.alpha.needsUpdate=true;this.mesh.instanceMatrix.needsUpdate=true;
 }
}
