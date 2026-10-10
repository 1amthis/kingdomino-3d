import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, INIT, PICK, DONE } from '../src/core/search/engine.js';
import { Search } from '../src/core/search/mcts.js';
import { draftFeatureVector } from '../src/core/search/draftFeatures.js';
import { DRAFT_WEIGHTS, learnedDraftEval } from '../src/core/search/learnedDraft.js';
import { mulberry32 } from '../src/core/rng.js';

function initial(seed) {
  const rnd = mulberry32(seed), tiles = Array.from({length:48},(_,i)=>i);
  for(let i=47;i>0;i--){const j=(rnd()*(i+1))|0;[tiles[i],tiles[j]]=[tiles[j],tiles[i]];}
  const g=new Game(2,5,false,false);
  g.line=Int8Array.from(tiles.slice(0,4).sort((a,b)=>a-b));
  g.own=new Int8Array(4).fill(-1);
  g.order=new Int8Array([0,1,1,0]);g.left=20;
  for(const d of g.line)g.seen[d]=1;
  g.determinize(rnd);
  return g;
}
test('default search is unchanged when the draft evaluator is absent',()=>{
  const st=initial(123);
  const x=new Search({seed:47}).choose(st.clone(),{sims:80,ms:10000});
  const y=new Search({seed:47,draftTreeEval:null,draftRolloutEval:null}).choose(st.clone(),{sims:80,ms:10000});
  assert.deepEqual(x,y);
});
test('fused learned draft evaluator equals independently computed feature regression and preserves fallbacks',()=>{
  let checks=0,mid=0;
  for(let seed=1;seed<=12;seed++){
    const st=initial(seed),ss=[new Search({seed:seed*11+1}),new Search({seed:seed*11+2})];
    for(let k=0;st.phase!==DONE&&k<60;k++){
      if(st.phase===INIT||st.phase===PICK){
        const b=st.boards[st.player];
        for(const slot of st.freeSlots()){
          const v=draftFeatureVector(st,slot);
          const expected=b.placed<4||b.placed>=8?v[0]:
            DRAFT_WEIGHTS.baseline*v[0]+DRAFT_WEIGHTS.slot*v[1]+
            DRAFT_WEIGHTS.ownCrowns*v[6]+DRAFT_WEIGHTS.ownTerrain*v[7]+
            DRAFT_WEIGHTS.crownOnOwnTerrain*v[8]+DRAFT_WEIGHTS.lateSlot*v[10];
          assert.ok(Math.abs(expected-learnedDraftEval(st,slot))<1e-8);
          checks++;if(b.placed>=4&&b.placed<8)mid++;
        }
      }
      const actor=st.player;
      const move=ss[actor].choose(st,{sims:16,ms:10000}).move;
      assert.ok(st.legal().includes(move));
      st.apply(move);
      if(st.nextLine)for(const d of st.nextLine)st.seen[d]=1;
    }
    assert.equal(st.phase,DONE);
  }
  assert.ok(checks>100);assert.ok(mid>20);
});
test('both draft injection paths produce legal complete games',()=>{
  for(const mode of ['tree','rollout','both']){
    const g=initial(mode==='tree'?210:mode==='rollout'?211:212);
    const policy=new Search({
      seed:17,draftTreeEval:mode!=='rollout'?learnedDraftEval:null,
      draftRolloutEval:mode!=='tree'?learnedDraftEval:null,
    });
    for(let step=0;g.phase!==DONE&&step<60;step++){
      const move=policy.choose(g,{sims:48,ms:10000}).move;
      assert.ok(g.legal().includes(move));
      g.apply(move);
      if(g.nextLine)for(const d of g.nextLine)g.seen[d]=1;
    }
    assert.equal(g.phase,DONE);
  }
});
