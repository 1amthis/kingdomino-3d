// Tiny CPU neural policy/value network. No external inference runtime is required.
// Input: raw 9x9 terrain/crowns for both players, visible draft dominos, masks and flags.
// Architecture: dense 355 -> 64 ReLU -> 64 ReLU -> 4 draft logits + 1 value (tanh).
// Training and weight serialization live under scripts/neural/.
import { encodeDraft, NEURAL_INPUT } from './neuralObservation.js';
import { mulberry32 } from '../rng.js';
export const NEURAL_HIDDEN = 64;
export const NEURAL_OUTPUT = 5;
export function makeNeuralWeights(seed=73451) {
  const rnd=mulberry32(seed);
  function matrix(n,m) {
    const s=Math.sqrt(2/n);
    return Array.from({length:n*m},()=>((rnd()+rnd()+rnd()+rnd())-2)*s*1.732);
  }
  return {version:1,inSize:NEURAL_INPUT,hidden:NEURAL_HIDDEN,
    w1:matrix(NEURAL_INPUT,64),b1:Array(64).fill(0),
    w2:matrix(64,64),b2:Array(64).fill(0),
    w3:matrix(64,5),b3:Array(5).fill(0)};
}
export class NeuralDraftNet {
  constructor(weights) {
    if(weights.version!==1||weights.inSize!==NEURAL_INPUT||weights.hidden!==64
       ||weights.w1.length!==NEURAL_INPUT*64||weights.w2.length!==64*64
       ||weights.w3.length!==64*5)throw Error('Invalid neural draft weights');
    this.w=Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,Array.isArray(v)?Float32Array.from(v):v]));
  }
  forward(input,mask=null) {
    const {w1,w2,w3,b1,b2,b3}=this.w;
    const a1=new Float32Array(64),a2=new Float32Array(64),logits=new Float32Array(4);
    for(let j=0;j<64;j++){
      let z=b1[j];for(let i=0;i<NEURAL_INPUT;i++)z+=input[i]*w1[i*64+j];
      a1[j]=Math.max(0,z);
    }
    for(let j=0;j<64;j++){
      let z=b2[j];for(let i=0;i<64;i++)z+=a1[i]*w2[i*64+j];
      a2[j]=Math.max(0,z);
    }
    for(let j=0;j<4;j++){
      let z=b3[j];for(let i=0;i<64;i++)z+=a2[i]*w3[i*5+j];
      logits[j]=mask&&!mask[j]?-1e6:z;
    }
    let value=b3[4];for(let i=0;i<64;i++)value+=a2[i]*w3[i*5+4];
    let best=-Infinity;for(let j=0;j<4;j++)best=Math.max(best,logits[j]);
    const probs=new Float32Array(4);let sum=0;
    for(let j=0;j<4;j++){if(mask&&!mask[j])continue;sum+=probs[j]=Math.exp(logits[j]-best);}
    for(let j=0;j<4;j++)probs[j]/=sum||1;
    return {policy:probs,value:Math.tanh(value),a1,a2,logits};
  }
  evaluate(game) {
    const observation=encodeDraft(game);
    const mask=observation.subarray(2*9*9*2+4*5,2*9*9*2+4*5+4);
    return this.forward(observation,mask);
  }
  asDraftPolicy() {return game=>this.evaluate(game).policy;}
  json(){const w=this.w;return Object.fromEntries(Object.entries(w).map(([k,v])=>v instanceof Float32Array?Array.from(v):v));}
}
