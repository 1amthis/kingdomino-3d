// Dataset of genuine MCTS-improved draft policies and terminal self-play outcomes.
// Each example: raw board observation, four-action visit distribution, final
// win/tie/loss result from the acting player's perspective (not teacher margin).
// Usage: node scripts/neural/collect.js --first 100000 --games 24 --sims 256
//         --place-sims 64 --out shard.json [--model stage1-model.json]
import { writeFileSync, readFileSync } from 'node:fs';
import { Game, DONE, PLACE } from '../../src/core/search/engine.js';
import { Search } from '../../src/core/search/mcts.js';
import { encodeDraft } from '../../src/core/search/neuralObservation.js';
import { NeuralDraftNet } from '../../src/core/search/neuralPolicy.js';
import { mulberry32 } from '../../src/core/rng.js';
function arg(name,fallback){const i=process.argv.indexOf('--'+name);return i>=0?process.argv[i+1]:fallback;}
const num=(k,v)=>+arg(k,v);
const first=num('first',100000),games=num('games',24),sims=num('sims',256),
  placeSims=num('place-sims',64),out=arg('out','shard.json'),modelFile=arg('model',null);
const model=modelFile?new NeuralDraftNet(JSON.parse(readFileSync(modelFile,'utf8'))):null;
function start(seed){
  const r=mulberry32(seed),ds=Array.from({length:48},(_,i)=>i);
  for(let i=47;i>0;i--){const j=(r()*(i+1))|0;[ds[i],ds[j]]=[ds[j],ds[i]];}
  const variant=seed%4,g=new Game(2,5,!!(variant&1),!!(variant&2));
  g.line=Int8Array.from(ds.slice(0,4).sort((a,b)=>a-b));
  g.own=new Int8Array(4).fill(-1);
  g.order=new Int8Array([0,1,1,0]);g.left=20;
  for(const d of g.line)g.seen[d]=1;
  g.determinize(r);return g;
}
const gamesOut=[],t0=performance.now();
for(let seed=first;seed<first+games;seed++){
  const g=start(seed),style=seed%4,random=mulberry32(seed^0x125419);
  const agents=[0,1].map(p=>new Search({seed:seed*23+p+1,recordPolicy:true,
    draftPolicy:model&&style!==0?model.asDraftPolicy():null}));
  const records=[];let steps=0;
  while(g.phase!==DONE && steps++<60){
    const actor=g.player,choice=g.phase!==PLACE,free=choice?g.freeSlots():null;
    const observation=choice && free.length>1?Array.from(encodeDraft(g)):null;
    const agent=agents[actor],r=agent.choose(g,{sims:choice?sims:placeSims,ms:1e9});
    if(observation){
      const counts=r.visits||[0,0,0,0],sum=counts.reduce((a,b)=>a+b,0);
      if(!sum)throw Error('Missing MCTS policy targets on seed '+seed);
      records.push({player:actor,x:observation,pi:counts.map(v=>v/sum),value:0});
    }
    let move=r.move;
    // Diverse trajectories with exploration, in addition to stronger MCTS policy.
    if(style===2 && random()<0.08){
      const legal=g.legal();
      move=legal[(random()*legal.length)|0];
    }
    g.apply(move);
    if(g.nextLine)for(const d of g.nextLine)g.seen[d]=1;
  }
  if(g.phase!==DONE)throw Error('Incomplete game '+seed);
  const scores=g.scores();
  for(const record of records)record.value=Math.sign(scores[record.player]-scores[1-record.player]);
  gamesOut.push({seed,rules:{middle:g.middle,harmony:g.harmony},scores,records});
}
const payload={format:'neural-draft-selfplay-v1',first,games,sims,placeSims,
  guided:!!model,examples:gamesOut.reduce((n,g)=>n+g.records.length,0),
  gamesData:gamesOut,elapsedSeconds:(performance.now()-t0)/1000};
writeFileSync(out,JSON.stringify(payload));
console.error(JSON.stringify({first,games,examples:payload.examples,policySims:sims,placeSims,seconds:payload.elapsedSeconds}));
