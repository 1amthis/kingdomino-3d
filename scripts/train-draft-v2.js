// Stronger teacher experiment: diverse 2-player games and 128+ MCTS samples per draft option.
// --collect --first 60000 --games 40 --teacher-sims 128 --trajectory-sims 48 --split train --out shard.json
// --fit --dir shards --out draft-v2-fit.json
// Shards: disjoint whole games. Validation is split by seed, never by individual moves.
// Deliberately retain raw teacher actions: all model selection happens after labels are fixed.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game, INIT, PICK, DONE, DOM } from '../src/core/search/engine.js';
import { Search } from '../src/core/search/mcts.js';
import { draftFeatureVector, DRAFT_FEATURES } from '../src/core/search/draftFeatures.js';
import { learnedDraftEval } from '../src/core/search/learnedDraft.js';
import { mulberry32 } from '../src/core/rng.js';

function arg(key, def) {
  const i = process.argv.indexOf('--'+key);
  return i < 0 ? def : process.argv[i+1];
}
const num = (key,def) => +arg(key,def);
const NAMES = [...DRAFT_FEATURES, 'ownCrownSynergy', 'unownedTerrains', 'sameTerrainTiles', 'stageCrown', 'stageOwnTerrain', 'terrainCrownPresence'];

function initial(seed) {
  const rnd = mulberry32(seed), tiles = Array.from({length:48},(_,i)=>i);
  for(let i=47;i>0;i--){const j=(rnd()*(i+1))|0;[tiles[i],tiles[j]]=[tiles[j],tiles[i]];}
  const mode=seed%4, g=new Game(2,5,(mode&1)!==0,(mode&2)!==0);
  g.line=Int8Array.from(tiles.slice(0,4).sort((a,b)=>a-b));
  g.own=new Int8Array(4).fill(-1);g.order=new Int8Array([0,1,1,0]);
  g.left=20;for(const d of g.line)g.seen[d]=1;g.determinize(rnd);
  return g;
}
function features(st,slot) {
  const v=draftFeatureVector(st,slot);
  const b=st.boards[st.player],line=st.phase===INIT?st.line:st.nextLine;
  const a=4*line[slot], ta=DOM[a],ca=DOM[a+1],tb=DOM[a+2],cb=DOM[a+3];
  const own=b.terr[ta]+b.terr[tb],stage=b.placed/12;
  const unowned=+(b.terr[ta]===0)+(ta===tb?0:+(b.terr[tb]===0));
  v.push(ca*b.crowns[ta]+cb*b.crowns[tb],unowned,+(ta===tb)*b.terr[ta],
    stage*(ca+cb),stage*own,+((ca&&b.crowns[ta])||(cb&&b.crowns[tb])?1:0));
  return v;
}
function positions(seed, sims) {
  const st=initial(seed), style=seed%3,rnd=mulberry32(seed^0x1f994f);
  const a=[
    new Search({seed:seed*17+1,draftTreeEval:style===2?learnedDraftEval:null}),
    new Search({seed:seed*17+2,draftTreeEval:style===2?learnedDraftEval:null}),
  ];
  const buckets=[[],[],[],[]];
  for(let step=0;st.phase!==DONE && step<60;step++){
    if(st.phase===INIT||st.phase===PICK){
      const acts=st.freeSlots();
      if(acts.length>=2){
        const stage=st.boards[st.player].placed;
        const bucket=st.phase===INIT?0:stage<4?1:stage<8?2:3;
        buckets[bucket].push(st.clone());
      }
    }
    const actor=st.player;
    // One third of the trajectories involve exploratory deviations from Expert play.
    const noisy=style===1 && rnd()<0.18, legal=noisy?st.legal():null;
    const move=noisy?legal[(rnd()*legal.length)|0]:a[actor].choose(st,{sims,ms:1e9}).move;
    st.apply(move);
    if(st.nextLine)for(const d of st.nextLine)st.seen[d]=1;
  }
  if(st.phase!==DONE)throw Error('Incomplete trajectory seed '+seed);
  const r=mulberry32(seed^0x71c13f);
  return buckets.map(b=>b[(r()*b.length)|0]).filter(Boolean);
}
function collect() {
  const first=num('first',60000),games=num('games',40),
    teacherSims=num('teacher-sims',128),trajectorySims=num('trajectory-sims',48),
    split=arg('split','train'),out=arg('out','draft-v2-shard.json');
  if(!['train','valid'].includes(split)||games<1||teacherSims<32)throw Error('Bad collection args');
  const t0=performance.now(),data=[];
  for(let seed=first;seed<first+games;seed++){
    const ps=positions(seed,trajectorySims);
    for(let i=0;i<ps.length;i++){
      const st=ps[i],b=st.boards[st.player],stage=st.phase===INIT?0:b.placed<4?1:b.placed<8?2:3;
      const search=new Search({seed:seed*19+i+47});
      const analyzed=search.analyse(st,{sims:0,min:teacherSims,ms:1e9});
      const rows=analyzed.moves.map(m=>({move:m.move,x:features(st,m.move),y:m.ev}));
      if(rows.length<2||rows.some(row=>row.x.length!==NAMES.length||!Number.isFinite(row.y)))throw Error('Invalid labels '+seed);
      data.push({seed,style:seed%3,rules:{middle:st.middle,harmony:st.harmony},stage,rows});
    }
  }
  const payload={kind:'draft-v2-labels',version:1,split,first,games,teacherSims,trajectorySims,
    features:NAMES,positions:data.length,rows:data,elapsedSeconds:(performance.now()-t0)/1000};
  writeFileSync(out,JSON.stringify(payload)+'\n');
  console.error(JSON.stringify({split,first,games,positions:data.length,actions:data.reduce((s,p)=>s+p.rows.length,0),seconds:payload.elapsedSeconds}));
}
function solve(a,b) {
  const n=b.length;
  for(let i=0;i<n;i++) {
    let k=i;
    for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;
    [a[k],a[i]]=[a[i],a[k]];[b[k],b[i]]=[b[i],b[k]];
    if(Math.abs(a[i][i])<1e-10){b[i]=0;continue;}
    const d=a[i][i];for(let j=i;j<n;j++)a[i][j]/=d;b[i]/=d;
    for(let j=0;j<n;j++)if(j!==i) {
      const v=a[j][i];for(let k=i;k<n;k++)a[j][k]-=v*a[i][k];b[j]-=v*b[i];
    }
  }
  return b;
}
function fit(positions,cols,lambda){
  const n=cols.length,a=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0),sq=Array(n).fill(0);
  for(const p of positions) {
    const mx=cols.map(j=>p.rows.reduce((v,r)=>v+r.x[j],0)/p.rows.length),
      my=p.rows.reduce((v,r)=>v+r.y,0)/p.rows.length;
    for(const row of p.rows){
      const x=cols.map((j,i)=>row.x[j]-mx[i]),y=row.y-my;
      for(let i=0;i<n;i++){
        b[i]+=x[i]*y;sq[i]+=x[i]*x[i];
        for(let j=0;j<n;j++)a[i][j]+=x[i]*x[j];
      }
    }
  }
  for(let i=0;i<n;i++)a[i][i]+=lambda*sq[i]+1e-7;
  return solve(a,b);
}
function regret(data,cols,weights){
  const records=[0,1,2,3].map(stage=>({stage,positions:0,baseline:0,old:0,model:0,baselineTop:0,oldTop:0,modelTop:0}));
  for(const p of data){
    const line=p.rows, best=Math.max(...line.map(r=>r.y));
    const base=line.reduce((a,r)=>r.x[0]>a.x[0]?r:a), old=line.reduce((a,r)=>{
      const sc=x=>p.stage!==2?x.x[0]:0.6865604702048589*x.x[0]-0.2667728592923154*x.x[1]-
      0.10105954831835284*x.x[6]+0.024102160460703057*x.x[7]+0.506893418062891*x.x[8]-0.2279330157939041*x.x[10];
      return sc(r)>sc(a)?r:a;
    });
    const score=r=>weights.reduce((v,w,i)=>v+w*r.x[cols[i]],0),
      model=line.reduce((a,r)=>score(r)>score(a)?r:a), o=records[p.stage];
    o.positions++;o.baseline+=best-base.y;o.old+=best-old.y;o.model+=best-model.y;
    o.baselineTop+=+(best===base.y);o.oldTop+=+(best===old.y);o.modelTop+=+(best===model.y);
  }
  const all={stage:'all',positions:0,baseline:0,old:0,model:0,baselineTop:0,oldTop:0,modelTop:0};
  for(const r of records)for(const key of Object.keys(all))if(key!=='stage')all[key]+=r[key];
  return [all,...records].map(r=>({stage:r.stage,positions:r.positions,
    regret:{baseline:r.baseline/r.positions,old:r.old/r.positions,new:r.model/r.positions},
    bestChoiceRate:{baseline:r.baselineTop/r.positions,old:r.oldTop/r.positions,new:r.modelTop/r.positions}}));
}
function listFiles(dir){let out=[];for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...listFiles(p));else if(e.name.endsWith('.json'))out.push(p);}return out;}
function fitShards() {
  const dir=arg('dir','shards'),out=arg('out','draft-v2-fit.json');
  const shards=listFiles(dir).map(f=>JSON.parse(readFileSync(f,'utf8'))).filter(x=>x.kind==='draft-v2-labels');
  if(!shards.length)throw Error('No training shards');
  const seen=new Set(),data={train:[],valid:[]},games={train:0,valid:0},splits={train:[],valid:[]};
  const teacher=shards[0].teacherSims;
  for(const sh of shards){
    if(sh.version!==1||sh.teacherSims!==teacher||JSON.stringify(sh.features)!==JSON.stringify(NAMES))throw Error('Mismatch shard '+sh.first);
    for(let seed=sh.first;seed<sh.first+sh.games;seed++){
      if(seen.has(seed))throw Error('Seed duplicate '+seed);seen.add(seed);
    }
    data[sh.split].push(...sh.rows);games[sh.split]+=sh.games;splits[sh.split].push([sh.first,sh.first+sh.games-1]);
  }
  if(!data.train.length||!data.valid.length)throw Error('Missing train or validation split');
  const idx=names=>names.map(x=>{const j=NAMES.indexOf(x);if(j<0)throw Error('Unknown feature '+x);return j;});
  const setups={
    base:['baseline'],
    oldMinimal:['baseline','slot','ownCrowns','ownTerrain','crownOnOwnTerrain','lateSlot'],
    v2Small:['baseline','slot','crowns','ownCrowns','ownTerrain','crownOnOwnTerrain','lateSlot','ownCrownSynergy','unownedTerrains'],
    v2Wide:['baseline','slot','crowns','number','same','ownCrowns','ownTerrain','crownOnOwnTerrain','lateSlot','lateOwnCrowns','ownCrownSynergy','unownedTerrains','stageCrown','stageOwnTerrain'],
    v2Full:NAMES,
  };
  const models={};
  for(const [name,names] of Object.entries(setups)) {
    const cols=idx(names), weights=fit(data.train,cols,0.12);
    models[name]={columns:names,weights,validation:regret(data.valid,cols,weights)};
  }
  // Pure model selection on validation: record all models but leave the match holdout untouched.
  const winning=Object.keys(models).filter(n=>n!=='base').sort((a,b)=>models[a].validation[0].regret.new-models[b].validation[0].regret.new)[0];
  const result={version:1,teacherSims:teacher,features:NAMES,shards:shards.length,
    games,positions:{train:data.train.length,valid:data.valid.length},
    actions:{train:data.train.reduce((n,x)=>n+x.rows.length,0),valid:data.valid.reduce((n,x)=>n+x.rows.length,0)},
    splits,models,validationWinningModel:winning};
  writeFileSync(out,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({winning,gameCounts:games,positionCounts:result.positions,
    winner:models[winning]},null,2));
}
if(process.argv.includes('--collect'))collect();
else if(process.argv.includes('--fit'))fitShards();
else throw Error('Pass --collect or --fit');
