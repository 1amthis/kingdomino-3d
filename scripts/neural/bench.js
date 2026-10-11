// Paired seed-swapped evaluation of a neural-root-prior MCTS versus exact original Expert.
//   node scripts/neural/bench.js --model model.json --first 150000 --deals 40
//     --sims 3000 --ms 1500 --middle 0 --harmony 0 --out results.json
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Game, DONE } from '../../src/core/search/engine.js';
import { Search } from '../../src/core/search/mcts.js';
import { NeuralDraftNet } from '../../src/core/search/neuralPolicy.js';
import { mulberry32 } from '../../src/core/rng.js';
function arg(k,v){const i=process.argv.indexOf('--'+k);return i<0?v:process.argv[i+1];}
const num=(k,v)=>+arg(k,v);
const first=num('first',150000),deals=num('deals',40),
  sims=num('sims',3000),ms=num('ms',1500),middle=!!num('middle',0),harmony=!!num('harmony',0),
  modelFile=arg('model',null),out=arg('out','neural-bench.json'),
  threads=Math.max(1,Math.min(deals,num('threads',Math.min(4,availableParallelism()))));
if(!modelFile)throw Error('Provide a --model path');
const net=new NeuralDraftNet(JSON.parse(readFileSync(modelFile,'utf8')));
function start(seed){
 const r=mulberry32(seed),ds=Array.from({length:48},(_,i)=>i);
 for(let i=47;i>0;i--){const j=(r()*(i+1))|0;[ds[i],ds[j]]=[ds[j],ds[i]];}
 const g=new Game(2,5,middle,harmony);
 g.line=Int8Array.from(ds.slice(0,4).sort((a,b)=>a-b));
 g.own=new Int8Array(4).fill(-1);g.order=new Int8Array([0,1,1,0]);g.left=20;
 for(const d of g.line)g.seen[d]=1;g.determinize(r);
 return g;
}
function play(seed,neuralSeat){
 const g=start(seed),ss=Array.from({length:2},(_,p)=>
   new Search({seed:seed*31+p+1,draftPolicy:p===neuralSeat?net.asDraftPolicy():null}));
 const stats={neural:{sims:0,ms:0,moves:0},original:{sims:0,ms:0,moves:0}};
 for(let k=0;g.phase!==DONE&&k<60;k++){
   const p=g.player,who=p===neuralSeat?'neural':'original',t=performance.now();
   const r=ss[p].choose(g,{sims,ms});
   stats[who].ms+=performance.now()-t;stats[who].sims+=r.sims;stats[who].moves++;
   if(!g.legal().includes(r.move))throw Error('Illegal '+seed+' move '+r.move);
   g.apply(r.move);if(g.nextLine)for(const d of g.nextLine)g.seen[d]=1;
 }
 if(g.phase!==DONE)throw Error('Incomplete match '+seed);
 const scores=g.scores();
 return {margin:scores[neuralSeat]-scores[1-neuralSeat],stats};
}
function paired(seed){
 const first=play(seed,0),second=play(seed,1);
 return {seed,margin:(first.margin+second.margin)/2,rawMargins:[first.margin,second.margin],games:[first,second]};
}
if(!isMainThread)parentPort.on('message',seed=>parentPort.postMessage(paired(seed)));
else {
 const results=[];let next=0;const t0=performance.now();
 await Promise.all(Array.from({length:threads},()=>new Promise((resolve,reject)=>{
   const w=new Worker(fileURLToPath(import.meta.url),{argv:process.argv.slice(2)});
   const feed=()=>next<deals?w.postMessage(first+next++):w.terminate().then(resolve);
   w.on('message',r=>{results.push(r);feed();});
   w.on('error',reject);feed();
 })));
 results.sort((a,b)=>a.seed-b.seed);
 const games=results.flatMap(x=>x.games),m=results.reduce((a,b)=>a+b.margin,0)/results.length;
 const se=Math.sqrt(results.reduce((a,b)=>a+(b.margin-m)**2,0)/(results.length*(results.length-1)));
 const avg=(kind,field)=>games.reduce((a,r)=>a+r.stats[kind][field],0)/
   games.reduce((a,r)=>a+r.stats[kind].moves,0);
 const report={
   model:modelFile,seedRange:[first,first+deals-1],pairedDeals:deals,games:2*deals,
   rules:{middle,harmony},budget:{sims,ms},
   neuralWins:games.filter(r=>r.margin>0).length,
   originalWins:games.filter(r=>r.margin<0).length,
   ties:games.filter(r=>r.margin===0).length,
   meanMargin:m,pairedSE:se,CI95:[m-1.96*se,m+1.96*se],
   simsPerDecision:{neural:avg('neural','sims'),original:avg('original','sims')},
   msPerDecision:{neural:avg('neural','ms'),original:avg('original','ms')},
   pairedMargins:results.map(x=>x.margin),seconds:(performance.now()-t0)/1000,
 };
 writeFileSync(out,JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,pairedMargins:'('+results.length+' values)'},null,2));
}
