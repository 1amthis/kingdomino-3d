// Verify all 16 neural arena shards; aggregate by independent pair rather than game.
// Usage: node scripts/neural/aggregate.js arena out.json out.md
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root=process.argv[2]||'arena',out=process.argv[3]||'arena.json',mdOut=process.argv[4]||'arena.md';
const reports={};
function files(dir){let result=[];for(const e of readdirSync(dir,{withFileTypes:true})){
  const p=join(dir,e.name);if(e.isDirectory())result.push(...files(p));else if(e.name==='result.json')result.push(p);
}return result;}
const names=['plain','middle','harmony','both'];
for(const file of files(root)){
  const x=JSON.parse(readFileSync(file,'utf8'));
  if(x.pairedDeals!==50||x.games!==100||x.budget.sims!==3000||x.budget.ms!==1500)
    throw Error('Invalid arena shard '+file);
  const kind=names.find(n=>n==='plain'?!x.rules.middle&&!x.rules.harmony:
    n==='middle'?x.rules.middle&&!x.rules.harmony:
    n==='harmony'?!x.rules.middle&&x.rules.harmony:x.rules.middle&&x.rules.harmony);
  const version=x.model.includes('model0.json')?0:x.model.includes('model1.json')?1:-1;
  if(version<0)throw Error('Unknown checkpoint '+file);
  const key=version+'-'+kind;
  (reports[key]??=[]).push(x);
}
const table=[],summary={};
for(let version=0;version<=1;version++){
  const all=[];
  for(const kind of names){
    const key=version+'-'+kind,chunks=reports[key]||[];
    if(chunks.length!==2)throw Error('Missing/extra shard '+key+': '+chunks.length);
    const seen=new Set(),margins=[];
    for(const r of chunks)for(let k=0;k<r.pairedMargins.length;k++){
      const seed=r.seedRange[0]+k;
      if(seen.has(seed))throw Error('Repeated arena seed '+seed);
      seen.add(seed);margins.push(r.pairedMargins[k]);
    }
    if(margins.length!==100)throw Error('Wrong paired deal count '+key);
    const w=chunks.reduce((v,r)=>v+r.neuralWins,0),l=chunks.reduce((v,r)=>v+r.originalWins,0),
      ties=chunks.reduce((v,r)=>v+r.ties,0);
    if(w+l+ties!==200)throw Error('Wins do not add up '+key);
    const mean=margins.reduce((a,b)=>a+b,0)/margins.length;
    const se=Math.sqrt(margins.reduce((a,b)=>a+(b-mean)**2,0)/(margins.length*(margins.length-1)));
    const row={version,kind,pairedDeals:100,games:200,neuralWins:w,originalWins:l,ties,
      meanMargin:mean,pairedSE:se,CI95:[mean-1.96*se,mean+1.96*se],
      neuralSimsPerMove:chunks.reduce((v,r)=>v+r.simsPerDecision.neural,0)/2,
      originalSimsPerMove:chunks.reduce((v,r)=>v+r.simsPerDecision.original,0)/2};
    table.push(row);all.push(...margins);
  }
  const mean=all.reduce((a,b)=>a+b,0)/all.length;
  const se=Math.sqrt(all.reduce((a,b)=>a+(b-mean)**2,0)/(all.length*(all.length-1)));
  summary[version]={pairs:all.length,meanMargin:mean,CI95:[mean-1.96*se,mean+1.96*se],
    wins:table.filter(r=>r.version===version).reduce((s,r)=>s+r.neuralWins,0),
    losses:table.filter(r=>r.version===version).reduce((s,r)=>s+r.originalWins,0),
    ties:table.filter(r=>r.version===version).reduce((s,r)=>s+r.ties,0)};
}
const obj={table,summary,conditions:'2 players 5x5 3000 simulations, 1500ms wall cap, seat-swapped 100 independent deals for each model/rule config'};
writeFileSync(out,JSON.stringify(obj,null,2));
const fmt=x=>x.toFixed(2),lines=['# Neural policy/value self-play MCTS arena',
  '','Each row: 100 paired deals / 200 completed games, novel test seeds. Baseline is unchanged Expert. Each neural policy is evaluated exactly once per visible draft root, then used for PUCT ordering and exploration.',
  '','| Network | Rules | Neural W / Expert W (draws) | Mean lead | Approx. 95% paired CI | Neural / expert sims per decision |',
  '| --- | --- | --- | ---: | ---: | ---: |'];
for(const r of table)lines.push('| Iter '+r.version+' | '+r.kind+' | '+r.neuralWins+' / '+r.originalWins+' ('+r.ties+') | '+fmt(r.meanMargin)+' | ['+r.CI95.map(fmt).join(', ')+'] | '+fmt(r.neuralSimsPerMove)+' / '+fmt(r.originalSimsPerMove)+' |');
for(let version=0;version<=1;version++){const r=summary[version];lines.push('','Iteration '+version+' pooled: '+r.wins+' / '+r.losses+' ('+r.ties+'), mean lead **'+fmt(r.meanMargin)+'**, 95% CI ['+r.CI95.map(fmt).join(', ')+'] across '+r.pairs+' seed-swapped deals.');}
lines.push('','Because the two network versions reuse the same test seeds and the network is selected after viewing validation, treat the arena as exploratory model selection. Before shipping, run a new independent holdout on the selected checkpoint. A network whose inference costs more MCTS simulations may be worse at equal wall time.');
writeFileSync(mdOut,lines.join('\n')+'\n');
console.log(lines.join('\n'));
