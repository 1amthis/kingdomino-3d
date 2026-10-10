// Aggregate disjoint seeded shards of scripts/bench-learned.js.
// Usage: node scripts/aggregate-learned.js shards/ bench-300.json
// Each shard contains one result.json inside a named subdirectory.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2] || 'shards';
const out = process.argv[3] || 'bench-300.json';
const files = [];
function walk(path) {
  for (const d of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, d.name);
    if (d.isDirectory()) walk(p);
    else if (d.name === 'result.json') files.push(p);
  }
}
walk(dir);
if (!files.length) throw Error('No shard result.json files in ' + dir);
const chunks = files.map(f => JSON.parse(readFileSync(f, 'utf8'))).sort((a,b) => a.seed-b.seed);
const mode = chunks[0].mode, budget = chunks[0].budget;
const games = [], seeds = new Set();
const sum = field => chunks.reduce((n, c) => n + c[field], 0);
for (const c of chunks) {
  if (c.mode !== mode || c.budget.sims !== budget.sims || c.budget.ms !== budget.ms ||
      c.pairedMargins.length !== c.pairedDeals || c.games !== 2*c.pairedDeals)
    throw Error('Invalid or incompatible shard ' + c.seed);
  for (let i = 0; i < c.pairedDeals; i++) {
    const seed = c.seed+i;
    if (seeds.has(seed)) throw Error('Repeated seed '+seed);
    seeds.add(seed);
    games.push({seed, margin:c.pairedMargins[i]});
  }
}
games.sort((a,b)=>a.seed-b.seed);
for(let i=1;i<games.length;i++)if(games[i].seed !== games[i-1].seed+1)throw Error('Missing deal seed '+(games[i-1].seed+1));
const n = games.length, mean = games.reduce((s,g)=>s+g.margin,0)/n;
const se = Math.sqrt(games.reduce((s,g)=>s+(g.margin-mean)**2,0)/(n*(n-1)));
const weighted = (kind,key) => chunks.reduce((s,c)=>s+c.games*c[kind][key],0)/sum('games');
const summary = {
  mode,budget,pairedDeals:n,games:sum('games'),seedRange:[games[0].seed,games[n-1].seed],
  learnedWins:sum('learnedWins'),originalWins:sum('originalWins'),equalScores:sum('equalScores'),
  learnedMeanMargin:mean,pairedStandardError:se,approximate95CI:[mean-1.96*se,mean+1.96*se],
  msPerDecision:{learned:weighted('msPerDecision','learned'),original:weighted('msPerDecision','original')},
  simsPerDecision:{learned:weighted('simsPerDecision','learned'),original:weighted('simsPerDecision','original')},
  fullPairedMargins:games.map(g=>g.margin),shards:files.length,
};
if(summary.learnedWins+summary.originalWins+summary.equalScores!==summary.games)throw Error('Result totals mismatch');
writeFileSync(out,JSON.stringify(summary,null,2)+'\n');
const fmt=v=>Number(v).toFixed(2);
const markdown=[
  '# Learned evaluator benchmark',
  '| Measure | Result |','|---|---:|',
  '| Mode | '+mode+' |',
  '| Paired deals / games | '+n+' / '+summary.games+' |',
  '| Seed range | '+summary.seedRange.join('–')+' |',
  '| Learned / original wins (ties) | '+summary.learnedWins+' / '+summary.originalWins+' ('+summary.equalScores+') |',
  '| Learned mean point margin | '+fmt(mean)+' |',
  '| 95% CI (normal approx., paired deals) | ['+summary.approximate95CI.map(fmt).join(', ')+'] |',
  '| Learned / original simulations per move | '+fmt(summary.simsPerDecision.learned)+' / '+fmt(summary.simsPerDecision.original)+' |',
  '| Learned / original ms per move | '+fmt(summary.msPerDecision.learned)+' / '+fmt(summary.msPerDecision.original)+' |',
  '',
  'Interpretation: the score-margin CI must exclude 0 to establish a statistically detectable difference. Budget: '+JSON.stringify(budget)+'.'
].join('\n');
console.log(markdown);
writeFileSync(out.replace(/\.json$/,'.md'),markdown+'\n');
