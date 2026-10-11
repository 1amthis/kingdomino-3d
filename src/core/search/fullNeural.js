// CPU inference companion for the PyTorch-trained spatial residual network.
// 24x9x9 input -> 16 feature maps -> 2 residual blocks -> 4x9x9 placement
// logits, 4 draft logits, 1 discard logit, and tanh game outcome value.
// Weight order is PyTorch contiguous [out,in,ky,kx]. JSON schema version 2.
import { rawFullObservation, spatialFull, moveIndex, FULL_AUX, FULL_SPATIAL_CHANNELS } from './fullObservation.js';
const SIZE=9, AREA=81, CHANNELS=16;
function asArray(a,length,label){
  if(!Array.isArray(a)||a.length!==length)throw Error('Bad weight '+label+' expected '+length);
  const result=Float32Array.from(a);
  if(!result.every(Number.isFinite))throw Error('Non-finite weight '+label);
  return result;
}
function convolution(input,weights,bias,cin,cout,k=3){
  const out=new Float32Array(cout*AREA),pad=(k-1)>>1;
  for(let oc=0;oc<cout;oc++){
    const end=oc*AREA,b=bias[oc];
    out.fill(b,end,end+AREA);
    for(let ic=0;ic<cin;ic++){
      const ib=ic*AREA,wb=(oc*cin+ic)*k*k;
      for(let ky=0;ky<k;ky++)for(let kx=0;kx<k;kx++){
        const w=weights[wb+ky*k+kx];
        if(!w)continue;
        const dy=ky-pad,dx=kx-pad;
        for(let y=Math.max(0,-dy);y<Math.min(SIZE,SIZE-dy);y++){
          const src=ib+(y+dy)*SIZE,outRow=end+y*SIZE;
          for(let x=Math.max(0,-dx);x<Math.min(SIZE,SIZE-dx);x++)out[outRow+x]+=w*input[src+x+dx];
        }
      }
    }
  }
  return out;
}
function relu(a){for(let i=0;i<a.length;i++)if(a[i]<0)a[i]=0;return a;}
function dense(input,w,b,rows,cols){
  const out=new Float32Array(rows);
  for(let i=0;i<rows;i++){
    let v=b[i],base=i*cols;
    for(let j=0;j<cols;j++)v+=w[base+j]*input[j];
    out[i]=v;
  }
  return out;
}
export class FullNeuralNet {
  constructor(json){
    if(json.version!==2||json.channels!==CHANNELS||json.aux!==FULL_AUX)throw Error('Unsupported spatial network format');
    this.w={};
    const dims={
      stem:[CHANNELS,FULL_SPATIAL_CHANNELS,3],
      res0a:[CHANNELS,CHANNELS,3],res0b:[CHANNELS,CHANNELS,3],
      res1a:[CHANNELS,CHANNELS,3],res1b:[CHANNELS,CHANNELS,3],
      place:[4,CHANNELS,1],
      aux_fc:[32,FULL_AUX,0],
      draft:[4,48,0],discard:[1,48,0],value:[1,48,0],
    };
    for(const [key,[rows,cols,k]] of Object.entries(dims)){
      this.w[key+'W']=asArray(json[key+'W'],rows*cols*(k?k*k:1),key+'W');
      this.w[key+'B']=asArray(json[key+'B'],rows,key+'B');
    }
  }
  forward(board,aux){
    if(aux.length!==FULL_AUX)throw Error('Invalid aux length');
    const w=this.w,spatial=spatialFull(board,aux);
    let h=relu(convolution(spatial,w.stemW,w.stemB,FULL_SPATIAL_CHANNELS,CHANNELS));
    for(let block=0;block<2;block++){
      const id='res'+block,a=relu(convolution(h,w[id+'aW'],w[id+'aB'],CHANNELS,CHANNELS)),
      b=convolution(a,w[id+'bW'],w[id+'bB'],CHANNELS,CHANNELS);
      for(let i=0;i<h.length;i++)h[i]=Math.max(0,h[i]+b[i]);
    }
    const p=convolution(h,w.placeW,w.placeB,CHANNELS,4,1),pooled=new Float32Array(48);
    for(let c=0;c<CHANNELS;c++){
      let v=0;for(let i=0;i<AREA;i++)v+=h[c*AREA+i];
      pooled[c]=v/AREA;
    }
    const a=relu(dense(aux,w.aux_fcW,w.aux_fcB,32,FULL_AUX));
    pooled.set(a,16);
    return {
      place:p,
      draft:dense(pooled,w.draftW,w.draftB,4,48),
      discard:dense(pooled,w.discardW,w.discardB,1,48)[0],
      value:Math.tanh(dense(pooled,w.valueW,w.valueB,1,48)[0]),
    };
  }
  evaluate(game,moves=null){
    const {board,aux}=rawFullObservation(game),out=this.forward(board,aux);
    const legal=moves||game.legal(),logits=new Float64Array(legal.length);
    for(let i=0;i<legal.length;i++){
      const idx=moveIndex(game,legal[i]);
      logits[i]=game.phase===1?(idx===324?out.discard:out.place[idx]):out.draft[idx];
    }
    let max=-Infinity;
    for(const x of logits)max=Math.max(max,x);
    const prior=new Map();let sum=0;
    for(let i=0;i<legal.length;i++){logits[i]=Math.exp(logits[i]-max);sum+=logits[i];}
    if(!(sum>0)||!Number.isFinite(sum))throw Error('Invalid policy normalizer');
    for(let i=0;i<legal.length;i++)prior.set(legal[i],logits[i]/sum);
    return {priors:prior,value:out.value};
  }
}
