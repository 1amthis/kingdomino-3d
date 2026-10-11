// Paired seat-swap benchmark for a model covering placement+draft and, when
// configured, leaf values. Opponent is the untouched production Expert.
// Usage: node scripts/full-neural/bench.js --model model.json --mode policy
//        --first 310000 --deals 25 --sims 3000 --ms 1500 --middle 0 --harmony 0
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {readFileSync,writeFileSync} from 'node:fs';
import {availableParallelism} from 'node:os';
import {fileURLToPath} from 'node:url';
import {Game,DONE} from '../../src/core/search/engine.js';
import {Search} from '../../src/core/search/mcts.js';
import {FullNeuralNet} from '../../src/core/search/fullNeural.js';
import {mulberry32} from '../../src/core/rng.js';
const arg=(k,v)=>{const i=process.argv.indexOf('--'+k);return i<0?v:process.argv[i+1]};
const num=(k,v)=>+arg(k,v),first=num('first',310000),deals=num('deals',25),
  sims=num('sims',3000),ms=num('ms',1500),middle=!!num('middle',0),harmony=!!num('harmony',0),
  modelFile=arg('model',null),mode=arg('mode','policy'),baseline=arg('baseline','original'),out=arg('out','full-bench.json'),
  threads=Math.min(Math.max(1,num('threads',Math.min(2,availableParallelism()))),deals),
  leafEvery=mode==='value'?num('leaf-every',128):0;
if(!['policy','value'].includes(mode)||!['original','uncapped'].includes(baseline)||!modelFile)
  throw Error('Supply --model, --mode policy|value and --baseline original|uncapped');
const net=new FullNeuralNet(JSON.parse(readFileSync(modelFile,'utf8')));
function initial(seed){
  const rnd=mulberry32(seed),ds=Array.from({length:48},(_,i)=>i);
  for(let i=47;i>0;i--){const j=(rnd()*(i+1))|0;[ds[i],ds[j]]=[ds[j],ds[i]];}
  const g=new Game(2,5,middle,harmony);
  g.line=Int8Array.from(ds.slice(0,4).sort((a,b)=>a-b));
  g.own=new Int8Array(4).fill(-1);g.order=new Int8Array([0,1,1,0]);
  g.left=20;for(const d of g.line)g.seen[d]=1;g.determinize(rnd);return g;
}
function play(seed,neuralSeat){
  const g=initial(seed),agents=[0,1].map(player=>new Search({
    seed:seed*31+player+1,
    fullNet:player===neuralSeat?net:null,
    uncappedLegal:baseline==='uncapped'&&player!==neuralSeat,
    leafValueEvery:player===neuralSeat?leafEvery:0,
  }));
  const stats={model:{moves:0,sims:0,ms:0},expert:{moves:0,sims:0,ms:0}};
  for(let step=0;g.phase!==DONE && step<60;step++){
    const player=g.player,who=player===neuralSeat?'model':'expert',t0=performance.now();
    const result=agents[player].choose(g,{sims,ms});
    stats[who].ms+=performance.now()-t0;
    stats[who].sims+=result.sims;stats[who].moves++;
    if(!g.legal().includes(result.move))throw Error('Illegal move seed '+seed+' move '+result.move);
    g.apply(result.move);if(g.nextLine)for(const d of g.nextLine)g.seen[d]=1;
  }
  if(g.phase!==DONE)throw Error('Incomplete seed '+seed);
  const s=g.scores();
  return {margin:s[neuralSeat]-s[1-neuralSeat],stats};
}
function pair(seed){
  const a=play(seed,0),b=play(seed,1);
  return {seed,mean:(a.margin+b.margin)/2,margins:[a.margin,b.margin],games:[a,b]};
}
if(!isMainThread)parentPort.on('message',seed=>parentPort.postMessage(pair(seed)));
else {
  const results=[];let next=0;
  await Promise.all(Array.from({length:threads},()=>new Promise((resolve,reject)=>{
    const worker=new Worker(fileURLToPath(import.meta.url),{argv:process.argv.slice(2)});
    const feed=()=>next<deals?worker.postMessage(first+next++):worker.terminate().then(resolve);
    worker.on('message',r=>{results.push(r);feed();});worker.on('error',reject);feed();
  })));
  results.sort((a,b)=>a.seed-b.seed);
  const games=results.flatMap(x=>x.games),mean=results.reduce((a,b)=>a+b.mean,0)/deals;
  const se=deals>1?Math.sqrt(results.reduce((a,b)=>a+(b.mean-mean)**2,0)/(deals*(deals-1))):null;
  const av=(who,key)=>games.reduce((a,g)=>a+g.stats[who][key],0)/
    games.reduce((a,g)=>a+g.stats[who].moves,0);
  const report={checkpoint:modelFile,mode,baseline,leafEvery,seedRange:[first,first+deals-1],
    pairedDeals:deals,games:2*deals,rules:{middle,harmony},budget:{sims,ms},
    modelWins:games.filter(g=>g.margin>0).length,expertWins:games.filter(g=>g.margin<0).length,
    ties:games.filter(g=>g.margin===0).length,meanMargin:mean,pairedSE:se,
    ci95:se===null?null:[mean-1.96*se,mean+1.96*se],
    simPerDecision:{model:av('model','sims'),expert:av('expert','sims')},
    msPerDecision:{model:av('model','ms'),expert:av('expert','ms')},
    pairedMargins:results.map(r=>r.mean)};
  writeFileSync(out,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,pairedMargins:'stored ('+deals+' values)'},null,2));
}
