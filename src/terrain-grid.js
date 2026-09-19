import {terrainHeight,shoreline,smooth} from './coast.js?v=1.3.0';
export function axis(a,b,step,extent){
 const out=[];let v=a,d=step;
 while(v>-extent){v-=d;out.unshift(v);d*=1.14;}
 for(let i=0;i<=Math.round((b-a)/step);i++)out.push(a+i*step);
 v=b;d=step;while(v<extent){v+=d;out.push(v);d*=1.14;}
 return out;
}

export function land(x,z){
 const s=shoreline(Math.max(-180,Math.min(160,z))),d=x-s;
 let y=terrainHeight(d+shoreline(Math.max(-130,Math.min(90,z))),Math.max(-130,Math.min(90,z)));
 y+=(Math.sin(z*.034+x*.031)*.5+Math.sin(z*.07-x*.029)*.3)*smooth(-20,-65,d);
 y+=Math.exp(-(((z+260)/100)**2))*Math.exp(-(((d+34)/46)**2))*14*smooth(-120,-225,z)*smooth(10,-8,d);
 return y;
}
