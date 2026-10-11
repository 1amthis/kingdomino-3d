// Independent CPU convolution correctness check against PyTorch export.
import {readFileSync} from 'node:fs';
import {FullNeuralNet} from '../../src/core/search/fullNeural.js';
const model=new FullNeuralNet(JSON.parse(readFileSync(process.argv[2],'utf8')));
const ref=JSON.parse(readFileSync(process.argv[3],'utf8'));
const out=model.forward(Uint8Array.from(ref.board),Float32Array.from(ref.aux));
let worst=0,where='',count=0;
for(const field of ['draft','place']){
  if(out[field].length!==ref[field].length)throw Error('Shape mismatch '+field);
  for(let i=0;i<out[field].length;i++){
    const e=Math.abs(out[field][i]-ref[field][i]);
    if(e>worst){worst=e;where=field+'['+i+']';}
    count++;
  }
}
for(const field of ['discard','value']){
  const e=Math.abs(out[field]-ref[field]);
  if(e>worst){worst=e;where=field;}
  count++;
}
console.log('JS vs PyTorch, outputs',count,'max absolute error',worst,'at',where);
if(!Number.isFinite(worst)||worst>0.002)throw Error('Numerical parity failed');
