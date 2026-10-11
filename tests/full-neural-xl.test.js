// Numeric inference and action-coverage test for wider residual networks.
// The same test is used to estimate CPU inference cost before large-scale training.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/core/search/engine.js';
import {FullNeuralNet} from '../src/core/search/fullNeural.js';
import {mulberry32} from '../src/core/rng.js';
function weights(ch,blocks,auxWidth) {
  const dims={stem:[ch,24,3],place:[4,ch,1],aux_fc:[auxWidth,106,0],
    draft:[4,ch+auxWidth,0],discard:[1,ch+auxWidth,0],value:[1,ch+auxWidth,0]};
  for(let i=0;i<blocks;i++)for(const c of 'ab')dims['res'+i+c]=[ch,ch,3];
  const w={version:3,channels:ch,blocks,auxWidth,aux:106};
  for(const [name,[o,i,k]] of Object.entries(dims)){
    w[name+'W']=Array.from({length:o*i*(k?k*k:1)},(_,idx)=>Math.sin(idx*0.13+o+i)*0.012);
    w[name+'B']=Array(o).fill(0);
  }
  return w;
}
test('larger spatial residual model runs end-to-end with valid legal priors',()=>{
  const model=new FullNeuralNet(weights(48,4,64));
  const g=new Game(2,5,false,false),rng=mulberry32(4051);
  g.line=Int8Array.from([0,9,12,31]);g.own=new Int8Array(4).fill(-1);
  g.order=new Int8Array([0,1,1,0]);g.left=20;
  for(const d of g.line)g.seen[d]=1;
  g.determinize(rng);
  const t0=performance.now(),r=model.evaluate(g,g.legal()),elapsed=performance.now()-t0;
  const p=[...r.priors.values()];
  assert.equal(p.length,4);
  assert.ok(Math.abs(p.reduce((a,b)=>a+b,0)-1)<1e-5);
  assert.ok(p.every(Number.isFinite));assert.ok(Number.isFinite(r.value));
  console.log('XL 48-channel four-block root inference ms:',elapsed.toFixed(1));
});
