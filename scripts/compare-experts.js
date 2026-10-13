// Reproducible old/new Expert matches using the real table flow and official tie-breakers.
// Each deal is replayed with the Experts in both seats (all six ordered seat pairs with 3 players).
// Example: node scripts/compare-experts.js --old ../kingdomino-3d-old --mode bonuses --deals 100
//   --threads 4 --seed 1000 --output /absolute/path/results.jsonl
// Modes: standard (5x5), bonuses (5x5 + both bonuses), duel (7x7 + both), three (3 seats + Hard + both).
// Default search budgets match expert.js; --sims / --ms override both versions equally.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dealTable, playTurns } from '../src/core/table.js';
import { rank } from '../src/core/rules.js';
import { choosePlacement, chooseSlot } from '../src/core/ai.js';
import { describeTable } from '../src/core/search/state.js';
import { Rng, hashSeed } from '../src/core/rng.js';
import { encodeMove } from '../src/core/moves.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = arg('mode', 'standard');
if (!['standard', 'bonuses', 'duel', 'three'].includes(mode)) throw new Error(`Unknown mode ${mode}`);
const oldPath = resolve(arg('old', resolve(root, '../kingdomino-3d-old')));
const newPath = resolve(arg('new', root));
const n = mode === 'three' ? 3 : 2;
const sims = +arg('sims', n > 2 ? 6000 : 3000), ms = +arg('ms', 1500);
const deals = +arg('deals', 100), seed = +arg('seed', 1000);
if (![sims, ms, deals, seed].every(Number.isFinite) || sims < 1 || ms <= 0 || !Number.isInteger(deals) || deals < 1) {
  throw new Error('Invalid simulation budget, time budget, deal count or seed');
}
const rules = { players: n, middleKingdom: mode !== 'standard', harmony: mode !== 'standard', mightyDuel: mode === 'duel' };
const moduleFrom = (path, file) => import(pathToFileURL(resolve(path, 'src/core/search', file)).href);
const [[oldSearch, oldState], [newSearch, newState]] = await Promise.all([
  Promise.all([moduleFrom(oldPath, 'mcts.js'), moduleFrom(oldPath, 'state.js')]),
  Promise.all([moduleFrom(newPath, 'mcts.js'), moduleFrom(newPath, 'state.js')]),
]);
const versions = { old: { Search: oldSearch.Search, ...oldState }, new: { Search: newSearch.Search, ...newState } };

function play({ dealSeed, newSeat, oldSeat }) {
  const table = dealTable({ ...rules, seed: dealSeed });
  const roles = Array(n).fill('hard');
  roles[newSeat] = 'new'; roles[oldSeat] = 'old';
  const searches = roles.map((role, seat) => role === 'hard' ? null : new versions[role].Search({ seed: hashSeed('compare-experts', dealSeed, seat) }));
  const rng = new Rng(dealSeed ^ 0x5bd1e995), stats = {};
  for (const role of ['old', 'new']) stats[role] = { calls: 0, sims: 0, ms: 0, maxMs: 0, limited: 0 };
  const moves = [];
  const turns = playTurns(table);
  for (let step = turns.next(); !step.done;) {
    const d = step.value, p = d.player, role = roles[p.index];
    let move;
    if (role === 'hard') {
      move = d.kind === 'select'
        ? chooseSlot(p, table.players.filter((q) => q !== p), d.options, table.lineN, table.opts, 'hard', rng).index
        : choosePlacement(p.kingdom, d.slot.domino, table.opts, 'hard', rng);
    } else {
      const v = versions[role];
      const game = v.gameFrom(describeTable({ ...table, deckLeft: table.deck.length }, d.phase, d.king));
      const t0 = performance.now();
      const chosen = searches[p.index].choose(game, { sims, ms });
      const elapsed = performance.now() - t0, s = stats[role];
      s.calls++; s.sims += chosen.sims; s.ms += elapsed; s.maxMs = Math.max(s.maxMs, elapsed);
      if (chosen.sims > 0 && chosen.sims < sims) s.limited++;
      move = v.moveOut(game, chosen.move);
    }
    moves.push(encodeMove(p.index, d.kind, move));
    step = turns.next(move); // playTurns rejects any illegal draft, placement or discard.
  }
  const ranking = rank(table.players, table.opts);
  const a = ranking.find((r) => r.player.index === newSeat), b = ranking.find((r) => r.player.index === oldSeat);
  return { dealSeed, newSeat, oldSeat, roles, scoreNew: a.s.total, scoreOld: b.s.total,
    margin: a.s.total - b.s.total, result: a.place < b.place ? 'win' : a.place > b.place ? 'loss' : 'tie',
    rankNew: a.place, rankOld: b.place, stats, moves };
}

if (!isMainThread) {
  parentPort.on('message', (job) => parentPort.postMessage(play(job)));
} else {
  const output = arg('output', null);
  if (!output) throw new Error('--output is required to preserve per-game evidence');
  if (existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
  const jobs = [];
  for (let i = 0; i < deals; i++) {
    for (let newSeat = 0; newSeat < n; newSeat++) {
      for (let oldSeat = 0; oldSeat < n; oldSeat++) {
        if (newSeat !== oldSeat) jobs.push({ dealSeed: seed + i, newSeat, oldSeat });
      }
    }
  }
  const threads = Math.max(1, Math.min(jobs.length, +arg('threads', Math.min(4, availableParallelism()))));
  const revision = (path) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path, encoding: 'utf8' }).trim();
  mkdirSync(dirname(resolve(output)), { recursive: true });
  const metadata = { type: 'metadata', mode, rules, deals, seed, sims, ms, threads, node: process.version,
    oldRevision: revision(oldPath), newRevision: revision(newPath), timestamp: new Date().toISOString(),
    searchSeed: 'hashSeed(compare-experts, dealSeed, seat)', pairedBy: 'dealSeed' };
  writeFileSync(output, `${JSON.stringify(metadata)}\n`);
  const results = [], t0 = performance.now();
  let next = 0;
  await Promise.all(Array.from({ length: threads }, () => new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { argv: process.argv.slice(2), workerData: true });
    const feed = () => next < jobs.length ? worker.postMessage(jobs[next++]) : worker.terminate().then(resolve);
    worker.on('message', (r) => {
      results.push(r);
      appendFileSync(output, `${JSON.stringify({ type: 'game', ...r })}\n`);
      if (results.length % 20 === 0 || results.length === jobs.length) {
        const wins = results.filter((x) => x.result === 'win').length, ties = results.filter((x) => x.result === 'tie').length;
        const margin = results.reduce((a, x) => a + x.margin, 0) / results.length;
        console.log(`${mode}: ${results.length}/${jobs.length} games, new W/T/L ${wins}/${ties}/${results.length - wins - ties}, mean lead ${margin.toFixed(2)}, elapsed ${((performance.now() - t0) / 1000).toFixed(1)}s`);
      }
      feed();
    });
    worker.on('error', reject);
    feed();
  })));
  // Keep incremental evidence during a run, then persist the complete in-memory record in one write.
  // Some shared filesystems can lose individual appends; counts/replays must agree before analysis.
  const completed = { type: 'complete', games: results.length, wallSeconds: (performance.now() - t0) / 1000 };
  writeFileSync(output, [metadata, ...results.map((r) => ({ type: 'game', ...r })), completed].map(JSON.stringify).join('\n') + '\n');
}
