// Validate independent paired-deal shards, compare full policy priors
// against policy+learned leaf values at the same wall-time.
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const dir=process.argv[2]||'arena',outfile=process.argv[3]||'full-arena.json';
function walk(d){let xs=[];for(const e of readdirSync(d,{withFileTypes:true})){
  const p=join(d,e.name);if(e.isDirectory())xs.push(...walk(p));
  else if(e.name==='result.json')xs.push(p);
}return xs;}
const files=walk(dir),names=['plain','middle','harmony','both'],rows=[],totals={};
for(const mode of ['policy','value']){
 const all=[],seeds=new Set(),results=[];
 for(const rules of names){
   const instances=files.map(file=>JSON.parse(readFileSync(file,'utf8')))
     .filter(x=>x.mode===mode&&((rules==='plain'&&!x.rules.middle&&!x.rules.harmony)||
       (rules==='middle'&&x.rules.middle&&!x.rules.harmony)||
       (rules==='harmony'&&!x.rules.middle&&x.rules.harmony)||
       (rules==='both'&&x.rules.middle&&x.rules.harmony)));
   if(instances.length!==2)throw Error('Expected 2 shards '+mode+'/'+rules);
   const pairs=instances.flatMap(x=>x.pairedMargins),seen=new Set();
   for(const x of instances){
     if(x.pairedDeals!==25||x.games!==50||x.budget.sims!==3000||x.budget.ms!==1500)
       throw Error('Unexpected budget or shard size');
     for(let i=x.seedRange[0];i<=x.seedRange[1];i++){
       if(seen.has(i)||seeds.has(i))throw Error('Repeated seed '+i+' in '+mode);
       seen.add(i);seeds.add(i);
     }
   }
   const mean=pairs.reduce((a,b)=>a+b,0)/pairs.length,
   se=Math.sqrt(pairs.reduce((a,b)=>a+(b-mean)**2,0)/(pairs.length*(pairs.length-1)));
   const row={mode,rules,pairs:pairs.length,
     modelWins:instances.reduce((a,b)=>a+b.modelWins,0),
     expertWins:instances.reduce((a,b)=>a+b.expertWins,0),
     ties:instances.reduce((a,b)=>a+b.ties,0),
     meanMargin:mean,ci95:[mean-1.96*se,mean+1.96*se],
     modelSimsPerDecision:instances.reduce((a,b)=>a+b.simPerDecision.model,0)/2,
     expertSimsPerDecision:instances.reduce((a,b)=>a+b.simPerDecision.expert,0)/2,
   };
   if(row.modelWins+row.expertWins+row.ties!==100)throw Error('Bad outcome total');
   rows.push(row);all.push(...pairs);results.push(row);
 }
 const mean=all.reduce((a,b)=>a+b,0)/all.length;
 const se=Math.sqrt(all.reduce((a,b)=>a+(b-mean)**2,0)/(all.length*(all.length-1)));
 totals[mode]={pairs:all.length,meanMargin:mean,ci95:[mean-1.96*se,mean+1.96*se],
   modelWins:results.reduce((a,b)=>a+b.modelWins,0),
   expertWins:results.reduce((a,b)=>a+b.expertWins,0),
   ties:results.reduce((a,b)=>a+b.ties,0)};
}
const obj={rows,totals,seedOverlapAcrossPolicies:true,note:'Same seed groups reused across modes; do not pool them as independent games'};
writeFileSync(outfile,JSON.stringify(obj,null,2));
const fmt=n=>n.toFixed(2),out=[
'# Full spatial residual neural MCTS — independent arena',
'','50 paired deals / 100 games per rule and mode. A deal is replayed with reversed seats. Actual production time cap is 1500 ms, maximum 3000 simulations.',
'','| Mode | Rules | Model / Expert wins (draws) | Mean point lead | 95% CI (paired deals) | Model / Expert sims per move |',
'| --- | --- | --- | ---: | ---: | ---: |'];
for(const r of rows)out.push('| '+r.mode+' | '+r.rules+' | '+r.modelWins+' / '+r.expertWins+' ('+r.ties+') | '+fmt(r.meanMargin)+' | ['+r.ci95.map(fmt).join(', ')+'] | '+fmt(r.modelSimsPerDecision)+' / '+fmt(r.expertSimsPerDecision)+' |');
for(const mode of ['policy','value']){const x=totals[mode];out.push('','**'+mode+' overall**: '+x.modelWins+' / '+x.expertWins+' ('+x.ties+'), '+fmt(x.meanMargin)+' points, 95% CI ['+x.ci95.map(fmt).join(', ')+'] over '+x.pairs+' independent paired deals.');}
out.push('','The model includes uncapped root placements whereas the default production Expert keeps a 48-move root cap. This comparison is intentionally against the untouched Expert, but to isolate the neural contribution separately compare both with equal action caps. Neural policy and leaf cutoffs share model weights and seed ranges, so avoid double-counting across modes. No merge without independent confirmation.');
const markdown=out.join('\n')+'\n';
writeFileSync(outfile.replace(/\.json$/,'.md'),markdown);
console.log(markdown);
