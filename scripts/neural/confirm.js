// Confirmation of frozen second-generation network on entirely new seed ranges.
// Expects 16 independently seeded 50-pair shards (4 rule sets x 4 shards).
// Usage: node scripts/neural/confirm.js arena out.json out.md
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root=process.argv[2]||'arena',json=process.argv[3]||'confirm.json',
  markdown=process.argv[4]||'confirm.md';
const value=(key,def)=>{const i=process.argv.indexOf('--'+key);return i<0?def:process.argv[i+1]};
const checkpoint=value('checkpoint','model1.json'),minSeed=+value('min-seed','180000'),maxSeed=+value('max-seed','186199');
function files(dir){let ret=[];for(const entry of readdirSync(dir,{withFileTypes:true})){
  const p=join(dir,entry.name);
  if(entry.isDirectory())ret.push(...files(p));else if(entry.name==='result.json')ret.push(p);
}return ret;}
const names=['plain','middle','harmony','both'];
const buckets=Object.fromEntries(names.map(n=>[n,[]]));
const seen=new Set(),all=[];
for(const file of files(root)){
 const r=JSON.parse(readFileSync(file,'utf8'));
 if(r.pairedDeals!==50||r.games!==100||r.budget.sims!==3000||r.budget.ms!==1500)
   throw Error('Bad shard '+file);
 const name=r.rules.middle?(r.rules.harmony?'both':'middle'):(r.rules.harmony?'harmony':'plain');
 if(!r.model.includes(checkpoint))throw Error('Unexpected checkpoint '+r.model+' expected '+checkpoint);
 for(let i=0;i<r.pairedMargins.length;i++){
   const seed=r.seedRange[0]+i;
   if(seen.has(seed))throw Error('Duplicate confirmation seed '+seed);
   if(seed<minSeed||seed>maxSeed)throw Error('Unexpected seed range '+seed);
   seen.add(seed);const value=r.pairedMargins[i];
   if(!Number.isFinite(value))throw Error('Nonfinite margin');
   buckets[name].push(value);all.push(value);
 }
 (buckets[name+'_wins']??=[]).push([r.neuralWins,r.originalWins,r.ties]);
}
const summarize=(pairs,stat)=>{
 const n=pairs.length,avg=pairs.reduce((a,b)=>a+b,0)/n;
 const se=Math.sqrt(pairs.reduce((s,x)=>s+(x-avg)**2,0)/(n*(n-1)));
 const outcomes=stat.reduce((a,b)=>a.map((v,i)=>v+b[i]),[0,0,0]);
 return {pairedDeals:n,games:2*n,neuralWins:outcomes[0],expertWins:outcomes[1],
  ties:outcomes[2],meanMargin:avg,pairedSE:se,CI95:[avg-1.96*se,avg+1.96*se]};
};
const rows={};
for(const name of names){
 if(buckets[name].length!==200||(buckets[name+'_wins']||[]).length!==4)
   throw Error('Incomplete case '+name);
 rows[name]=summarize(buckets[name],buckets[name+'_wins']);
 if(rows[name].neuralWins+rows[name].expertWins+rows[name].ties!==400)
   throw Error('Broken outcome counts '+name);
}
const global=summarize(all,names.flatMap(name=>buckets[name+'_wins']));
if(global.pairedDeals!==800||global.games!==1600)throw Error('Expected 800 independent pairs');
const result={description:'Frozen neural '+checkpoint+' root policy, preselected before new arena', checkpoint,
 budget:{sims:3000,ms:1500},total:global,rules:rows,seeds:[...seen].sort((a,b)=>a-b)};
writeFileSync(json,JSON.stringify(result,null,2)+'\n');
const f=x=>Number(x).toFixed(2);
const lines=['# Independent confirmation — frozen neural checkpoint '+checkpoint,'',
 '2-player 5×5, 3000 simulations maximum and 1500 ms maximum per decision, each deal replayed with reversed seats. Checkpoint is fixed before this seed range; original Expert is unchanged.',
 '', '| Rules | Neural W / Expert W (draws) | Mean margin | Approximate paired 95% CI |',
 '| --- | --- | ---: | ---: |'];
for(const name of names){
 const r=rows[name];
 lines.push('| '+name+' | '+r.neuralWins+' / '+r.expertWins+' ('+r.ties+') | '+f(r.meanMargin)+' | ['+r.CI95.map(f).join(', ')+'] |');
}
lines.push('','**800 paired deals / 1600 games:** Neural '+global.neuralWins+' wins, Expert '+global.expertWins+
  ', draws '+global.ties+'. Mean neural margin '+f(global.meanMargin)+
  ', 95% paired CI ['+global.CI95.map(f).join(', ')+'].',
 '','An interval containing zero is not proof of improvement. If positive, further testing on devices with actual browser timing and potentially 3–4 players is still required.');
writeFileSync(markdown,lines.join('\n')+'\n');
console.log(lines.join('\n'));
