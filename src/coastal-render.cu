// GPU preparation and render data. Compiled together with coastal-kernels.cu.
__global__ void initializeWaves(float *B,const float *W,int nx,int nz,float x0,float dx){
 int i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=nx)return;
 int n=nx*nz;float x=x0+(float)i*dx;
 for(int w=0;w<4;w++){
  float phase=W[w*5+1]*(x-52.0f);
  B[n+w*2*nx+i]=cosf(phase)*W[w*5];
  B[n+w*2*nx+nx+i]=sinf(phase)*W[w*5];
 }
}
__global__ void updateControls(float *Controls,float dt,float strengthTarget,float windTarget,float tideTarget){
 if(blockIdx.x*blockDim.x+threadIdx.x!=0)return;
 float blend=fminf(1.0f,dt*.55f);
 Controls[0]+=(strengthTarget-Controls[0])*blend;Controls[1]+=(windTarget-Controls[1])*blend;Controls[2]+=(tideTarget-Controls[2])*blend;
}
__global__ void prepareRows(float *B,const float *W,const float *Controls,int nx,int nz,float z0,float dz,float time){
 int j=blockIdx.x*blockDim.x+threadIdx.x;if(j>=nz)return;
 int n=nx*nz;float z=z0+(float)j*dz,wind=Controls[1],strength=Controls[0];
 for(int w=0;w<4;w++){
  float phase=z*(W[w*5+3]+wind*.0174532925199433f*.055f)+W[w*5+2]*time+W[w*5+4];
  B[n+8*nx+w*2*nz+j]=cosf(phase);B[n+8*nx+w*2*nz+nz+j]=sinf(phase);
 }
 B[n+8*nx+8*nz+j]=strength*(.79f+.16f*sinf(time*.071f+z*.018f)+.10f*sinf(time*.117f-z*.031f));
}
__global__ void reconstruct(const float *S,float *Eta,int nx,int nz){
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;if(k>=n)return;
 int i=k%nx,j=k/nx;const float *bed=S;const float *h=S+2*n;
 float raw=bed[k]+h[k];if(h[k]>=.0005f){Eta[k]=raw;return;}
 float level=bed[k]-.025f,best=1e30f;bool found=false;
 for(int axis=0;axis<4;axis++){
  int d=axis==0?-1:axis==1?1:axis==2?-nx:nx;
  if((axis==0&&i==0)||(axis==1&&i==nx-1)||(axis==2&&j==0)||(axis==3&&j==nz-1))continue;
  int q=k+d;if(h[q]<.0005f)continue;
  float neighbor=bed[q]+h[q],score=fabsf(neighbor-bed[k]);
  if(score<best){best=score;level=neighbor;found=true;}
 }
 float dry=fminf(bed[k]-.0005f,found?level:bed[k]-.025f),t=h[k]/.0005f;
 Eta[k]=dry+(raw-dry)*t*t;
}
// Eight directional gravity-wave bands with deep-water dispersion. This is
// render-scale detail, not extra water volume. Fade at dry land, domain seams,
// and breaking foam; the solver's conservative depth is left untouched.
__global__ void surfaceDetail(const float *S,const float *Aux,const float *DetailW,const float *Controls,float *Eta,int nx,int nz,float x0,float z0,float dx,float dz,float time){
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;if(k>=n)return;
 int i=k%nx,j=k/nx;float depth=S[2*n+k];if(depth<.025f)return;
 float edge=smooth(0.0f,8.0f,(float)min(min(i,nx-1-i),min(j,nz-1-j)));
 float fade=smooth(.025f,.65f,depth)*edge*(1.0f-.8f*cap(S[5*n+k]+Aux[2*n+k],0.0f,1.0f));
 float x=x0+(float)i*dx,z=z0+(float)j*dz,angle=Controls[1]*.0174532925f,c=cosf(angle),s=sinf(angle),height=0;
 for(int w=0;w<8;w++){
  int a=w*4;float kx=DetailW[a]*c-DetailW[a+1]*s,kz=DetailW[a]*s+DetailW[a+1]*c;
  float phase=x*kx+z*kz+time*DetailW[a+2]+(float)w*2.39996323f;
  height+=DetailW[a+3]*(cosf(phase)+.18f*cosf(2.0f*phase));
 }
 Eta[k]+=height*fade*Controls[0];
}
// Padded row pitch allows three GPU buffer-to-texture copies, with no host data.
__global__ void packFields(const float *S,const float *Eta,float4 *Out,int nx,int nz,int pitch,float dx,float dz){
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;if(k>=n)return;
 int i=k%nx,j=k/nx,q=j*pitch+i,size=pitch*nz;
 const float *bed=S;const float *h=S+2*n;float e=Eta[k];
 Out[q]=make_float4(e,e-bed[k],S[5*n+k],S[6*n+k]);
 Out[size+q]=make_float4(S[7*n+k],S[8*n+k],S[9*n+k],S[10*n+k]);
 bool l=i>0&&h[k-1]>=.0005f&&fminf(e,Eta[k-1])>fmaxf(bed[k],bed[k-1]);
 bool r=i<nx-1&&h[k+1]>=.0005f&&fminf(e,Eta[k+1])>fmaxf(bed[k],bed[k+1]);
 bool b=j>0&&h[k-nx]>=.0005f&&fminf(e,Eta[k-nx])>fmaxf(bed[k],bed[k-nx]);
 bool f=j<nz-1&&h[k+nx]>=.0005f&&fminf(e,Eta[k+nx])>fmaxf(bed[k],bed[k+nx]);
 float gx=(r||l)?((r?Eta[k+1]:e)-(l?Eta[k-1]:e))/(dx*(l&&r?2.0f:1.0f)):0.0f;
 float gz=(b||f)?((f?Eta[k+nx]:e)-(b?Eta[k-nx]:e))/(dz*(b&&f?2.0f:1.0f)):0.0f;
 Out[2*size+q]=make_float4(S[3*n+k],S[4*n+k],gx,gz);
}
__device__ float sampleScalar(const float *p,float x,float z,int nx,int nz,float x0,float z0,float dx,float dz){
 float bx=cap((x-x0)/dx,0.0f,(float)nx-1.001f),bz=cap((z-z0)/dz,0.0f,(float)nz-1.001f);
 int ix=(int)bx,iz=(int)bz;float fx=bx-(float)ix,fz=bz-(float)iz;
 return adv(p,iz*nx+ix,nx,1.0f-fx,fx,1.0f-fz,fz);
}
__device__ float sminRock(float a,float b,float k){float t=cap(.5f+.5f*(b-a)/k,0.0f,1.0f);return b*(1.0f-t)+a*t-k*t*(1.0f-t);}
// Rock descriptors: x,z,rx,rz,h,seed,base,cos(rotation),sin(rotation),padding.
__device__ float rockHeight(const float *R,int r,float x,float z){
 int o=r*10;float xx=x-R[o],zz=z-R[o+1];
 float a=(R[o+7]*xx+R[o+8]*zz)/R[o+2],b=(-R[o+8]*xx+R[o+7]*zz)/R[o+3];
 float theta=atan2f(b,a),edge=1.0f+.075f*sinf(theta*3.0f+R[o+5])+.037f*cosf(theta*5.0f-R[o+5]);
 float q=powf(fabsf(a/edge),2.65f)+powf(fabsf(b/edge),2.65f);if(q>=1.0f)return -100.0f;
 float worn=powf(1.0f-q,.37f),top=sminRock(worn,.76f+.12f*a-.095f*b,.055f);
 top=sminRock(top,.97f+.58f*a+.21f*b,.048f);top=sminRock(top,1.06f-.24f*a-.69f*b,.050f);top=sminRock(top,1.08f+.18f*a+.68f*b,.05f);
 float fracture=.022f*expf(-fabsf(a+.39f*b-.16f)*65.0f)*smooth(.2f,.9f,top);
 float strata=.010f*sinf(a*14.0f+b*7.0f+R[o+5])+.006f*sinf(a*29.0f-b*17.0f);
 return R[o+6]+R[o+4]*(top+strata*worn-fracture);
}
__device__ float randomSpray(unsigned int seed){
 seed=seed*1664525u+1013904223u;seed=(seed^(seed>>16))*2246822519u;seed=seed^(seed>>13);
 return (float)(seed&16777215u)/16777216.0f;
}
__device__ float terrain(float x,float z){
 float d=x-(-1.7f+2.3f*sinf(z*.027f)+.00042f*z*z);
 float y=d<0.0f?-d*.086f+.075f*sinf(d*.26f)*smooth(-1.0f,-13.0f,d):-d*.059f-.00020f*d*d;
 if(d<-20.0f)y=1.79f+1.75f*(1.0f-expf((d+20.0f)*.03f));
 float bar=(d-12.0f)/5.5f;y+=.19f*expf(-bar*bar);
 float channel=sinf(z*.42f+sinf(x*.33f)*.6f),bank=(d-1.0f)/13.0f;
 y-=.052f*expf(-channel*channel*22.0f)*expf(-bank*bank);
 y+=.024f*sinf(z*.74f+x*.18f)*sinf(x*.83f-z*.12f)*expf(-fabsf(d)*.045f);
 float holeX=(x+1.3f)/2.4f,holeZ=(z-2.4f)/4.5f;y-=.065f*expf(-holeX*holeX-holeZ*holeZ);
 return y;
}
__global__ void initializeState(float *S,float *B,const float *R,int nx,int nz,float x0,float z0,float dx,float dz,int rockCount,int hydrated){
 int k=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz;if(k>=n)return;
 int i=k%nx,j=k/nx;float x=x0+(float)i*dx,z=z0+(float)j*dz;
 float sand=terrain(x,z),bed=sand;
 for(int r=0;r<rockCount;r++){
  int o=r*10;if(fabsf(x-R[o])<R[o+2]*1.35f&&fabsf(z-R[o+1])<R[o+3]*1.4f)bed=fmaxf(bed,rockHeight(R,r,x,z)-.035f);
 }
 S[k]=bed;S[n+k]=sand;
 B[k]=fmaxf(smooth((float)nx-26.0f,(float)nx-2.0f,(float)i),fmaxf(smooth(12.0f,0.0f,(float)j),smooth((float)nz-13.0f,(float)nz-1.0f,(float)j)));
 if(hydrated==0){S[2*n+k]=fmaxf(0.0f,-bed);S[7*n+k]=smooth(.3f,-.1f,sand);S[9*n+k]=x;S[10*n+k]=z;}
}
// One thread owns each rock and its 24 particle slots: no atomics or CPU spawn.
// RockState records: sampled level,time,last hit,wet reach,previous reach,total,cursor,pad.
__global__ void initializeContacts(float *RockState,int rockCount,float time){
 int r=blockIdx.x*blockDim.x+threadIdx.x;if(r>rockCount)return;
 int a=r*8;RockState[a]=0;RockState[a+1]=time;RockState[a+2]=-10;RockState[a+3]=r==rockCount?.2f:.24f;
 RockState[a+4]=RockState[a+3];RockState[a+5]=0;RockState[a+6]=0;RockState[a+7]=0;
}
__global__ void rockSpray(const float *S,const float *Eta,const float *R,const float *Controls,float *RockState,float *Particles,int nx,int nz,int rockCount,int step,float x0,float z0,float dx,float dz,float time){
 int r=blockIdx.x*blockDim.x+threadIdx.x;if(r>=rockCount)return;
 int n=nx*nz,o=r*10,a=r*8;float strength=Controls[0];
 float x=R[o]+R[o+2]*1.1f,z=R[o+1];
 float level=sampleScalar(Eta,x,z,nx,nz,x0,z0,dx,dz);
 float bed=sampleScalar(S,x,z,nx,nz,x0,z0,dx,dz);
 float speed=-sampleScalar(S+3*n,x,z,nx,nz,x0,z0,dx,dz),depth=level-bed;
 float dt=fmaxf(.02f,time-RockState[a+1]),rise=(level-RockState[a])/dt;
 float wetLevel=sampleScalar(Eta,R[o]+R[o+2]*1.16f,z,nx,nz,x0,z0,dx,dz);
 RockState[a+4]=RockState[a+3];RockState[a+3]=fmaxf(RockState[a+3]-.008f*dt,wetLevel+.07f);
 if(depth>.08f&&speed>.6f&&rise>.08f&&time-RockState[a+2]>.35f&&R[o+6]+R[o+4]>level+.15f){
  int amount=min(12,(int)(2.0f+speed*3.0f*strength)),cursor=(int)RockState[a+6];
  for(int j=0;j<amount;j++){
   unsigned int seed=(unsigned int)(r*7919+step*173+j*37);
   float zz=z+(randomSpray(seed)-.5f)*R[o+3]*1.3f,xx=R[o]+R[o+2]*1.5f;
   for(int b=0;b<25;b++){if(rockHeight(R,r,xx,zz)>level)break;xx-=R[o+2]*.06f;}
   int p=(r*24+cursor)*12;
   Particles[p]=xx+.03f;Particles[p+1]=level+.025f;Particles[p+2]=zz;Particles[p+3]=time;
   Particles[p+4]=.28f+randomSpray(seed+1u)*.35f;Particles[p+5]=.25f+randomSpray(seed+2u)*.55f;
   Particles[p+6]=.9f+randomSpray(seed+3u)*1.2f;Particles[p+7]=(randomSpray(seed+4u)-.5f)*.65f;
   Particles[p+8]=.012f+randomSpray(seed+5u)*.021f;cursor=(cursor+1)%24;
  }
  RockState[a+5]+=(float)amount;RockState[a+6]=(float)cursor;RockState[a+2]=time;
 }
 RockState[a]=level;RockState[a+1]=time;
}
// Each particle renders as a camera-facing quad using two shared float4 records.
__global__ void sprayVertices(const float *Particles,float4 *Spray,int count,float time){
 int k=blockIdx.x*blockDim.x+threadIdx.x;if(k>=count)return;
 int p=k*12;float t=time-Particles[p+3],life=Particles[p+4];
 if(t<0.0f||t>life||life<=0.0f){Spray[2*k]=make_float4(0,0,0,0);Spray[2*k+1]=make_float4(0,0,0,0);return;}
 Spray[2*k]=make_float4(Particles[p]+Particles[p+5]*t,Particles[p+1]+Particles[p+6]*t-4.905f*t*t,Particles[p+2]+Particles[p+7]*t,(1.0f-t/life)*.68f);
 Spray[2*k+1]=make_float4(Particles[p+8],Particles[p+8]*(1.4f+t),0,0);
}
// Hierarchical diagnostic reduction; only the 8-float final result is read back.
__global__ void metricsPartials(const float *S,float *Part,int nx,int nz,float dx,float dz){
 int group=blockIdx.x*blockDim.x+threadIdx.x,n=nx*nz,start=group*256;if(start>=n)return;
 float maxH=0,volume=0,foam=0,wet=0,bad=0;
 for(int k=start;k<min(start+256,n);k++){
  float h=S[2*n+k];maxH=fmaxf(maxH,h);volume+=h*dx*dz;foam+=S[5*n+k]+S[6*n+k];wet+=h>.006f?1.0f:0.0f;
  if(!isfinite(h+S[3*n+k]+S[4*n+k]))bad+=1.0f;
 }
 Part[group*5]=maxH;Part[group*5+1]=volume;Part[group*5+2]=foam;Part[group*5+3]=wet;Part[group*5+4]=bad;
}
__global__ void metricsFinish(const float *Part,const float *RockState,float *Result,int groups,int rockCount,float time){
 if(blockIdx.x*blockDim.x+threadIdx.x!=0)return;
 float maxH=0,volume=0,foam=0,wet=0,bad=0,total=0;
 for(int i=0;i<groups;i++){maxH=fmaxf(maxH,Part[i*5]);volume+=Part[i*5+1];foam+=Part[i*5+2];wet+=Part[i*5+3];bad+=Part[i*5+4];}
 for(int i=0;i<rockCount;i++)total+=RockState[i*8+5];
 Result[0]=maxH;Result[1]=volume;Result[2]=foam;Result[3]=wet;Result[4]=bad;Result[5]=total;Result[6]=RockState[3];Result[7]=time;
}
__device__ float noiseHash(int x,int y){
 unsigned int h=(unsigned int)x*374761393u+(unsigned int)y*668265263u;
 h=(h^(h>>13))*1274126177u;return (float)(h^(h>>16))/4294967295.0f;
}
__device__ float noiseValue(float x,float y,int p){
 int ix=(int)floorf(x),iy=(int)floorf(y);float a=x-(float)ix,b=y-(float)iy;
 a=a*a*(3.0f-2.0f*a);b=b*b*(3.0f-2.0f*b);int xx=((ix%p)+p)%p,yy=((iy%p)+p)%p;
 return (noiseHash(xx,yy)*(1.0f-a)+noiseHash((xx+1)%p,yy)*a)*(1.0f-b)+(noiseHash(xx,(yy+1)%p)*(1.0f-a)+noiseHash((xx+1)%p,(yy+1)%p)*a)*b;
}
__global__ void generateNoise(unsigned int *Noise,int size){
 int k=blockIdx.x*blockDim.x+threadIdx.x;if(k>=size*size)return;
 int x=k%size,y=k/size;float s=(float)x/(float)size,t=(float)y/(float)size;
 float value=noiseValue(s*8.0f,t*8.0f,8)*.48f+noiseValue(s*16.0f,t*16.0f,16)*.27f+noiseValue(s*32.0f,t*32.0f,32)*.15f+noiseValue(s*64.0f,t*64.0f,64)*.1f;
 unsigned int r=(unsigned int)floorf(value*255.0f+.5f),g=(unsigned int)floorf(noiseValue(s*48.0f+3.1f,t*48.0f+8.2f,48)*255.0f+.5f);
 unsigned int b=(unsigned int)floorf(noiseHash(x,y)*255.0f+.5f),a=(unsigned int)floorf(noiseValue(s*128.0f,t*128.0f,128)*255.0f+.5f);
 Noise[k]=r|(g<<8)|(b<<16)|(a<<24);
}
