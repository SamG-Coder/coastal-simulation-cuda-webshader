// All distances are metres. One continuous beach/seabed definition is shared
// by the flow solver, rendering, object placement and camera collision.
export const GRID = { nx: 241, nz: 401, x0: -14, z0: -92, dx: .3, dz: .3 };
export const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
export const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
export function shoreline(z) { return -1.7 + 2.3*Math.sin(z*.027) + .00042*z*z; }
export function terrainHeight(x,z) {
  const d=x-shoreline(z);
  let y = d<0 ? -d*.086 + .075*Math.sin(d*.26)*smooth(-1,-13,d) : -d*.059-.00020*d*d;
  if(d< -20)y=1.79+1.75*(1-Math.exp((d+20)*.03));
  // A gently submerged bar and two systems of shallow drainage channels.
  y += .19*Math.exp(-(((d-12)/5.5)**2));
  const channel=Math.sin(z*.42+Math.sin(x*.33)*.6);
  y -= .052*Math.exp(-channel*channel*22)*Math.exp(-(((d-1)/13)**2));
  y += .024*Math.sin(z*.74+x*.18)*Math.sin(x*.83-z*.12)*Math.exp(-Math.abs(d)*.045);
  y -= .065*Math.exp(-(((x+1.3)/2.4)**2)-((z-2.4)/4.5)**2);
  return y;
}

// Worn slate and greywacke: each stone has its own proportions and bearing.
export const ROCKS = [
 {x:2.3,z:2.0,rx:2.20,rz:1.73,h:2.45,rot:.27,seed:4},
 {x:4.45,z:.28,rx:.88,rz:.73,h:.69,rot:-.51,seed:8},
 {x:-1.8,z:-10.3,rx:1.12,rz:1.8,h:1.25,rot:-.6,seed:18},
 {x:7.7,z:-20.4,rx:2.8,rz:2.15,h:3.03,rot:.76,seed:26},
 {x:10.7,z:-22.6,rx:1.3,rz:1.65,h:1.69,rot:-.3,seed:31},
 {x:5.2,z:-23.4,rx:1.25,rz:.97,h:1.06,rot:.2,seed:32},
 {x:19.7,z:-42.4,rx:2.5,rz:1.48,h:2.39,rot:.93,seed:40},
 {x:22.6,z:-43.2,rx:1.2,rz:1.0,h:1.59,rot:1.8,seed:48},
 {x:1.0,z:-49.6,rx:2.48,rz:3.1,h:2.5,rot:.15,seed:53},
 {x:4.6,z:-52.0,rx:1.75,rz:1.33,h:1.66,rot:1.2,seed:62},
 {x:9.3,z:-69.0,rx:3.6,rz:2.62,h:3.4,rot:-.32,seed:75},
 {x:6.1,z:-72.2,rx:2.25,rz:1.51,h:2.1,rot:.1,seed:78},
 {x:14.4,z:-77.5,rx:2.2,rz:2.11,h:2.84,rot:2.0,seed:84},
 {x:32.0,z:-90.0,rx:3.7,rz:3.0,h:4.06,rot:.32,seed:89},
];
for(const r of ROCKS) { r.base=terrainHeight(r.x,r.z)-.28; r.c=Math.cos(r.rot); r.s=Math.sin(r.rot); }
export function rockLocal(x,z,r) { return [(r.c*(x-r.x)+r.s*(z-r.z))/r.rx,(-r.s*(x-r.x)+r.c*(z-r.z))/r.rz]; }
export function rockTop(x,z,r,detail=1) {
 const [a,b]=rockLocal(x,z,r);
 const theta=Math.atan2(b,a);
 const edge=1+.075*Math.sin(theta*3+r.seed)+.037*Math.cos(theta*5-r.seed);
 const q=Math.pow(Math.abs(a/edge),2.65)+Math.pow(Math.abs(b/edge),2.65);
 if(q>=1) return -100;
 const worn=Math.pow(1-q,.37);
 const smin=(u,v,k)=>{const h=clamp(.5+.5*(v-u)/k,0,1);return v*(1-h)+u*h-k*h*(1-h);};
 let cap=smin(worn,.76+.12*a-.095*b,.055);
 cap=smin(cap,.97+.58*a+.21*b,.048);
 cap=smin(cap,1.06-.24*a-.69*b,.050);
 cap=smin(cap,1.08+.18*a+.68*b,.05);
 const fracture=.022*Math.exp(-Math.abs(a+.39*b-.16)*65)*smooth(.2,.9,cap);
 const strata=.010*Math.sin(a*14+b*7+r.seed)+.006*Math.sin(a*29-b*17);
 return r.base+r.h*(cap+strata*worn*detail-fracture);
}
export function bedHeight(x,z) {
 let y=terrainHeight(x,z);
 for(const r of ROCKS) if(Math.abs(x-r.x)<r.rx*1.35&&Math.abs(z-r.z)<r.rz*1.4) y=Math.max(y,rockTop(x,z,r)-.035);
 return y;
}
// Incommensurate wave periods and slowly varying groups prevent a short loop.
// This exact expression is mirrored in TSL and imposed in the offshore sponge.
export const WAVES = [
 {a:.29,k:.192,w:.85,z:.072,p:.3},
 {a:.16,k:.263,w:1.13,z:-.063,p:2.1},
 {a:.072,k:.395,w:1.65,z:.117,p:4.7},
 {a:.034,k:.84,w:2.78,z:-.31,p:1.2}
];
export function incoming(x,z,t,state) {
 let eta=0;
 const group=.79+.16*Math.sin(t*.071+z*.018)+.10*Math.sin(t*.117-z*.031);
 const dir=state.wind*Math.PI/180;
 for(const v of WAVES){ const ph=v.k*(x-52)+z*(v.z+dir*.055)+v.w*t+v.p; eta += v.a*Math.cos(ph); }
 return state.tide+eta*state.strength*group;
}

export function collisionPosition(x,z,margin=.36) {
 x=clamp(x,-10.5,34);z=clamp(z,-74,23);
 for(let pass=0;pass<16;pass++){
  let moved=false;
  for(const r of ROCKS){
    const [a,b]=rockLocal(x,z,r);const q=Math.hypot(a,b);
    const bound=1.13+margin/Math.min(r.rx,r.rz);
    if(q<bound-1e-5){
      const aa=(q<.001?1:a/q)*bound,bb=(q<.001?0:b/q)*bound;
      x=r.x+r.c*aa*r.rx-r.s*bb*r.rz;z=r.z+r.s*aa*r.rx+r.c*bb*r.rz;moved=true;
    }
  }
  x=clamp(x,-10.5,34);z=clamp(z,-74,23);
  if(!moved)break;
 }
 return {x,z};
}
