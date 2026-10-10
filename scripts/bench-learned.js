// Paired head-to-head between current Expert and the learned placement evaluator.
// Usage: node scripts/bench-learned.js --mode tree --deals 100 --sims 2000 --ms 55 --threads 4 --seed 24000
// --mode tree: trained evaluator for tree expansion and move pruning, original rollout policy
// --mode all:  trained evaluator for both tree and simulation rollouts
// Two-player 5x5, no optional bonuses. Each random deal is replayed from both seats.
// No monkey-patching: different Search instances use their own placement policies.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Game, DONE } from '../src/core/search/engine.js';
import { Search } from '../src/core/search/mcts.js';
import { fastLearnedEval } from '../src/core/search/learnedEval.js';
import { mulberry32 } from '../src/core/rng.js';

const get = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? fallback : Number(process.argv[i + 1]);
};
const deals = get('deals', 100);
const first = get('seed', 24000);
const sims = get('sims', 2000);
const ms = get('ms', 55);
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'tree';
if (mode !== 'tree' && mode !== 'all') throw new Error('Unknown --mode: ' + mode);
const threads = Math.max(1, Math.min(deals, get('threads', Math.min(4, availableParallelism()))));

function setup(seed) {
  const rnd = mulberry32(seed), tiles = Array.from({ length: 48 }, (_, i) => i);
  for (let i = 47; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  const g = new Game(2, 5, false, false);
  g.line = Int8Array.from(tiles.slice(0, 4).sort((a, b) => a - b));
  g.own = new Int8Array(4).fill(-1);
  g.order = new Int8Array([0, 1, 1, 0]);
  g.left = 20;
  for (const d of g.line) g.seen[d] = 1;
  g.determinize(rnd); // fixed actual unseen deck; searches redeterminize independently
  return g;
}

function play(seed, learnedSeat) {
  const g = setup(seed);
  const searches = [
    new Search({ seed: seed * 31 + 1, placementEval: learnedSeat === 0 ? fastLearnedEval : null,
      playoutEval: learnedSeat === 0 && mode === 'all' ? fastLearnedEval : null }),
    new Search({ seed: seed * 31 + 2, placementEval: learnedSeat === 1 ? fastLearnedEval : null,
      playoutEval: learnedSeat === 1 && mode === 'all' ? fastLearnedEval : null }),
  ];
  const stats = { original: { sims: 0, ms: 0, moves: 0 }, learned: { sims: 0, ms: 0, moves: 0 } };
  let steps = 0;
  while (g.phase !== DONE && steps++ < 60) {
    const actor = g.player, kind = actor === learnedSeat ? 'learned' : 'original';
    const start = performance.now();
    const result = searches[actor].choose(g, { sims, ms });
    stats[kind].ms += performance.now() - start;
    stats[kind].sims += result.sims;
    stats[kind].moves++;
    g.apply(result.move);
    if (g.nextLine) for (const d of g.nextLine) g.seen[d] = 1;
  }
  if (g.phase !== DONE) throw new Error('Game failed to complete: ' + seed);
  const scores = g.scores();
  return { seed, learnedSeat, margin: scores[learnedSeat] - scores[1 - learnedSeat], stats };
}
function paired(seed) {
  const a = play(seed, 0), b = play(seed, 1);
  return { seed, margins: [a.margin, b.margin], margin: (a.margin + b.margin) / 2, records: [a, b] };
}

if (!isMainThread) {
  parentPort.on('message', seed => parentPort.postMessage(paired(seed)));
} else {
  const results = [];
  let next = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: threads }, () => new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url));
    const feed = () => next < deals ? worker.postMessage(first + next++) : worker.terminate().then(resolve);
    worker.on('message', record => { results.push(record); feed(); });
    worker.on('error', reject);
    feed();
  })));
  results.sort((a, b) => a.seed - b.seed);
  const games = results.flatMap(x => x.records);
  const mean = results.reduce((s, r) => s + r.margin, 0) / results.length;
  const se = Math.sqrt(results.reduce((s, r) => s + (r.margin - mean) ** 2, 0) / ((results.length - 1) * results.length));
  const average = (type, k) => games.reduce((s, r) => s + r.stats[type][k], 0) / games.reduce((s, r) => s + r.stats[type].moves, 0);
  const output = {
    seed: first, pairedDeals: results.length, games: games.length, mode, budget: { sims, ms },
    learnedWins: games.filter(r => r.margin > 0).length,
    originalWins: games.filter(r => r.margin < 0).length,
    equalScores: games.filter(r => r.margin === 0).length,
    learnedMargin: mean, pairedStandardError: se,
    approximate95CI: [mean - 1.96 * se, mean + 1.96 * se],
    msPerDecision: { learned: average('learned', 'ms'), original: average('original', 'ms') },
    simsPerDecision: { learned: average('learned', 'sims'), original: average('original', 'sims') },
    seconds: (performance.now() - start) / 1000,
    pairedMargins: results.map(r => r.margin),
  };
  console.log(JSON.stringify(output, null, 2));
}
