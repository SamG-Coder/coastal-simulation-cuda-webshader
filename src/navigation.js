import {ROCKS,rockLocal,collisionPosition} from './coast.js?v=1.5.1';

export function isInterfaceEvent(event){
 return !!event.target?.closest?.('button,input,select,textarea,a,summary,[contenteditable],#interface,#touch-pad');
}
export function clearSegment(a,b,margin=.58){
 for(const r of ROCKS){
  const [ax,az]=rockLocal(a.x,a.z,r),[bx,bz]=rockLocal(b.x,b.z,r);
  const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,-(ax*dx+az*dz)/(dx*dx+dz*dz||1)));
  if(Math.hypot(ax+dx*t,az+dz*t)<1.13+margin/Math.min(r.rx,r.rz))return false;
 }
 return true;
}
// A small static visibility graph gives preset transitions a collision-free
// horizontal route. Cameras still share one scene and one running simulation.
let graph=null;
function buildGraph(){
 const nodes=[];
 for(const r of ROCKS)for(let i=0;i<12;i++){
  const angle=i/12*Math.PI*2,radius=(1.13+.63/Math.min(r.rx,r.rz))*1.07;
  const a=Math.cos(angle)*radius*r.rx,b=Math.sin(angle)*radius*r.rz;
  const p={x:r.x+r.c*a-r.s*b,z:r.z+r.s*a+r.c*b};
  if(p.x< -10.5||p.x>34||p.z< -74||p.z>23)continue;
  const q=collisionPosition(p.x,p.z,.56);if(Math.hypot(q.x-p.x,q.z-p.z)<.001)nodes.push(p);
 }
 const edges=nodes.map(()=>[]);
 for(let i=0;i<nodes.length;i++)for(let j=0;j<i;j++)if(clearSegment(nodes[i],nodes[j])){const d=Math.hypot(nodes[i].x-nodes[j].x,nodes[i].z-nodes[j].z);edges[i].push([j,d]);edges[j].push([i,d]);}
 return{nodes,edges};
}
export function routeBetween(from,to){
 const start={x:from.x,z:from.z},end={x:to.x,z:to.z};
 if(clearSegment(start,end))return[start,end];
 graph??=buildGraph();
 const nodes=[start,end,...graph.nodes],edges=[[],[],...graph.edges.map(list=>list.map(([j,d])=>[j+2,d]))];
 for(let i=0;i<2;i++)for(let j=2;j<nodes.length;j++)if(clearSegment(nodes[i],nodes[j])){const d=Math.hypot(nodes[i].x-nodes[j].x,nodes[i].z-nodes[j].z);edges[i].push([j,d]);edges[j].push([i,d]);}
 const distance=new Float64Array(nodes.length).fill(Infinity),parent=new Int32Array(nodes.length).fill(-1),done=new Uint8Array(nodes.length);distance[0]=0;
 for(let step=0;step<nodes.length;step++){
  let u=-1;for(let i=0;i<nodes.length;i++)if(!done[i]&&(u<0||distance[i]<distance[u]))u=i;
  if(u<0||!Number.isFinite(distance[u]))break;if(u===1)break;done[u]=1;
  for(const [v,cost] of edges[u])if(distance[u]+cost<distance[v]){distance[v]=distance[u]+cost;parent[v]=u;}
 }
 if(parent[1]<0)return[start,end]; // Per-frame collision projection remains active.
 const path=[];for(let i=1;i>=0;i=parent[i])path.unshift(nodes[i]);return path;
}
export function prepareRoute(path){
 let length=0;const spans=[];
 for(let i=1;i<path.length;i++){const size=Math.hypot(path[i].x-path[i-1].x,path[i].z-path[i-1].z);spans.push({a:path[i-1],b:path[i],start:length,size});length+=size;}
 return{spans,length};
}
export function pointOnRoute(route,f){
 const distance=route.length*f,span=route.spans.find(s=>distance<=s.start+s.size)||route.spans.at(-1);
 const t=span.size?Math.max(0,Math.min(1,(distance-span.start)/span.size)):1;
 return{x:span.a.x+(span.b.x-span.a.x)*t,z:span.a.z+(span.b.z-span.a.z)*t};
}
