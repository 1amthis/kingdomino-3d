import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, INIT, PICK, DONE } from '../src/core/search/engine.js';
import { Search } from '../src/core/search/mcts.js';
import { mulberry32 } from '../src/core/rng.js';
import { encodeDraft, NEURAL_INPUT } from '../src/core/search/neuralObservation.js';
import { NeuralDraftNet, makeNeuralWeights } from '../src/core/search/neuralPolicy.js';
function initial(seed=23){
 const r=mulberry32(seed),ds=Array.from({length:48},(_,i)=>i);
 for(let i=47;i>0;i--){const j=(r()*(i+1))|0;[ds[i],ds[j]]=[ds[j],ds[i]];}
 const g=new Game(2,5,!!(seed&1),!!(seed&2));
 g.line=Int8Array.from(ds.slice(0,4).sort((a,b)=>a-b));
 g.own=new Int8Array(4).fill(-1);g.order=new Int8Array([0,1,1,0]);g.left=20;
 for(const d of g.line)g.seen[d]=1;g.determinize(r);return g;
}
test('raw draft encoding and masked probability normalization',()=>{
 const g=initial();
 const x=encodeDraft(g);
 assert.equal(x.length,NEURAL_INPUT);
 const net=new NeuralDraftNet(makeNeuralWeights(17));
 const pred=net.evaluate(g);
 assert.ok(Math.abs([...pred.policy].reduce((a,b)=>a+b,0)-1)<1e-5);
 const restored=new NeuralDraftNet(net.json());
 assert.deepEqual([...pred.policy],[...restored.evaluate(g).policy]);
 g.apply(0);
 const next=net.evaluate(g);
 assert.equal(next.policy[0],0);
});
test('unguided MCTS is bit-for-bit unchanged and records genuine root visits',()=>{
 const g=initial(44);
 const a=new Search({seed:33}),b=new Search({seed:33,draftPolicy:null,recordPolicy:false});
 assert.deepEqual(a.choose(g.clone(),{sims:90,ms:1e9}),b.choose(g.clone(),{sims:90,ms:1e9}));
 const teacher=new Search({seed:44,recordPolicy:true});
 const r=teacher.choose(g,{sims:100,ms:1e9});
 assert.ok(g.legal().includes(r.move));
 assert.ok(r.visits.reduce((a,b)=>a+b,0)>=90);
});
test('neural-guided search plays a legal complete game across rule variants',()=>{
 const model=new NeuralDraftNet(makeNeuralWeights(43));
 for(let seed=3;seed<=6;seed++){
   const g=initial(seed);
   const agents=[new Search({seed:seed*33+1,draftPolicy:model.asDraftPolicy()}),
     new Search({seed:seed*33+2})];
   for(let step=0;g.phase!==DONE&&step<60;step++){
     const r=agents[g.player].choose(g,{sims:45,ms:1e9});
     assert.ok(g.legal().includes(r.move));
     g.apply(r.move);
     if(g.nextLine)for(const d of g.nextLine)g.seen[d]=1;
   }
   assert.equal(g.phase,DONE);
 }
});
