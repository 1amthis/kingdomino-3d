// Generate complete draft AND placement policies from search root visits.
// Each visible observation includes both kingdoms, current/next lines,
// legal moves and terminal outcome. Hidden deck is excluded.
//   node scripts/full-neural/collect.js --first 250000 --games 12 --sims 192
//     --place-sims 96 --out shard.json [--model checkpoint.json --leaf-every 64]
import {readFileSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {Game,DONE,PLACE} from '../../src/core/search/engine.js';
import {Search} from '../../src/core/search/mcts.js';
import {rawFullObservation,moveIndex} from '../../src/core/search/fullObservation.js';
import {FullNeuralNet} from '../../src/core/search/fullNeural.js';
import {mulberry32} from '../../src/core/rng.js';
const arg=(k,v)=>{const i=process.argv.indexOf('--'+k);return i<0?v:process.argv[i+1]};
const num=(k,v)=>+arg(k,v);
const first=num('first',250000),games=num('games',12),sims=num('sims',192),
  placeSims=num('place-sims',96),modelPath=arg('model',null),
  leafEvery=num('leaf-every',0),output=arg('out','shard.json');
const model=modelPath?new FullNeuralNet(JSON.parse(readFileSync(modelPath,'utf8'))):null;
function initial(seed){
  const rnd=mulberry32(seed),tiles=Array.from({length:48},(_,i)=>i);
  for(let i=47;i>0;i--){const j=(rnd()*(i+1))|0;[tiles[i],tiles[j]]=[tiles[j],tiles[i]];}
  const g=new Game(2,5,!!(seed&1),!!(seed&2));
  g.line=Int8Array.from(tiles.slice(0,4).sort((a,b)=>a-b));
  g.own=new Int8Array(4).fill(-1);g.order=new Int8Array([0,1,1,0]);
  g.left=20;for(const d of g.line)g.seen[d]=1;g.determinize(rnd);
  return g;
}
const batch=[],started=performance.now();
for(let seed=first;seed<first+games;seed++){
  const g=initial(seed),rnd=mulberry32(seed^0x334411),
    netForGame=model && seed%4!==0 ? model : null,
    agents=Array.from({length:2},(_,actor)=>new Search({
      seed:seed*23+actor+1,fullNet:netForGame,uncappedLegal:true,
      leafValueEvery:netForGame?leafEvery:0,recordAllPolicy:true,
    }));
  const observations=[],style=seed%4;let steps=0;
  while(g.phase!==DONE && steps++<60){
    const actor=g.player,legal=g.legal(),record=legal.length>1,
      obs=record?rawFullObservation(g):null;
    const search=agents[actor],budget=g.phase===PLACE?placeSims:sims;
    const result=search.choose(g,{sims:budget,ms:1e9});
    if(record) {
      const moves=result.moves,visits=result.visits,indices=moves.map(move=>moveIndex(g,move));
      const sum=visits.reduce((a,b)=>a+b,0);
      if(!(sum>0)||moves.length!==visits.length||new Set(indices).size!==indices.length)
        throw Error('Invalid root visit labels seed '+seed);
      observations.push({player:actor,phase:g.phase,board:Array.from(obs.board),
        aux:Array.from(obs.aux),indices,probs:visits.map(n=>n/sum),value:0});
    }
    let move=result.move;
    // Exploration draws policy data from a distribution of strengths and
    // occasional non-greedy choices, not just one deterministic Expert.
    if(style===2&&rnd()<0.06)move=legal[(rnd()*legal.length)|0];
    if(!legal.includes(move))throw Error('Search chose illegal move seed '+seed);
    g.apply(move);
    if(g.nextLine)for(const d of g.nextLine)g.seen[d]=1;
  }
  if(g.phase!==DONE)throw Error('Incomplete episode seed '+seed);
  const scores=g.scores();
  for(const x of observations)x.value=Math.sign(scores[x.player]-scores[1-x.player]);
  batch.push({seed,rules:{middle:g.middle,harmony:g.harmony},scores,observations});
}
const payload={format:'full-neural-selfplay-v1',first,games,sims,placeSims,
  guided:!!model,leafEvery:!!model?leafEvery:0,
  count:batch.reduce((n,g)=>n+g.observations.length,0),episodes:batch,
  seconds:(performance.now()-started)/1000};
const json=JSON.stringify(payload);
writeFileSync(output,output.endsWith('.gz')?gzipSync(json,{level:6}):json);
console.log(JSON.stringify({first,games,count:payload.count,seconds:payload.seconds,
  draft:batch.flatMap(x=>x.observations).filter(x=>x.phase!==PLACE).length,
  place:batch.flatMap(x=>x.observations).filter(x=>x.phase===PLACE).length}));
