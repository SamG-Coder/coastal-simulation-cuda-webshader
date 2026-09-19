import * as THREE from 'three/webgpu';
export function makeNoiseTexture(size=512){
 const hash=(x,y)=>{let h=Math.imul(x,374761393)+Math.imul(y,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;};
 const value=(x,y,p)=>{const ix=Math.floor(x),iy=Math.floor(y);let a=x-ix,b=y-iy;a=a*a*(3-2*a);b=b*b*(3-2*b);const xx=((ix%p)+p)%p,yy=((iy%p)+p)%p;return (hash(xx,yy)*(1-a)+hash((xx+1)%p,yy)*a)*(1-b)+(hash(xx,(yy+1)%p)*(1-a)+hash((xx+1)%p,(yy+1)%p)*a)*b;};
 const data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const s=x/size,t=y/size,k=(y*size+x)*4;
  const f=value(s*8,t*8,8)*.48+value(s*16,t*16,16)*.27+value(s*32,t*32,32)*.15+value(s*64,t*64,64)*.1;
  data[k]=Math.round(f*255);
  data[k+1]=Math.round(value(s*48+3.1,t*48+8.2,48)*255);
  data[k+2]=Math.round(hash(x,y)*255);
  data[k+3]=Math.round(value(s*128,t*128,128)*255);
 }
 const tex=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
 tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.magFilter=THREE.LinearFilter;
 tex.minFilter=THREE.LinearMipmapLinearFilter;tex.generateMipmaps=true;tex.needsUpdate=true;
 return tex;
}
