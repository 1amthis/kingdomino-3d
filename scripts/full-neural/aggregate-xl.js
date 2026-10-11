// Aggregate frozen-checkpoint large arena across four rule configurations and
// three predeclared comparisons; per-deal pairing, not per-game pseudo-N.
// Enforces completeness, disjoint seeds per rule and no test-data reuse.
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const dir=process.argv[2]||'arena',filename=process.argv[3]||'xl-arena.json';
const names=['plain','middle','harmony','both'];
const comparisons=[['policy','original'],['policy','uncapped'],['value','original']];
function walk(d){let out=[];for(const e of readdirSync(d,{withFileTypes:true})){
  const p=join(d,e.name);if(e.isDirectory())out.push(...walk(p));
  else if(e.name==='result.json')out.push(p);
}return out;}
const all=walk(dir).map(x=>JSON.parse(readFileSync(x,'utf8')));
const stats=m=>{
  const n=m.length,mean=m.reduce((a,b)=>a+b,0)/n,
    se=Math.sqrt(m.reduce((a,x)=>a+(x-mean)**2,0)/(n*(n-1)));
  return {pairedDeals:n,meanMargin:mean,pairedSE:se,CI95:[mean-1.96*se,mean+1.96*se]};
};
const rows=[],totals={};
for(const [mode,baseline] of comparisons){
  const combined=[],counts={modelWins:0,expertWins:0,ties:0};
  for(const rules of names){
    const items=all.filter(x=>x.mode===mode&&x.baseline===baseline&&
      (rules==='plain'?!x.rules.middle&&!x.rules.harmony:
       rules==='middle'?x.rules.middle&&!x.rules.harmony:
       rules==='harmony'?!x.rules.middle&&x.rules.harmony:x.rules.middle&&x.rules.harmony));
    if(items.length!==8)throw Error('Expected eight shards '+mode+'/'+baseline+'/'+rules+' got '+items.length);
    const seen=new Set(),margins=[];
    for(const x of items){
      if(x.pairedDeals!==25||x.games!==50||x.budget.sims!==3000||x.budget.ms!==1500)
        throw Error('Mismatched benchmark budget or sample count');
      if(x.pairedMargins.length!==25)throw Error('Missing per-seed margins');
      for(let i=0;i<x.pairedMargins.length;i++){
        const seed=x.seedRange[0]+i;
        if(seen.has(seed))throw Error('Repeated seed in '+mode+'/'+baseline+'/'+rules);
        if(seed<450000||seed>456199)throw Error('Unexpected test seed '+seed);
        seen.add(seed);margins.push(x.pairedMargins[i]);
      }
    }
    if(seen.size!==200)throw Error('Incomplete paired-deal group');
    const result={mode,baseline,rules,...stats(margins),
      modelWins:items.reduce((a,b)=>a+b.modelWins,0),
      expertWins:items.reduce((a,b)=>a+b.expertWins,0),
      ties:items.reduce((a,b)=>a+b.ties,0),
      modelSimsPerDecision:items.reduce((a,b)=>a+b.simPerDecision.model,0)/items.length,
      expertSimsPerDecision:items.reduce((a,b)=>a+b.simPerDecision.expert,0)/items.length,
      modelMsPerDecision:items.reduce((a,b)=>a+b.msPerDecision.model,0)/items.length,
      expertMsPerDecision:items.reduce((a,b)=>a+b.msPerDecision.expert,0)/items.length,
    };
    if(result.modelWins+result.expertWins+result.ties!==400)throw Error('Broken win totals');
    rows.push(result);combined.push(...margins);
    for(const key of Object.keys(counts))counts[key]+=result[key];
  }
  const id=mode+'/'+baseline;
  totals[id]={mode,baseline,...stats(combined),...counts};
  if(totals[id].pairedDeals!==800||Object.values(counts).reduce((a,b)=>a+b,0)!==1600)
    throw Error('Incomplete experiment '+id);
}
const report={checkpoint:'large spatial residual full-action frozen before arena',
  structure:{trainSeeds:'370000–374095',validationSeeds:'970000–970511',
    arenaSeeds:'450000–456199; same seeds per comparison but independent of training'},
  rows,totals,distinctPairedDealsPerComparison:800,completedGames:4800,
  caveat:'Comparisons share seeds; do not treat 4800 games as independent. All models are experimental.'};
writeFileSync(filename,JSON.stringify(report,null,2)+'\n');
const fmt=x=>x.toFixed(2),lines=['# Kingdomino XL model — complete paired benchmark',
 '','Four rule combinations and **three prespecified comparisons** at the real Expert budget: 3000 simulations and 1500ms maximum per decision. Each group has 200 seed-swapped paired deals / 400 games.',
 '','| Model mode | Opponent | Rules | W / L / ties | Point margin | 95% CI | Simulations/move model / baseline |',
 '| --- | --- | --- | --- | ---: | --- | --- |'];
for(const x of rows)lines.push('| '+x.mode+' | '+x.baseline+' | '+x.rules+' | '+
  x.modelWins+' / '+x.expertWins+' / '+x.ties+' | '+fmt(x.meanMargin)+' | ['+
  x.CI95.map(fmt).join(', ')+'] | '+fmt(x.modelSimsPerDecision)+' / '+fmt(x.expertSimsPerDecision)+' |');
lines.push('','## Across rules');
for(const [mode,base] of comparisons){const x=totals[mode+'/'+base];
 lines.push('','**'+mode+' vs '+base+'**: '+x.modelWins+' / '+x.expertWins+
  ' ('+x.ties+' ties), mean '+fmt(x.meanMargin)+', 95% CI ['+x.CI95.map(fmt).join(', ')+
  '] over 800 independent paired deals / 1600 games.');}
lines.push('','*Interpretation*: policy/uncapped controls for the expanded legal-action set, while policy/original measures strength against the deployed Expert. The value mode evaluates 1-in-512 leaf neural estimates. Training and model selection must not use these test seeds; a positive finding among the three comparisons needs a further frozen-checkpoint confirmation.');
const md=lines.join('\n')+'\n';
writeFileSync(filename.replace(/\.json$/,'.md'),md);console.log(md);
