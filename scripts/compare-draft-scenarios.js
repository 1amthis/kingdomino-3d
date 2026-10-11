// Combine independent bonus-configuration reports; keep each option separate.
// Usage: node scripts/compare-draft-scenarios.js reports out.json out.md
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2] || 'reports';
const jsonName = process.argv[3] || 'draft-production-results.json';
const mdName = process.argv[4] || 'draft-production-results.md';
const names = ['plain', 'middle', 'harmony', 'both'];
const reports = names.map(name => {
  const root = join(dir, 'prod-' + name + '-report');
  const files = readdirSync(root);
  const filename = files.find(f => f === 'prod-' + name + '.json');
  if (!filename) throw Error('Missing report for '+name);
  const s = JSON.parse(readFileSync(join(root, filename), 'utf8'));
  const opts = {plain:[false,false],middle:[true,false],harmony:[false,true],both:[true,true]}[name];
  if (s.rules?.middle !== opts[0] || s.rules?.harmony !== opts[1] ||
      s.budget.sims !== 3000 || s.budget.ms !== 1500 ||
      s.pairedDeals !== 200 || s.games !== 400 ||
      s.mode !== 'tree' || s.shards !== 4 ||
      s.learnedWins + s.originalWins + s.equalScores !== 400)
    throw Error('Bad or incomplete report for '+name+': '+JSON.stringify(s));
  return {name, ...s};
});
const summary = {
  objective:'Independent rule-case confirmation of the learned tree-only drafting heuristic',
  budgets:{sims:3000,ms:1500},
  runRules: names,
  scenarios:reports,
};
writeFileSync(jsonName,JSON.stringify(summary,null,2)+'\n');
const fmt=n=>n.toFixed(2);
const lines=[
  '# Learned draft: Expert production budget & rules',
  '',
  'Each row contains **200 paired deals / 400 games**, 2 players, 5×5 board, 3000 search simulations with a 1500 ms per-decision cap. The learned evaluator orders unexplored drafts in the MCTS tree only; original simulation policy. Different seed ranges for all four rule sets.',
  '',
  '| Rule configuration | Learned wins | Original wins | Draws | Learned margin | Approx. 95% CI | Sims/decision learned / original |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
];
for(const x of reports) lines.push(
  '| '+x.name+' | '+x.learnedWins+' | '+x.originalWins+' | '+x.equalScores+
  ' | '+fmt(x.learnedMeanMargin)+' | ['+x.approximate95CI.map(fmt).join(', ')+
  '] | '+fmt(x.simsPerDecision.learned)+' / '+fmt(x.simsPerDecision.original)+' |'
);
lines.push('', 'Intervals are paired-deal standard-error normal approximations. Do not treat running four comparisons as a single pre-registered positive finding; the model was selected from earlier no-bonus studies.');
const md=lines.join('\n')+'\n';
writeFileSync(mdName,md);
console.log(md);
