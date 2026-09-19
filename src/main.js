import * as THREE from 'three/webgpu';
import {GRID} from './coast.js?v=1.5.1';
import {createShading} from './shading.js?v=1.5.1';
import {buildWorld} from './world.js?v=1.5.1';
import {ShoreCamera,VIEWS} from './camera.js?v=1.5.1';
import {isInterfaceEvent} from './navigation.js?v=1.5.1';
import {FrameProfile} from './performance.js?v=1.5.1';
import {registerAgentTools} from './agent-tools.js?v=1.5.1';
import {ResidentCoast} from './resident-coast.js?v=1.5.1';
import {GpuSpray} from './gpu-spray.js?v=1.5.1';
import {makeGpuNoise} from './gpu-interop.js?v=1.5.1';
const profile=new URLSearchParams(location.search).has('profile')?new FrameProfile():null;
const $=id=>document.getElementById(id);
const fpsValue=$('fps-value'),frameTime=$('frame-time');
let fpsFrames=0,fpsElapsed=0;
const diagnostics={ready:false,revision:THREE.REVISION,errors:[],metrics:null,frameTimes:[],backend:null};
function fail(error){renderer?.setAnimationLoop(null);diagnostics.ready=false;diagnostics.errors.push(String(error?.stack||error));$('loading').hidden=true;$('error').hidden=false;$('error-text').textContent='This shoreline requires WebGPU and CUDA WebShader. Open it in a WebGPU-capable browser with hardware acceleration enabled.';$('error-detail').textContent=String(error?.message||error);}
window.addEventListener('error',e=>{diagnostics.errors.push(e.message);if(!diagnostics.ready)fail(e.error||e.message);});window.addEventListener('unhandledrejection',e=>fail(e.reason));
let renderer,world,shaders,navigation,camera,spray,paused=false,last=performance.now(),simTime=36,previousTime=36,frameCount=0,currentQuality='balanced',renderClock=36-.06;
let previousConditions={strength:1,wind:0,tide:0},currentConditions={...previousConditions};
let resident=null;
let backgroundRunning=false;
document.addEventListener('visibilitychange',()=>{fpsFrames=0;fpsElapsed=0;if(document.hidden){backgroundRunning=!paused;setPause(true);}else if(backgroundRunning){backgroundRunning=false;setPause(false);}});
const bootAt=performance.now();
const scene=new THREE.Scene();
const makeField=()=>{const t=new THREE.DataTexture(new Float32Array(GRID.nx*GRID.nz*4),GRID.nx,GRID.nz,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;};
const fields={surface:makeField(),previous:makeField(),material:makeField(),previousMaterial:makeField(),flow:makeField(),previousFlow:makeField()};
const qa=document.createElement('output');qa.id='qa-state';qa.hidden=true;document.body.appendChild(qa);
function setPause(value){value=!!value;if(value===paused)return;if(!value)last=performance.now();paused=value;$('pause').setAttribute('aria-label',paused?'Resume simulation':'Pause simulation');$('pause').title=paused?'Resume · Space':'Pause · Space';$('pause-icon').innerHTML=paused?'<path d="M8 5l11 7-11 7z"/>':'<path d="M8 5v14M16 5v14"/>';}
function setView(name){navigation.setView(name);$('view').value=name;$('cinematic').setAttribute('aria-pressed','false');return (navigation.transition?.duration||0)*1000;}
function toggleUI(){const hidden=$('interface').hidden;$('interface').hidden=!hidden;$('restore-ui').hidden=hidden;$('touch-pad').style.visibility=hidden?'':'hidden';}
function configure(value){resident.sim.configure(value);}
function setLighting(mode){
 const s={afternoon:{sun:[-.84,.46,-.25],color:'#fff0d7',intensity:2.2,ambient:1.2,cloud:.04,exposure:1},daylight:{sun:[-.40,.78,-.46],color:'#fff9eb',intensity:2.4,ambient:1.35,cloud:0,exposure:1},overcast:{sun:[-.36,.55,-.79],color:'#e9f0f2',intensity:.5,ambient:1.7,cloud:.91,exposure:1}}[mode];
 shaders.U.sun.value.set(...s.sun).normalize();shaders.U.sunColor.value.set(s.color);shaders.U.overcast.value=s.cloud;world.light.position.copy(shaders.U.sun.value).multiplyScalar(90).add(world.light.target.position);world.light.color.set(s.color);world.light.shadow.needsUpdate=true;world.light.userData.baseIntensity=s.intensity;world.hemi.userData.baseIntensity=s.ambient;world.light.intensity=s.intensity*(1-shaders.U.clouds.value*.18);world.hemi.intensity=s.ambient*(1+shaders.U.clouds.value*.10);renderer.toneMappingExposure=s.exposure;$('lighting').value=mode;
}
function setClouds(value){shaders.U.clouds.value=value;$('clouds').value=value;$('clouds-value').textContent=Math.round(value*100)+'%';world.light.intensity=(world.light.userData.baseIntensity??2.2)*(1-value*.18);world.hemi.intensity=(world.hemi.userData.baseIntensity??1.2)*(1+value*.10);}
function setQuality(q){currentQuality=q;const v={low:[.8,.35],balanced:[1.2,.6],high:[1.7,.85]}[q];renderer.setPixelRatio(Math.min(devicePixelRatio,v[0]));renderer.setSize(innerWidth,innerHeight);shaders.mirror.reflector.resolutionScale=v[1];world.pebbles.visible=q!=='low';world.light.shadow.needsUpdate=true;$('quality').value=q;resident.interval=q==='low'?1/20:1/30;}
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
  if(!navigator.gpu)throw Error('WebGPU is unavailable in this browser.');
  // Construct the explicit backend: WebGPURenderer installs a WebGL fallback.
  const options={antialias:false,trackTimestamp:!!profile,powerPreference:'high-performance'};
  renderer=new THREE.Renderer(new THREE.WebGPUBackend(options),options);
  renderer.library=new THREE.StandardNodeLibrary();
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.2));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  await renderer.init();diagnostics.backend='WebGPU';
  renderer.backend.device?.addEventListener('uncapturederror',e=>{renderer.setAnimationLoop(null);fail(e.error);});
  $('viewport').appendChild(renderer.domElement);
  camera=new THREE.PerspectiveCamera(57,innerWidth/innerHeight,.18,5000);
  resident=await ResidentCoast.create(renderer,fields);
  resident.solver.runtime.onError=fail;
  shaders=createShading(makeGpuNoise(renderer,resident.solver),fields);world=buildWorld(scene,shaders);spray=new GpuSpray(scene,shaders,resident.spray,resident.solver.particleCount);navigation=new ShoreCamera(camera,renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Coastal scene. Drag to look, W A S D to fly, Q and E down and up, Shift for faster flight.');navigation.update(.016,0);setLighting('afternoon');bindUI();
   simTime=resident.currentTime;previousTime=resident.previousTime;renderClock=previousTime;
   shaders.U.time.value=previousTime;shaders.U.alpha.value=0;diagnostics.solver=resident.solver.name;
   diagnostics.metrics=await resident.solver.metrics();
   camera.updateMatrixWorld();shaders.updateCamera(camera);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
   diagnostics.ready=true;diagnostics.startupMilliseconds=performance.now()-bootAt;$('loading').hidden=true;last=performance.now();renderer.setAnimationLoop(frame);
  window.saltreach={diagnostics,scene,camera,renderer,fields,get paused(){return paused;},get time(){return simTime;},get quality(){return currentQuality;},setPause,setView,configure,setLighting,setClouds,setQuality,viewpoints:VIEWS,snapshot:()=>({ready:diagnostics.ready,revision:diagnostics.revision,backend:diagnostics.backend,solver:diagnostics.solver,time:simTime,paused,quality:currentQuality,view:navigation.view,position:camera.position.toArray(),conditions:{strength:shaders.U.strength.value,wind:shaders.U.wind.value,tide:shaders.U.tide.value,lighting:$('lighting').value,clouds:shaders.U.clouds.value},renderTime:shaders.U.time.value,alpha:shaders.U.alpha.value,sprayEmitted:spray.totalEmitted,rockWetReach:world.rocks[0].userData.wetReach,simulationLag:Math.max(0,renderClock-simTime),worker:diagnostics.worker,metrics:diagnostics.metrics,errors:diagnostics.errors})};
  registerAgentTools({measure:profile?seconds=>profile.measure(seconds,()=>window.saltreach.snapshot()):null,read:()=>({...window.saltreach.snapshot(),benchmark:profile?.last,benchmarkRunning:!!profile?.run,performance:qa.textContent?JSON.parse(qa.textContent):null}),view:setView,pause:setPause,configure:input=>{for(const k of ['strength','wind','tide'])if(input[k]!==undefined){$(k).value=input[k];$(k).oninput({target:$(k)});}if(input.lighting){setLighting(input.lighting);if(input.lighting==='overcast'&&input.clouds===undefined)setClouds(.95);}if(input.clouds!==undefined)setClouds(input.clouds);if(input.quality)setQuality(input.quality);}});
  window.saltreach.resident=resident;
 }catch(e){fail(e);}
}
function frame(now){
 const frameStart=performance.now();
 const actualMs=now-last,dt=Math.min(.06,actualMs/1000);last=now;
 if(!paused){
   const update=resident.frame(actualMs/1000);
   if(update.published)shaders.bindFields();
   simTime=resident.currentTime;previousTime=resident.previousTime;renderClock=update.renderTime;
   previousConditions=resident.previousState;currentConditions=resident.currentState;
  const alpha=Math.max(0,Math.min(1,(renderClock-previousTime)/Math.max(1e-6,simTime-previousTime)));
  shaders.U.alpha.value=alpha;shaders.U.time.value=previousTime+(simTime-previousTime)*alpha;
  for(const key of ['strength','wind','tide'])shaders.U[key].value=previousConditions[key]+(currentConditions[key]-previousConditions[key])*alpha;
  shaders.mirror.target.position.y=shaders.U.tide.value;
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
