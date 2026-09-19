import * as THREE from 'three/webgpu';
import {terrainHeight,collisionPosition,clamp} from './coast.js?v=1.3.0';
import {isInterfaceEvent,routeBetween,prepareRoute,pointOnRoute} from './navigation.js?v=1.3.0';
import {VIEWS} from './views.js?v=1.3.0';
export {VIEWS};
export class ShoreCamera{
 constructor(camera,element){
  this.camera=camera;this.el=element;this.keys=new Set();this.yaw=0;this.pitch=0;this.targetYaw=0;this.targetPitch=0;this.velocity=new THREE.Vector2();this.drag=false;this.cinematic=false;this.eye=3.4;this.view='ocean';this.tide=0;this.strength=1;this.reduced=matchMedia('(prefers-reduced-motion: reduce)');this.position=new THREE.Vector3();
  this.setView('ocean',true);
  element.addEventListener('pointerdown',e=>{element.focus({preventScroll:true});this.drag=true;this.last={x:e.clientX,y:e.clientY};element.setPointerCapture(e.pointerId);this.cinematic=false;this.transition=null;});
  element.addEventListener('pointermove',e=>{if(!this.drag)return;this.targetYaw-=(e.clientX-this.last.x)*.003;this.targetPitch-= (e.clientY-this.last.y)*.0027;this.targetPitch=clamp(this.targetPitch,-1.35,.65);this.last={x:e.clientX,y:e.clientY};});
  element.addEventListener('pointerup',()=>this.drag=false);element.addEventListener('pointercancel',()=>this.drag=false);
  element.addEventListener('wheel',e=>{e.preventDefault();this.transition=null;this.cinematic=false;const amount=clamp(e.deltaY,-100,100)*.004;this.position.x-=Math.sin(this.yaw)*amount;this.position.z-=Math.cos(this.yaw)*amount;},{passive:false});
  window.addEventListener('keydown',e=>{if(isInterfaceEvent(e))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft'].includes(e.code)){e.preventDefault();this.keys.add(e.code);this.cinematic=false;this.transition=null;}});
  window.addEventListener('focusin',e=>{if(isInterfaceEvent(e)){this.keys.clear();this.velocity.set(0,0);}});
  window.addEventListener('keyup',e=>this.keys.delete(e.code));window.addEventListener('blur',()=>{this.keys.clear();this.drag=false;});
 }
 setView(name,instant=false){
  const v=VIEWS[name];if(!v)return;this.view=name;this.cinematic=false;this.keys.clear();this.velocity.set(0,0);instant=instant||this.reduced.matches;
  const y=Math.max(terrainHeight(v.x,v.z)+v.eye,this.tide+Math.max(v.eye,1.4+this.strength*.15));
  const dx=v.look[0]-v.x,dy=v.look[1]-y,dz=v.look[2]-v.z;
  const yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(dy,Math.hypot(dx,dz));
  if(instant){this.transition=null;this.position.set(v.x,y,v.z);this.eye=v.eye;this.yaw=this.targetYaw=yaw;this.pitch=this.targetPitch=pitch;}
  else{let toYaw=yaw;while(toYaw-this.yaw>Math.PI)toYaw-=Math.PI*2;while(toYaw-this.yaw< -Math.PI)toYaw+=Math.PI*2;const route=prepareRoute(routeBetween(this.position,v));this.transition={route,duration:Math.min(4.8,Math.max(1.7,route.length/9)),t:0,from:this.position.clone(),to:new THREE.Vector3(v.x,y,v.z),eye:this.eye,toEye:v.eye,yaw:this.yaw,toYaw,pitch:this.pitch,toPitch:pitch};}
 }
 update(dt,time,tide=0,strength=1){
  this.tide=tide;this.strength=strength;
  if(this.transition){const s=this.transition;s.t=Math.min(1,s.t+dt/s.duration);const f=s.t*s.t*(3-2*s.t);const p=pointOnRoute(s.route,f);this.position.set(p.x,THREE.MathUtils.lerp(s.from.y,s.to.y,f),p.z);this.eye=THREE.MathUtils.lerp(s.eye,s.toEye,f);this.yaw=this.targetYaw=THREE.MathUtils.lerp(s.yaw,s.toYaw,f);this.pitch=this.targetPitch=THREE.MathUtils.lerp(s.pitch,s.toPitch,f);if(s.t===1)this.transition=null;}
  else if(this.cinematic){const t=Math.max(0,time-this.cinemaStart)*.018,v=VIEWS.ocean;const drift=Math.sin(t*.55);this.position.x=v.x-4*drift;this.position.z=v.z-17*drift;this.eye=v.eye+.35*(1-Math.cos(t*.4));const dx=v.look[0]-this.position.x,dz=v.look[2]-v.z;this.targetYaw=Math.atan2(-dx,-dz);this.targetPitch=Math.atan2(-this.position.y,Math.hypot(dx,dz));}
  else{
   const f=(this.keys.has('KeyW')||this.keys.has('ArrowUp')?1:0)-(this.keys.has('KeyS')||this.keys.has('ArrowDown')?1:0);
   const side=(this.keys.has('KeyD')||this.keys.has('ArrowRight')?1:0)-(this.keys.has('KeyA')||this.keys.has('ArrowLeft')?1:0);
   const magnitude=Math.max(1,Math.hypot(f,side)),speed=this.keys.has('ShiftLeft')?2.6:1.45;
   const blend=1-Math.exp(-dt*7);this.velocity.x+=(side/magnitude*speed-this.velocity.x)*blend;this.velocity.y+=(f/magnitude*speed-this.velocity.y)*blend;
   this.position.x+=(Math.cos(this.yaw)*this.velocity.x-Math.sin(this.yaw)*this.velocity.y)*dt;
   this.position.z+=(-Math.sin(this.yaw)*this.velocity.x-Math.cos(this.yaw)*this.velocity.y)*dt;
  }
  const collision=collisionPosition(this.position.x,this.position.z);this.position.x=collision.x;this.position.z=collision.z;
  const floor=Math.max(terrainHeight(this.position.x,this.position.z)+this.eye,tide+Math.max(this.eye,1.4+strength*.15));
  if(this.transition)this.position.y=Math.max(this.position.y,floor);else this.position.y+=(floor-this.position.y)*(1-Math.exp(-dt*3));
  this.yaw+=(this.targetYaw-this.yaw)*(1-Math.exp(-dt*12));this.pitch+=(this.targetPitch-this.pitch)*(1-Math.exp(-dt*12));
  this.camera.position.copy(this.position);this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
 }
}
