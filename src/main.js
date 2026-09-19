import * as THREE from 'three/webgpu';
import {GRID} from './coast.js?v=1.3.0';
import {makeNoiseTexture} from './noise.js?v=1.3.0';
import {createShading} from './shading.js?v=1.3.0';
import {buildWorld} from './world.js?v=1.3.0';
import {ShoreCamera,VIEWS} from './camera.js?v=1.3.0';
import {ContactSpray,sampleField} from './spray.js?v=1.3.0';
import {isInterfaceEvent} from './navigation.js?v=1.3.0';
import {FrameProfile} from './performance.js?v=1.3.0';
import {registerAgentTools} from './agent-tools.js?v=1.3.0';
import {ResidentCoast} from './resident-coast.js';
import {GpuSpray} from './gpu-spray.js';
import {makeGpuNoise} from './gpu-interop.js';
const profile=new URLSearchParams(location.search).has('profile')?new FrameProfile():null;
const $=id=>document.getElementById(id);
const fpsValue=$('fps-value'),frameTime=$('frame-time');
let fpsFrames=0,fpsElapsed=0;
const diagnostics={ready:false,revision:THREE.REVISION,errors:[],metrics:null,frameTimes:[],backend:null};
function fail(error){diagnostics.ready=false;diagnostics.errors.push(String(error?.stack||error));$('loading').hidden=true;$('error').hidden=false;$('error-text').textContent='The GPU shoreline could not start or continue. Try compatibility mode below, or open it in a recent browser with WebGPU support.';$('error-detail').textContent=String(error?.message||error);}
window.addEventListener('error',e=>{diagnostics.errors.push(e.message);if(!diagnostics.ready)fail(e.error||e.message);});window.addEventListener('unhandledrejection',e=>fail(e.reason));
let renderer,worker,world,shaders,navigation,camera,spray,paused=false,last=performance.now(),busy=false,accumulator=0,simTime=36,previousTime=36,packetAt=0,frameCount=0,currentQuality='balanced',pending=null,pauseAt=0,renderClock=36-.06;
let previousConditions={strength:1,wind:0,tide:0},currentConditions={...previousConditions};
let resident=null;
let backgroundRunning=false;
document.addEventListener('visibilitychange',()=>{fpsFrames=0;fpsElapsed=0;if(document.hidden){backgroundRunning=!paused;setPause(true);}else if(backgroundRunning){backgroundRunning=false;setPause(false);}});
const bootAt=performance.now();
const scene=new THREE.Scene();
const makeField=()=>{const t=new THREE.DataTexture(new Float32Array(GRID.nx*GRID.nz*4),GRID.nx,GRID.nz,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;};
const fields={surface:makeField(),previous:makeField(),material:makeField(),previousMaterial:makeField(),flow:makeField(),previousFlow:makeField()};
const qa=document.createElement('output');qa.id='qa-state';qa.hidden=true;document.body.appendChild(qa);
function setPause(value){value=!!value;if(value===paused)return;if(value!==paused){if(value)pauseAt=performance.now();else{packetAt+=performance.now()-pauseAt;last=performance.now();}}paused=value;$('pause').setAttribute('aria-label',paused?'Resume simulation':'Pause simulation');$('pause').title=paused?'Resume · Space':'Pause · Space';$('pause-icon').innerHTML=paused?'<path d="M8 5l11 7-11 7z"/>':'<path d="M8 5v14M16 5v14"/>';worker?.postMessage({type:'pause',value:paused});}
function setView(name){navigation.setView(name);$('view').value=name;$('cinematic').setAttribute('aria-pressed','false');return (navigation.transition?.duration||0)*1000;}
function toggleUI(){const hidden=$('interface').hidden;$('interface').hidden=!hidden;$('restore-ui').hidden=hidden;$('touch-pad').style.visibility=hidden?'':'hidden';}
function configure(value){if(resident)resident.sim.configure(value);else worker.postMessage({type:'configure',value});}
function setLighting(mode){
 const s={afternoon:{sun:[-.84,.46,-.25],color:'#fff0d7',intensity:2.2,ambient:1.2,cloud:.04,exposure:1},daylight:{sun:[-.40,.78,-.46],color:'#fff9eb',intensity:2.4,ambient:1.35,cloud:0,exposure:1},overcast:{sun:[-.36,.55,-.79],color:'#e9f0f2',intensity:.5,ambient:1.7,cloud:.91,exposure:1}}[mode];
 shaders.U.sun.value.set(...s.sun).normalize();shaders.U.sunColor.value.set(s.color);shaders.U.overcast.value=s.cloud;world.light.position.copy(shaders.U.sun.value).multiplyScalar(90).add(world.light.target.position);world.light.color.set(s.color);world.light.shadow.needsUpdate=true;world.light.userData.baseIntensity=s.intensity;world.hemi.userData.baseIntensity=s.ambient;world.light.intensity=s.intensity*(1-shaders.U.clouds.value*.18);world.hemi.intensity=s.ambient*(1+shaders.U.clouds.value*.10);renderer.toneMappingExposure=s.exposure;$('lighting').value=mode;
}
function setClouds(value){shaders.U.clouds.value=value;$('clouds').value=value;$('clouds-value').textContent=Math.round(value*100)+'%';world.light.intensity=(world.light.userData.baseIntensity??2.2)*(1-value*.18);world.hemi.intensity=(world.hemi.userData.baseIntensity??1.2)*(1+value*.10);}
function setQuality(q){currentQuality=q;const v={low:[.8,.35],balanced:[1.2,.6],high:[1.7,.85]}[q];renderer.setPixelRatio(Math.min(devicePixelRatio,v[0]));renderer.setSize(innerWidth,innerHeight);shaders.mirror.reflector.resolutionScale=v[1];world.pebbles.visible=q!=='low';world.light.shadow.needsUpdate=true;$('quality').value=q;if(resident)resident.interval=q==='low'?1/20:1/30;worker?.postMessage({type:'quality',interval:q==='low'?1/20:1/30});}
function bindUI(){
 $('pause').onclick=()=>setPause(!paused);$('view').onchange=e=>setView(e.target.value);
 $('cinematic').onclick=()=>{if(navigation.cinematic){setView('ocean');}else{navigation.setView('ocean');$('view').value='ocean';navigation.cinematic=true;navigation.cinemaStart=performance.now()/1000+(navigation.transition?.duration||0);}$('cinematic').setAttribute('aria-pressed',String(navigation.cinematic));};
 $('settings-toggle').onclick=()=>{$('settings').hidden=!$('settings').hidden;$('settings-toggle').setAttribute('aria-expanded',String(!$('settings').hidden));$('help').hidden=true;};$('close-settings').onclick=()=>{$('settings').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');$('settings-toggle').focus();};
 $('help-toggle').onclick=()=>{$('help').hidden=!$('help').hidden;$('settings').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');};$('close-help').onclick=()=>{$('help').hidden=true;$('help-toggle').focus();};
 $('hide-ui').onclick=$('restore-ui').onclick=toggleUI;
 $('strength').oninput=e=>{const v=+e.target.value;configure({strength:v});$('strength-value').textContent=v<.8?'Gentle':v>1.25?'Lively':'Moderate';};
 $('wind').oninput=e=>{const v=+e.target.value;configure({wind:v});$('wind-value').textContent=v===0?'Onshore':`${Math.abs(v)}° ${v<0?'left':'right'}`;};
 $('tide').oninput=e=>{const v=+e.target.value;configure({tide:v});$('tide-value').textContent=Math.abs(v)<.01?'Mean':`${v>0?'+':''}${v.toFixed(2)} m`;};
 $('clouds').oninput=e=>setClouds(+e.target.value);$('lighting').onchange=e=>{setLighting(e.target.value);if(e.target.value==='overcast')setClouds(.95);};$('quality').onchange=e=>setQuality(e.target.value);
 window.addEventListener('keydown',e=>{if(isInterfaceEvent(e))return;if(e.code==='Space'){e.preventDefault();setPause(!paused);}if(e.code==='KeyH')toggleUI();if(e.code==='KeyC'){const keys=Object.keys(VIEWS);setView(keys[(keys.indexOf(navigation.view)+1)%keys.length]);}if(e.code==='Escape'){$('settings').hidden=$('help').hidden=true;}});
 $('interface').addEventListener('keydown',e=>{if(e.key==='Escape'&&e.target.tagName!=='SELECT'){const settings=!$('settings').hidden;$('settings').hidden=$('help').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');(settings?$('settings-toggle'):$('help-toggle')).focus();}e.stopPropagation();});$('interface').addEventListener('wheel',e=>e.stopPropagation(),{passive:true});$('interface').addEventListener('pointerdown',e=>e.stopPropagation());
 const keyMap={forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD',up:'KeyE',down:'KeyQ'};document.querySelectorAll('[data-move]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);navigation.keys.add(keyMap[b.dataset.move]);navigation.transition=null;navigation.cinematic=false;};b.onpointerup=b.onpointercancel=()=>navigation.keys.delete(keyMap[b.dataset.move]);});
 window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
}
async function init(){
 try{
  if(THREE.REVISION!=='185')throw new Error('The packaged renderer must be Three.js r185.');
  renderer=new THREE.WebGPURenderer({antialias:false,trackTimestamp:!!profile,forceWebGL:new URLSearchParams(location.search).has('webgl'),powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.2));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  await renderer.init();diagnostics.backend=renderer.backend.isWebGPUBackend?'WebGPU':'WebGL2';
  renderer.backend.device?.addEventListener('uncapturederror',e=>{renderer.setAnimationLoop(null);fail(e.error);});
  $('viewport').appendChild(renderer.domElement);
  camera=new THREE.PerspectiveCamera(57,innerWidth/innerHeight,.18,5000);
  const solverMode=new URLSearchParams(location.search).get('solver');
  if(solverMode!=='cpu'&&solverMode!=='legacy'){
   if(!renderer.backend.isWebGPUBackend)throw Error('The CUDA renderer requires WebGPU. Use compatibility mode for WebGL.');
   resident=await ResidentCoast.create(renderer,fields);
   resident.solver.runtime.onError=error=>{renderer.setAnimationLoop(null);fail(error);};
  }
  shaders=createShading(resident?makeGpuNoise(renderer,resident.solver):makeNoiseTexture(),fields);world=buildWorld(scene,shaders);spray=resident?new GpuSpray(scene,shaders,resident.spray,resident.solver.particleCount):new ContactSpray(scene,shaders);navigation=new ShoreCamera(camera,renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Coastal scene. Drag to look, W A S D to fly, Q and E down and up, Shift for faster flight.');navigation.update(.016,0);setLighting('afternoon');bindUI();
  if(resident){
   simTime=resident.currentTime;previousTime=resident.previousTime;renderClock=previousTime;
   shaders.U.time.value=previousTime;shaders.U.alpha.value=0;diagnostics.solver=resident.solver.name;
   diagnostics.metrics=await resident.solver.metrics();
   camera.updateMatrixWorld();shaders.updateCamera(camera);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
   diagnostics.ready=true;diagnostics.startupMilliseconds=performance.now()-bootAt;$('loading').hidden=true;last=performance.now();renderer.setAnimationLoop(frame);
  }else{
  worker=new Worker(new URL('./worker.js?v=1.3.0',import.meta.url),{type:'module'});
  worker.onerror=e=>fail(e.message);
  worker.onmessage=async ({data})=>{
   if(data.type==='error'){renderer.setAnimationLoop(null);fail(new Error(data.message));return;}
   if(data.solver)diagnostics.solver=data.solver;
   if(data.type==='progress'){$('progress').style.width=`${10+data.value*70}%`;return;}
   busy=false;
   if(data.type==='ready'||data.type==='qa-frame'){if(pending)recyclePacket(pending);pending=null;installPacket(data,true);}
   else{if(pending)recyclePacket(pending);pending=data;return;}
   if(data.type==='ready'){
    camera.updateMatrixWorld();shaders.updateCamera(camera);$('loading-text').textContent='Resolving light and water';$('progress').style.width='92%';
    try{await renderer.compileAsync(scene,camera);renderer.render(scene,camera);diagnostics.ready=true;diagnostics.startupMilliseconds=performance.now()-bootAt;$('loading').hidden=true;last=performance.now();renderer.setAnimationLoop(frame);worker.postMessage({type:'pause',value:paused});}catch(e){fail(e);}
   }
  };
  worker.postMessage({type:'init',profile:!!profile,solver:new URLSearchParams(location.search).get('solver')});
  }
  window.saltreach={diagnostics,scene,camera,renderer,fields,get paused(){return paused;},get time(){return simTime;},get quality(){return currentQuality;},setPause,setView,configure,setLighting,setClouds,setQuality,viewpoints:VIEWS,snapshot:()=>({ready:diagnostics.ready,revision:diagnostics.revision,backend:diagnostics.backend,solver:diagnostics.solver,time:simTime,paused,quality:currentQuality,view:navigation.view,position:camera.position.toArray(),conditions:{strength:shaders.U.strength.value,wind:shaders.U.wind.value,tide:shaders.U.tide.value,lighting:$('lighting').value,clouds:shaders.U.clouds.value},renderTime:shaders.U.time.value,alpha:shaders.U.alpha.value,sprayEmitted:spray.totalEmitted,rockWetReach:world.rocks[0].userData.wetReach,simulationLag:Math.max(0,renderClock-simTime),worker:diagnostics.worker,metrics:diagnostics.metrics,errors:diagnostics.errors})};
  registerAgentTools({measure:profile?seconds=>profile.measure(seconds,()=>window.saltreach.snapshot()):null,read:()=>({...window.saltreach.snapshot(),benchmark:profile?.last,benchmarkRunning:!!profile?.run,performance:qa.textContent?JSON.parse(qa.textContent):null}),view:setView,pause:setPause,configure:input=>{for(const k of ['strength','wind','tide'])if(input[k]!==undefined){$(k).value=input[k];$(k).oninput({target:$(k)});}if(input.lighting){setLighting(input.lighting);if(input.lighting==='overcast'&&input.clouds===undefined)setClouds(.95);}if(input.clouds!==undefined)setClouds(input.clouds);if(input.quality)setQuality(input.quality);}});
  window.saltreach.resident=resident;
 }catch(e){fail(e);}
}
function recyclePacket(p){worker.postMessage({type:'recycle',surface:p.surface,material:p.material,flow:p.flow},[p.surface.buffer,p.material.buffer,p.flow.buffer]);}
function installPacket(data,initial=false){
 if(initial&&diagnostics.ready){
  const a={surface:fields.surface.image.data,material:fields.material.image.data,flow:fields.flow.image.data};
  const b={surface:fields.previous.image.data,material:fields.previousMaterial.image.data,flow:fields.previousFlow.image.data};
  recyclePacket(a);if(b.surface!==a.surface)recyclePacket(b);
 }
 const recycled={};
 for(const [key,previous] of [['surface','previous'],['material','previousMaterial'],['flow','previousFlow']]){
  if(initial){fields[key].image.data=data[key];fields[previous].image.data=data[key];fields[key].needsUpdate=fields[previous].needsUpdate=true;}
  else{const spare=fields[previous],old=spare.image.data;fields[previous]=fields[key];fields[key]=spare;spare.image.data=data[key];spare.needsUpdate=true;if(old!==fields[previous].image.data)recycled[key]=old;}
 }
 shaders.bindFields();
 if(recycled.surface&&recycled.material&&recycled.flow)worker.postMessage({type:'recycle',...recycled},[recycled.surface.buffer,recycled.material.buffer,recycled.flow.buffer]);
 previousTime=initial?data.time:simTime;simTime=data.time;packetAt=performance.now();if(initial)renderClock=data.time-.06;
 previousConditions=initial?{...data.state}:currentConditions;currentConditions={...data.state};
 shaders.U.alpha.value=initial?1:0;shaders.U.time.value=previousTime;
 if(initial){for(const key of ['strength','wind','tide'])shaders.U[key].value=data.state[key];shaders.mirror.target.position.y=data.state.tide;}
 if(data.metrics)diagnostics.metrics=data.metrics;
 if(data.profile)diagnostics.worker=data.profile;
 if(!initial)spray.arrival(data);
 for(const mesh of world.rocks){const r=mesh.userData.rock,level=sampleField(data.surface,r.x+r.rx*1.16,r.z);const old=mesh.userData.wetReach,reach=Math.max(old-.008*Math.max(0,simTime-previousTime),level+.07);mesh.userData.previousReach=old;mesh.userData.wetReach=reach;}
}
function frame(now){
 const frameStart=performance.now();
 const actualMs=now-last,dt=Math.min(.06,actualMs/1000);last=now;
 if(!paused){
  if(resident){
   const update=resident.frame(actualMs/1000);
   if(update.published)shaders.bindFields();
   simTime=resident.currentTime;previousTime=resident.previousTime;renderClock=update.renderTime;
   previousConditions=resident.previousState;currentConditions=resident.currentState;
  }else{
  // Interpolate on simulation time, not from each packet's arrival. Restarting
  // the interval on delivery discards fractional time and slows the sea at 60 Hz.
  renderClock+=actualMs/1000;
  if(pending&&renderClock>=simTime){const next=pending;pending=null;installPacket(next);}
  }
  const alpha=Math.max(0,Math.min(1,(renderClock-previousTime)/Math.max(1e-6,simTime-previousTime)));
  shaders.U.alpha.value=alpha;shaders.U.time.value=previousTime+(simTime-previousTime)*alpha;
  for(const key of ['strength','wind','tide'])shaders.U[key].value=previousConditions[key]+(currentConditions[key]-previousConditions[key])*alpha;
  shaders.mirror.target.position.y=shaders.U.tide.value;
  if(!resident)for(const mesh of world.rocks){const a=mesh.userData.previousReach??mesh.userData.wetReach,b=mesh.userData.wetReach,reach=a+(b-a)*alpha;mesh.userData.renderWetReach=reach;}
 }
 navigation.update(dt,now/1000,shaders.U.tide.value,shaders.U.strength.value);
 if($('cinematic').getAttribute('aria-pressed')!==String(navigation.cinematic))$('cinematic').setAttribute('aria-pressed',String(navigation.cinematic));
 
 spray.update(shaders.U.time.value,camera);camera.updateMatrixWorld();shaders.updateCamera(camera);renderer.render(scene,camera);
 profile?.record(actualMs,performance.now()-frameStart,renderer);
 // Display rendered-frame cadence, independent of the 60 Hz physics clock.
 if(actualMs>0&&Number.isFinite(actualMs)){
  fpsFrames++;fpsElapsed+=actualMs;
  if(fpsElapsed>=500){
   diagnostics.fps=fpsFrames*1000/fpsElapsed;diagnostics.frameMs=fpsElapsed/fpsFrames;
   fpsValue.textContent=`${Math.round(diagnostics.fps)} FPS`;frameTime.textContent=`${diagnostics.frameMs.toFixed(1)} ms / frame`;
   fpsFrames=0;fpsElapsed=0;
  }
 }
 if(resident){
  diagnostics.worker=resident.profile();
  if(profile&&!resident.metricPending&&now-resident.lastMetricWall>1000){
   resident.lastMetricWall=now;resident.metricPending=true;
   resident.solver.metrics().then(metrics=>{diagnostics.metrics=metrics;spray.totalEmitted=metrics.sprayEmitted;world.rocks[0].userData.wetReach=metrics.rockWetReach;}).catch(fail).finally(()=>resident.metricPending=false);
  }
 }
 diagnostics.frameTimes.push(actualMs);if(diagnostics.frameTimes.length>1200)diagnostics.frameTimes.shift();
 if(++frameCount%30===0){const ts=diagnostics.frameTimes.slice(-300).sort((a,b)=>a-b);qa.textContent=JSON.stringify({...window.saltreach.snapshot(),startupMilliseconds:diagnostics.startupMilliseconds,fps:1000/(ts.reduce((a,b)=>a+b,0)/ts.length),p95:ts[Math.floor(ts.length*.95)],renderCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles});}
}
init();
