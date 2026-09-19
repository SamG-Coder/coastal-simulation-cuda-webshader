import {GRID} from './coast.js?v=1.5.0';

// Host metadata only. Evolving cell fields live exclusively in CUDA buffers.
export class GpuState {
 constructor(config=GRID){
  this.g=config;this.n=config.nx*config.nz;this.time=0;this.steps=0;
  this.state={strength:1,wind:0,tide:0};this.target={...this.state};
 }
 configure(values){
  for(const key of ['strength','wind','tide'])if(Number.isFinite(values[key]))this.target[key]=values[key];
 }
}
