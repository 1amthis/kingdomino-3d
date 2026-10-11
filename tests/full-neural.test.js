import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game,PLACE,DONE,DISCARD} from '../src/core/search/engine.js';
import {Search} from '../src/core/search/mcts.js';
import {mulberry32} from '../src/core/rng.js';
import {rawFullObservation,spatialFull,moveIndex,FULL_SPATIAL_CHANNELS} from '../src/core/search/fullObservation.js';
import {FullNeuralNet} from '../src/core/search/fullNeural.js';

function initial(seed){
  const r=mulberry32(seed),ds=Array.from({length:48},(_,i)=>i);
  for(let i=47;i>0;i--){const j=(r()*(i+1))|0;[ds[i],ds[j]]=[ds[j],ds[i]];}
  const g=new Game(2,5,!!(seed&1),!!(seed&2));
  g.line=Int8Array.from(ds.slice(0,4).sort((a,b)=>a-b));
  g.own=new Int8Array(4).fill(-1);g.order=new Int8Array([0,1,1,0]);g.left=20;
  for(const d of g.line)g.seen[d]=1;g.determinize(r);return g;
}
function blankWeights(){
  const layers={stem:[16,24,3],res0a:[16,16,3],res0b:[16,16,3],
    res1a:[16,16,3],res1b:[16,16,3],place:[4,16,1],
    aux_fc:[32,106,0],draft:[4,48,0],discard:[1,48,0],value:[1,48,0]};
  const w={version:2,channels:16,aux:106};
  for(const [name,[o,i,k]] of Object.entries(layers)){
    w[name+'W']=Array(o*i*(k?k*k:1)).fill(0);
    w[name+'B']=Array(o).fill(0);
  }
  return w;
}
test('raw observation excludes the determinized secret deck',()=>{
  const g=initial(777),o=rawFullObservation(g);
  assert.equal(o.board.length,324);assert.equal(o.aux.length,106);
  assert.equal(spatialFull(o.board,o.aux).length,FULL_SPATIAL_CHANNELS*81);
  const before=JSON.stringify(o);
  g.deck.fill(41); // perturb private variable without changing public state
  assert.equal(JSON.stringify(rawFullObservation(g)),before);
});
test('all legal root moves map to unique spatial actions, including oriented dominoes',()=>{
  const g=initial(10),agent=new Search({seed:567});
  let placements=0;
  for(let step=0;g.phase!==DONE&&step<60;step++){
    const legal=g.legal(),indices=legal.map(m=>moveIndex(g,m));
    assert.equal(new Set(indices).size,indices.length);
    if(g.phase===PLACE){
      assert.ok(indices.every(i=>i>=0&&i<=324));
      placements+=legal.length;
    } else assert.ok(indices.every(i=>i<4));
    const move=agent.choose(g,{sims:20,ms:10000}).move;
    assert.ok(legal.includes(move));
    g.apply(move);if(g.nextLine)for(const d of g.nextLine)g.seen[d]=1;
  }
  assert.ok(placements>30);assert.equal(g.phase,DONE);
});
test('full neural model returns finite legal priors and can back up nonterminal values',()=>{
  const net=new FullNeuralNet(blankWeights()),g=initial(28);
  const p=net.evaluate(g,g.legal()).priors;
  assert.ok(Math.abs([...p.values()].reduce((a,b)=>a+b,0)-1)<1e-6);
  assert.ok([...p.values()].every(x=>x>0&&Number.isFinite(x)));
  const baselineA=new Search({seed:231}).choose(g.clone(),{sims:85,ms:10000});
  const baselineB=new Search({seed:231,fullNet:null}).choose(g.clone(),{sims:85,ms:10000});
  assert.deepEqual(baselineA,baselineB);
  const agents=[new Search({seed:40,fullNet:net,leafValueEvery:4,recordAllPolicy:true}),
    new Search({seed:41})];
  let roots=0,leafCases=0;
  for(let step=0;g.phase!==DONE&&step<60;step++){
    const act=g.player,legal=g.legal();
    const out=agents[act].choose(g,{sims:36,ms:10000});
    assert.ok(legal.includes(out.move));
    if(act===0&&legal.length>1){
      roots++;assert.equal(out.moves.length,out.visits.length);
      assert.ok(out.visits.reduce((a,b)=>a+b,0)>0);
    }
    leafCases+=agents[0].leafCalls;
    g.apply(out.move);if(g.nextLine)for(const d of g.nextLine)g.seen[d]=1;
  }
  assert.equal(g.phase,DONE);assert.ok(roots>0);assert.ok(leafCases>0);
  assert.ok(g.scores().every(Number.isFinite));
});
