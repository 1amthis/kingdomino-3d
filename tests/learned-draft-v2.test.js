// Regression parity for draft V2, plus search legality with different bonus rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, INIT, PICK, DONE, DOM } from '../src/core/search/engine.js';
import { Search } from '../src/core/search/mcts.js';
import { draftFeatureVector } from '../src/core/search/draftFeatures.js';
import { learnedDraftEval } from '../src/core/search/learnedDraft.js';
import { V2_DRAFT_WEIGHTS, learnedDraftV2 } from '../src/core/search/learnedDraftV2.js';
import { mulberry32 } from '../src/core/rng.js';
function start(seed) {
  const rnd=mulberry32(seed), tiles=Array.from({length:48},(_,i)=>i);
  for(let i=47;i>0;i--){const j=(rnd()*(i+1))|0;[tiles[i],tiles[j]]=[tiles[j],tiles[i]];}
  const g=new Game(2,5,(seed%4&1)!==0,(seed%4&2)!==0);
  g.line=Int8Array.from(tiles.slice(0,4).sort((a,b)=>a-b));
  g.own=new Int8Array(4).fill(-1);g.order=new Int8Array([0,1,1,0]);
  g.left=20;for(const d of g.line)g.seen[d]=1;g.determinize(rnd);
  return g;
}
test('V2 scorer matches separately assembled regression features at all stages',()=>{
  const stageSeen=new Set();let checks=0;
  for(let seed=100;seed<136;seed++){
    const g=start(seed),a=[new Search({seed:seed*3+1}),new Search({seed:seed*3+2})];
    for(let step=0;g.phase!==DONE&&step<60;step++){
      if(g.phase===INIT||g.phase===PICK){
        const b=g.boards[g.player],stage=b.placed;
        const key=g.phase===INIT?0:stage<4?1:stage<8?2:3;
        stageSeen.add(key);
        for(const slot of g.freeSlots()){
          const x=draftFeatureVector(g,slot),w=V2_DRAFT_WEIGHTS;
          const d=(g.phase===INIT?g.line:g.nextLine)[slot],i=4*d,
            ta=DOM[i],ca=DOM[i+1],tb=DOM[i+2],cb=DOM[i+3];
          const ownCrownSynergy=ca*b.crowns[ta]+cb*b.crowns[tb];
          const unownedTerrains=+(b.terr[ta]===0)+(ta===tb?0:+(b.terr[tb]===0));
          const expected=key===0?x[0]:key===2?learnedDraftEval(g,slot):
            w.baseline*x[0]+w.slot*x[1]+w.crowns*x[2]+w.ownCrowns*x[6]+
            w.ownTerrain*x[7]+w.crownOnOwnTerrain*x[8]+w.lateSlot*x[10]+
            w.ownCrownSynergy*ownCrownSynergy+w.unownedTerrains*unownedTerrains;
          assert.ok(Math.abs(learnedDraftV2(g,slot)-expected)<1e-8);
          checks++;
        }
      }
      const actor=g.player,move=a[actor].choose(g,{sims:16,ms:1e6}).move;
      assert.ok(g.legal().includes(move));g.apply(move);
      if(g.nextLine)for(const d of g.nextLine)g.seen[d]=1;
    }
    assert.equal(g.phase,DONE);
  }
  assert.deepEqual([...stageSeen].sort(),[0,1,2,3]);
  assert.ok(checks>=150);
});
test('V2 can play complete legal games against V1 with all four bonus combinations',()=>{
  for(let seed=200;seed<204;seed++){
    const g=start(seed);
    const searches=[new Search({seed:seed*31,draftTreeEval:learnedDraftV2}),
      new Search({seed:seed*31+1,draftTreeEval:learnedDraftEval})];
    for(let step=0;g.phase!==DONE&&step<60;step++){
      const move=searches[g.player].choose(g,{sims:64,ms:1e6}).move;
      assert.ok(g.legal().includes(move));g.apply(move);
      if(g.nextLine)for(const d of g.nextLine)g.seen[d]=1;
    }
    assert.equal(g.phase,DONE);
  }
});
