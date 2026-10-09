// Head-to-head benchmark: the expert search against a heuristic level, on paired deals (every deal is
// played once from each seat, so the luck of the draw cancels out). Games are spread over worker threads.
//   node scripts/bench.js --games 40 --vs hard --sims 2000 --players 2 --middle --harmony --duel --threads 4 --seed 1000
// With 3-4 players, a few hundred games are needed to see a point of difference: the lead over the best
// of three opponents swings by about 12 points from game to game.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { playGame } from './headless.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const games = +arg('games', 20), players = +arg('players', 2), vs = arg('vs', 'hard'), first = +arg('seed', 1000);
const budget = { sims: +arg('sims', 2000), ms: +arg('ms', 10000) };
const rules = { middleKingdom: !!arg('middle', false), harmony: !!arg('harmony', false), mightyDuel: !!arg('duel', false) };

// One game: the expert takes each seat in turn; every other seat is the heuristic.
function play(g) {
  const seat = g % players, seed = first + Math.floor(g / players);
  const types = Array.from({ length: players }, (_, i) => (i === seat ? 'expert' : vs));
  const { ranking, stats } = playGame({ types, seed, ...rules, budget });
  const me = ranking.find((r) => r.player.type === 'expert');
  const others = ranking.filter((r) => r !== me).map((r) => r.s.total);
  const shared = ranking.filter((r) => r.place === 1).length > 1;
  return { g, seat, seed, me: me.s.total, best: Math.max(...others), mean: others.reduce((a, b) => a + b, 0) / others.length,
    result: me.place !== 1 ? 'loss' : shared ? 'tie' : 'win', stats };
}

if (!isMainThread) {
  parentPort.on('message', (g) => parentPort.postMessage(play(g)));
} else {
  const threads = Math.max(1, Math.min(games, +arg('threads', Math.min(4, availableParallelism()))));
  const results = [];
  let next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: threads }, () => new Promise((resolve, reject) => {
    const w = new Worker(fileURLToPath(import.meta.url), { argv: process.argv.slice(2) });
    const feed = () => (next < games ? w.postMessage(next++) : w.terminate().then(resolve));
    w.on('message', (r) => {
      results.push(r);
      const tally = ['win', 'tie', 'loss'].map((k) => results.filter((x) => x.result === k).length).join('-');
      console.log(`game ${r.g + 1} (deal ${r.seed}, seat ${r.seat}): expert ${r.me} vs best ${vs} ${r.best}  running ${tally}`);
      feed();
    });
    w.on('error', reject);
    feed();
  })));

  const count = (k) => results.filter((r) => r.result === k).length;
  // mean ± standard error
  const avg = (f) => {
    const xs = results.map(f), m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const se = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) / xs.length) : 0;
    return `${m.toFixed(1)} ± ${se.toFixed(1)}`;
  };
  const sum = (k) => results.reduce((a, r) => a + r.stats[k], 0);
  console.log(`\nexpert vs ${vs}, ${players} players${rules.middleKingdom ? ', Middle Kingdom' : ''}${rules.harmony ? ', Harmony' : ''}${rules.mightyDuel ? ', Mighty Duel' : ''}`);
  console.log(`${count('win')} wins, ${count('tie')} ties, ${count('loss')} losses over ${games} games (${(100 * count('win') / games).toFixed(0)}% wins)`);
  console.log(players > 2
    ? `average margin ${avg((r) => r.me - r.best)} points over the best ${vs}, ${avg((r) => r.me - r.mean)} over the average one`
    : `average margin ${avg((r) => r.me - r.best)} points`);
  console.log(`${Math.round(sum('sims') / sum('moves'))} simulations and ${Math.round(sum('ms') / sum('moves'))} ms per move; ${((performance.now() - t0) / 1000).toFixed(0)} s in all on ${threads} thread${threads > 1 ? 's' : ''}`);
}
