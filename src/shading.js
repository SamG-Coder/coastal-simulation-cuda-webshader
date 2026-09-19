import * as THREE from 'three/webgpu';
import {Fn,uniform,float,vec2,vec3,vec4,color,texture,attribute,shadow,positionWorld,positionLocal,normalWorld,normalView,normalLocal,cameraPosition,cameraViewMatrix,cameraProjectionMatrix,positionView,screenUV,cameraNear,cameraFar,perspectiveDepthToViewZ,viewportDepthTexture,viewportTexture,reflector,reflect,reflectVector,normalize,dot,mix,max,min,clamp,smoothstep,sin,cos,exp,pow,abs,length,fract,dFdx,dFdy,fwidth,cross,varying,bumpMap,If,Discard} from 'three/tsl';
import {GRID,WAVES,ROCKS} from './coast.js?v=1.5.0';

export function createShading(noiseTex,fields){
 const sunLight=new THREE.DirectionalLight('#fff0da',2.2);sunLight.castShadow=true;
 const U={inspection:uniform(0),foamShow:uniform(1),clouds:uniform(.25),time:uniform(36),alpha:uniform(1),strength:uniform(1),wind:uniform(0),tide:uniform(0),sun:uniform(new THREE.Vector3(-.84,.46,-.25).normalize()),sunColor:uniform(new THREE.Color('#fff0d7')),overcast:uniform(.18),exposure:uniform(1)};
 const noise=uv=>texture(noiseTex,uv);
 // These belong to the visible camera. Nested planar-reflection rendering can
 // update the shared camera nodes before this fragment shader samples them.
 const mainView=uniform(new THREE.Matrix4()),mainProjection=uniform(new THREE.Matrix4());
 const updateCamera=camera=>{mainView.value.copy(camera.matrixWorldInverse);mainProjection.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);};
 const fieldUV=p=>p.sub(vec2(GRID.x0,GRID.z0)).div(vec2((GRID.nx-1)*GRID.dx,(GRID.nz-1)*GRID.dz)).mul(vec2((GRID.nx-1)/GRID.nx,(GRID.nz-1)/GRID.nz)).add(vec2(.5/GRID.nx,.5/GRID.nz));
 const pairs={surface:[texture(fields.previous),texture(fields.surface)],material:[texture(fields.previousMaterial),texture(fields.material)],flow:[texture(fields.previousFlow),texture(fields.flow)]};
 const bindFields=()=>{for(const [key,previous] of [['surface','previous'],['material','previousMaterial'],['flow','previousFlow']]){pairs[key][0].value=fields[previous];pairs[key][1].value=fields[key];}};
 const field=(key,p)=>mix(pairs[key][0].sample(fieldUV(p)),pairs[key][1].sample(fieldUV(p)),U.alpha);
 const domain=Fn(([p])=>smoothstep(GRID.x0,GRID.x0+2,p.x).mul(float(1).sub(smoothstep(50,58,p.x))).mul(smoothstep(GRID.z0,GRID.z0+7,p.y)).mul(float(1).sub(smoothstep(20,28,p.y))));
 const offshore=Fn(([p])=>{
  const h=float(0).toVar(),gx=float(0).toVar(),gz=float(0).toVar();
  for(const w of WAVES){const kz=float(w.z).add(U.wind.mul(.00096));const phase=p.x.sub(52).mul(w.k).add(p.y.mul(kz)).add(U.time.mul(w.w)).add(w.p);h.addAssign(cos(phase).mul(w.a));gx.subAssign(sin(phase).mul(w.a*w.k));gz.subAssign(sin(phase).mul(w.a).mul(kz));}
  const group=float(.79).add(sin(U.time.mul(.071).add(p.y.mul(.018))).mul(.16)).add(sin(U.time.mul(.117).sub(p.y.mul(.031))).mul(.1));
  const dz=cos(U.time.mul(.071).add(p.y.mul(.018))).mul(.00288).sub(cos(U.time.mul(.117).sub(p.y.mul(.031))).mul(.0031));
  return vec3(h.mul(group).mul(U.strength).add(U.tide),gx.mul(group).mul(U.strength),gz.mul(group).add(h.mul(dz)).mul(U.strength));
 });
 const ripple=Fn(([p,depth])=>{
  const h=float(0).toVar(),gx=float(0).toVar(),gz=float(0).toVar();
  const fade=smoothstep(.025,.30,depth).mul(float(1).sub(smoothstep(45,140,length(cameraPosition.xz.sub(p))))).mul(U.strength);
  for(const [x,z,w,a] of [[3.4,1.65,2.5,.012],[-2.7,4.1,3.6,.006],[1.65,.48,2.8,.028]]){const phase=p.x.mul(x).add(p.y.mul(z)).add(U.time.mul(w));h.addAssign(sin(phase).mul(a));gx.addAssign(cos(phase).mul(a*x));gz.addAssign(cos(phase).mul(a*z));}
  // The resident solver has already evaluated short waves and their slopes.
  // Keep analytic detail only in the distant water beyond the compute domain.
  return vec3(h,gx,gz).mul(fade).mul(float(1).sub(domain(p)));
 });
 const height=Fn(([p])=>{const near=field('surface',p);return mix(offshore(p).x,near.x,domain(p)).add(ripple(p,near.y).x);});
 const cloud=Fn(([p])=>{const a=noise(p.mul(.029)).r;return a.mul(.78).add(noise(p.mul(.078).add(a.mul(.22))).r.mul(.22));});
 const cloudThreshold=float(.70).sub(U.clouds.mul(.36));
 const sky=Fn(([direction,solar])=>{
  const d=normalize(direction).toVar(),elevation=max(d.y,0),sunDot=max(dot(d,U.sun),0);
  const base=mix(color('#b4cbd6'),color('#3676a6'),pow(elevation,.46)).toVar();
  base.assign(mix(base,color('#a8b7bf'),U.overcast.mul(U.clouds).mul(.55)));
  base.addAssign(U.sunColor.mul(pow(sunDot,24)).mul(.06).mul(float(1).sub(U.overcast)));
  const cover=float(0).toVar();
  // One shaped cloud field. Two density evaluations replace eighteen texture
  // evaluations from the three former strata; a clear sky skips the field.
  If(U.clouds.greaterThan(.001),()=>{
   const p=d.xz.div(max(.025,d.y)).mul(2.6).add(vec2(U.time.mul(.0009),U.time.mul(.00024))).add(vec2(2.7,-1.2));
   const density=cloud(p).toVar();
   cover.assign(smoothstep(cloudThreshold.sub(.035),cloudThreshold.add(.055),density).mul(smoothstep(.018,.09,d.y)));
   const edge=clamp(cloud(p.add(U.sun.xz.mul(.7))).sub(density).mul(7).add(.72),.32,1);
   const cloudColor=mix(color('#718391'),color('#f0f0e8'),edge).mul(mix(1,.90,U.overcast));
   base.assign(mix(base,cloudColor,cover));
  });
  const sunDisc=smoothstep(.99990,.99997,sunDot).mul(float(1).sub(cover)).mul(float(1).sub(U.overcast.mul(.90))).mul(solar);
  base.addAssign(U.sunColor.mul(sunDisc).mul(5));
  return mix(color('#254e64'),base,smoothstep(-.24,.04,d.y));
 });
 const skyMaterial=new THREE.MeshBasicNodeMaterial({side:THREE.BackSide,depthWrite:false,fog:false});
 skyMaterial.colorNode=sky(positionWorld.sub(cameraPosition),float(1));

 const sand=new THREE.MeshStandardNodeMaterial({roughness:.85});
 const p=positionWorld.xz;
 const cloudPosition=p.mul(.013).add(U.sun.xz.div(U.sun.y).mul(2.6)).add(vec2(U.time.mul(.0009),U.time.mul(.00024)));
 const cloudShadow=float(1).sub(smoothstep(cloudThreshold.sub(.035),cloudThreshold.add(.055),cloud(cloudPosition.add(vec2(2.7,-1.2)))).mul(.40).mul(smoothstep(0,.015,U.clouds)));
 sand.receivedShadowNode=s=>s.mul(cloudShadow);
 const wet=field('material',p).r.mul(domain(p));
 const st=varying(field('surface',positionLocal.xz),'sandWaterState');
 // The air/water sheen belongs to the exposed film, not the submerged bed.
 // Otherwise the water refracts a second, brightly colored sun reflection.
 const film=field('material',p).g.mul(domain(p)).mul(float(1).sub(smoothstep(.012,.10,st.y)));
 const macro=noise(p.mul(.014)).r;
 const fine=noise(p.mul(2.1)).b;
 const sandRipple=sin(p.x.mul(31).add(sin(p.y.mul(.9)).mul(2.8)).add(noise(p.mul(.06)).r.mul(4))).mul(.5).add(.5);
 const dry=mix(color('#b6a189'),color('#cdb697'),macro);
 const damp=mix(color('#74796e'),color('#978d77'),macro);
 sand.colorNode=mix(dry,damp,wet.mul(.84)).mul(mix(.93,1.06,fine)).mul(mix(.965,1.02,sandRipple));
 sand.roughnessNode=mix(float(.94),float(.24),film.mul(.82)).sub(wet.mul(.08));
 sand.normalNode=bumpMap(fine.mul(.0014).add(sandRipple.mul(.0015)),.4);
 sand.envNode=sky(reflectVector,float(0)).mul(.20);
 // Sun caustics are present only in clear shallow water. They are transmitted
 // into the same sand material that continues above the waterline.
 const submerged=smoothstep(.055,.2,st.y).mul(float(1).sub(smoothstep(1.4,3.2,st.y))).mul(domain(p));
 const c1=noise(p.mul(.12).add(vec2(U.time.mul(.007),U.time.mul(.004)))).g;
 const c2=noise(p.mul(.133).sub(vec2(U.time.mul(.005),U.time.mul(.008)))).g;
 const caustic=pow(float(1).sub(abs(c1.add(c2).sub(1))),22).mul(submerged).mul(float(1).sub(st.z.add(st.w).clamp())).mul(float(1).sub(U.overcast)).mul(.06);
 sand.emissiveNode=vec3(.65,.84,.72).mul(caustic);

 const rock=new THREE.MeshStandardNodeMaterial({roughness:.8});
 rock.receivedShadowNode=s=>s.mul(cloudShadow);
 const weights=pow(abs(normalWorld),vec3(4)).toVar();
 const normWeights=weights.div(weights.x.add(weights.y).add(weights.z));
 const tri=scale=>noise(positionWorld.yz.mul(scale)).mul(normWeights.x).add(noise(positionWorld.xz.mul(scale)).mul(normWeights.y)).add(noise(positionWorld.xy.mul(scale)).mul(normWeights.z));
 const stoneMacro=tri(.032).r;
 const middle=tri(.25).r;
 const meso=tri(.36).g;
 const grain=tri(1.5).g;
 // Irregular mineral patches instead of repeated horizontal contour bands.
 const fractures=float(1).sub(smoothstep(.015,.08,abs(meso.sub(.5))));
 const rockIndex=uniform(0,'uint').onObjectUpdate(({object})=>object.userData.rockIndex??ROCKS.length);
 const rockWater=mix(fields.gpuRockState.element(rockIndex.mul(8).add(4)),fields.gpuRockState.element(rockIndex.mul(8).add(3)),U.alpha);
 const rockWet=float(1).sub(smoothstep(rockWater.sub(.02),rockWater.add(.18).add(meso.mul(.13)),positionWorld.y));
 const rockColor=mix(color('#444844'),color('#b8a17a'),stoneMacro.mul(.58).add(middle.mul(.42)));
 const mineral=smoothstep(.015,.002,abs(sin(positionWorld.x.mul(.93).sub(positionWorld.z.mul(.52)).add(positionWorld.y.mul(.7)).add(middle.mul(.56))))).mul(.06);
 rock.colorNode=rockColor.mul(mix(.72,1.2,middle)).mul(mix(.78,1.1,meso)).mul(mix(1,.88,fractures)).mul(mix(.85,1.13,grain)).add(color('#c3b392').mul(mineral)).mul(mix(1,.53,rockWet));
 rock.roughnessNode=mix(float(.91),float(.32),rockWet);
 rock.normalNode=bumpMap(middle.mul(.028).add(meso.mul(.012)).add(grain.mul(.004)).sub(fractures.mul(.003)),.6);
 rock.envNode=sky(reflectVector,float(0)).mul(.17);

 const mirror=reflector({resolutionScale:.6,generateMipmaps:true,bounces:false,depth:true});
 mirror.target.rotation.x=-Math.PI/2;
 const water=new THREE.MeshBasicNodeMaterial({transparent:true,depthWrite:true,side:THREE.FrontSide});
 // Geometry, visibility, normals and foam all use one temporal interpolation.
 // The signed depth is interpolated over exactly the same triangles as the sand.
 const vp=positionLocal.xz,blend=domain(vp).toVar(),near=field('surface',vp).toVar(),far=offshore(vp).toVar();
 const geometryFade=float(1).sub(smoothstep(180,1400,length(vp.sub(cameraPosition.xz))));
 const baseHeight=mix(far.x,near.x,blend);
 const waterDepth=mix(far.x.sub(attribute('sandHeight','float')),near.y,blend);
 const rip=ripple(vp,max(0,waterDepth)).toVar();
 const vertexHeight=mix(U.tide,baseHeight.add(rip.x),geometryFade);
 water.positionNode=vec3(positionLocal.x,vertexHeight,positionLocal.z);
 const surfaceState=varying(vec4(vertexHeight,min(vertexHeight.sub(attribute('sandHeight','float')),waterDepth.add(rip.x)),near.z.mul(blend),near.w.mul(blend)),'shoreSurface');
 const surfaceSlope=varying(mix(far.yz,field('flow',vp).zw,blend).add(rip.yz).mul(geometryFade),'shoreSlope');
 const surfaceMaterial=varying(field('material',vp),'shoreMaterial');
 const waterColor=Fn(()=>{
  const wp=positionWorld.xz;
  const st=surfaceState,depth=max(0,st.y);
  If(st.y.lessThanEqual(0),()=>Discard());
  const distance=length(cameraPosition.sub(positionWorld));
  const hx=surfaceSlope.x,hz=surfaceSlope.y;
  const rippleUV=mix(wp,surfaceMaterial.ba,.55);
  const coarse=noise(rippleUV.mul(.047).add(vec2(U.time.mul(.007),U.time.mul(-.003)))).rg.sub(.5);
  const small=noise(rippleUV.mul(.18).add(coarse.mul(.10)).add(vec2(U.time.mul(-.011),U.time.mul(.006)))).ga.sub(.5);
  const micro=coarse.mul(.25).add(small.mul(.12)).mul(float(1).sub(smoothstep(70,320,distance))).mul(smoothstep(.015,.3,depth));
  const normalFade=float(1).sub(smoothstep(90,950,distance));
  const rippleDamping=float(1).sub(st.z.mul(.55).clamp(0,.7));
  const normal=normalize(vec3(hx.negate().add(micro.x.mul(rippleDamping)).mul(normalFade),1,hz.negate().add(micro.y.mul(rippleDamping)).mul(normalFade))).toVar();
  const sunVisibility=shadow(sunLight).r.mul(cloudShadow).toVar();
  const eye=normalize(cameraPosition.sub(positionWorld));
  const ndv=clamp(dot(normal,eye),.015,1);
  const fresnel=float(.021).add(pow(float(1).sub(ndv),5).mul(.979));
  const mat=surfaceMaterial;
  const advected=mat.ba;
  const n0=noise(advected.mul(.075)).r;
  const n1=noise(advected.mul(.35).add(n0.mul(.37))).r;
  const n2=noise(advected.mul(1.35).add(n1.mul(.21))).g;
  const density=st.z.mul(.8).add(st.w.mul(.5));
  const lace=n0.mul(.36).add(n1.mul(.42)).add(n2.mul(.22));
  const threshold=float(.74).sub(density.mul(.19));
  const aa=max(.018,fwidth(lace).mul(.8));
  const coverage=smoothstep(threshold.sub(aa),threshold.add(aa),lace).mul(smoothstep(.025,.15,density));
  const fineEdge=noise(advected.mul(4.3)).a;
  const holes=smoothstep(.62,.77,n2).mul(float(1).sub(st.z.mul(.7)));
  // Thin connected foam filaments remain behind a dense breaking crest.
  const filamentWidth=float(.012).add(density.mul(.018));
  const filaments=float(1).sub(smoothstep(filamentWidth,filamentWidth.add(.04),abs(n1.sub(.5))));
  const foamPatches=smoothstep(.35,.62,n0.add(st.z.mul(.14)));
  const laceCoverage=filaments.mul(smoothstep(.12,.7,density)).mul(.78).add(coverage.mul(smoothstep(.4,.85,st.z))).mul(foamPatches).clamp();
  const foam=laceCoverage.mul(U.foamShow).mul(float(1).sub(holes.mul(.62))).mul(mix(.8,1,fineEdge)).mul(smoothstep(.003,.025,depth)).toVar();
  // Perspective-aware, depth-sensitive refraction; reject any distorted sample
  // whose depth belongs in front of the water (clean above-water silhouettes).
  const normalScreen=mainView.mul(vec4(normal,0)).xy;
  const offset=normalScreen.mul(min(depth,.8)).mul(.035).div(max(1,distance.mul(.15)));
  const rUV=clamp(screenUV.add(offset),vec2(.002),vec2(.998));
  const backgroundZ=perspectiveDepthToViewZ(viewportDepthTexture(rUV),cameraNear,cameraFar);
  const guard=smoothstep(.005,.12,positionView.z.sub(backgroundZ));
  // Refraction samples level zero only; avoid building an unused mip chain.
  const refracted=viewportTexture(mix(screenUV,rUV,guard),float(0)).rgb;
  const opticalDepth=min(depth.div(max(.22,ndv)),20);
  const transmission=exp(vec3(-.86,-.28,-.18).mul(opticalDepth));
  const seaBase=mix(color('#176376'),color('#073448'),smoothstep(.35,3.5,depth));
  const transmitted=refracted.mul(transmission).add(seaBase.mul(vec3(1).sub(transmission)));
  const distortion=normal.xz.mul(.014).div(max(1,distance.mul(.028))).mul(float(1).sub(foam.mul(.8)));
  // Project the displaced surface into the reflected camera. Plain screen UVs
  // align only at mean sea level and otherwise leave a false band at rocks.
  const mirrorClip=mainProjection.mul(vec4(positionWorld.x,U.tide.mul(2).sub(positionWorld.y),positionWorld.z,1));
  const mirrorProjected=vec2(float(.5).sub(mirrorClip.x.div(mirrorClip.w).mul(.5)),float(.5).sub(mirrorClip.y.div(mirrorClip.w).mul(.5)));
  const mirrorUV=clamp(mirrorProjected.add(distortion),vec2(.002),vec2(.998));
  const reflected=mirror.sample(mirrorUV).level(float(.75).add(U.strength.mul(.22))).rgb;
  const reflectedDepth=mirror.getDepthNode().sample(mirrorUV).r;
  const reflectionDirection=reflect(eye.negate(),normal);
  const edgeGuard=smoothstep(.006,.055,mirrorProjected.x).mul(float(1).sub(smoothstep(.945,.994,mirrorProjected.x))).mul(smoothstep(.006,.04,mirrorProjected.y)).mul(float(1).sub(smoothstep(.96,.994,mirrorProjected.y)));
  const reflectedObject=float(1).sub(smoothstep(.9998,.99998,reflectedDepth));
  const reflectionColor=mix(sky(reflectionDirection,float(0)),reflected,edgeGuard.mul(reflectedObject));
  // GGX sun reflection: a narrow bright core with a roughness-dependent tail.
  // Derivative variance broadens distant highlights instead of sparkling.
  const halfVector=normalize(eye.add(U.sun));
  const ndh=max(dot(normal,halfVector),0),ndl=max(dot(normal,U.sun),0);
  const variance=dot(dFdx(normal),dFdx(normal)).add(dot(dFdy(normal),dFdy(normal))).mul(.3);
  const roughness=float(.085).add(foam.mul(.22));
  const a2=roughness.pow(4).add(variance).clamp(.00008,.12);
  const denominator=ndh.mul(ndh).mul(a2.sub(1)).add(1);
  const distribution=a2.div(denominator.mul(denominator).mul(Math.PI));
  const masking=ndl.div(ndl.mul(.92).add(.08)).mul(ndv.div(ndv.mul(.92).add(.08)));
  const sunFresnel=float(.021).add(pow(float(1).sub(max(dot(eye,halfVector),0)),5).mul(.979));
  const sunGlint=distribution.mul(masking).mul(sunFresnel).div(max(.06,ndv.mul(4))).mul(.055).mul(float(1).sub(U.overcast.mul(.85))).mul(sunVisibility);
  const result=mix(transmitted,reflectionColor,fresnel.mul(.90)).add(U.sunColor.mul(sunGlint)).toVar();
  const crestLight=pow(max(dot(eye,U.sun.negate()),0),3).mul(smoothstep(.04,.22,hx.abs())).mul(float(1).sub(smoothstep(.6,2,depth))).mul(.16);
  result.addAssign(vec3(.18,.44,.34).mul(crestLight).mul(float(1).sub(U.overcast)));
  const foamLight=float(.78).add(max(dot(normal,U.sun),0).mul(.22).mul(sunVisibility)).mul(mix(1,.94,U.overcast));
  const ivory=mix(color('#c9dadf'),color('#f5f5ec'),sunVisibility).mul(foamLight);
  result.assign(mix(result,ivory,foam));
  const haze=float(1).sub(exp(distance.mul(-.00056)));
  result.assign(mix(result,color('#adc2ca'),haze));
  If(U.inspection.greaterThan(.5),()=>{const face=normalize(cross(dFdx(positionWorld),dFdy(positionWorld)));result.assign(color('#397287').mul(dot(face,U.sun).abs().mul(.7).add(.3)));});
  return vec4(result,smoothstep(0,.004,depth));
 });
 water.fragmentNode=waterColor();
 return {U,bindFields,updateCamera,sunLight,skyMaterial,sand,rock,water,mirror,sky,height,domain,field,fieldUV,noiseTex};
}
