// Two-player games, Hard (src/core/ai.js) against the same AI with dead squares counted by matching
// (ai-matching.js), on paired deals: every deal is played twice, seats swapped.
//   node scripts/graph/duel.js --deals 500 --threads 4 --bonuses 0|1 --out duel.jsonl
// --bonuses 1 plays with Middle Kingdom and Harmony. A stopped run carries on from the deals in --out.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rank } from '../../src/core/rules.js';
import { choosePlacement, chooseSlot } from '../../src/core/ai.js';
import { Rng } from '../../src/core/rng.js';
import { dealTable, playTurns } from '../../src/core/table.js';
import { choosePlacementG, chooseSlotG } from './ai-matching.js';

function play(types, seed, bonus) {
  const table = dealTable({ players: 2, seed, middleKingdom: bonus, harmony: bonus });
  const { players, opts, lineN } = table, rng = new Rng(seed ^ 0x5bd1e995);
  const decide = (d) => {
    const p = d.player, g = types[p.index] === 'hardG', others = players.filter((o) => o !== p);
    if (d.kind === 'select') return (g ? chooseSlotG(p, others, d.options, lineN, opts, rng) : chooseSlot(p, others, d.options, lineN, opts, 'hard', rng)).index;
    return g ? choosePlacementG(p.kingdom, d.slot.domino, opts) : choosePlacement(p.kingdom, d.slot.domino, opts, 'hard', rng);
  };
  const turns = playTurns(table);
  for (let step = turns.next(); !step.done;) step = turns.next(decide(step.value));
  const rows = rank(players, opts);
  return players.map((p) => {
    const r = rows.find((x) => x.player === p);
    return { type: types[p.index], total: r.s.total, place: r.place, complete: p.kingdom.isComplete(), discards: p.kingdom.discards.length };
  });
}

if (isMainThread) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const deals = +arg('deals', 500), bonus = arg('bonuses', '0') === '1', out = arg('out', 'duel.jsonl');
  const threads = +arg('threads', Math.min(4, availableParallelism()));
  const done = new Set(existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).seed) : []);
  const todo = [];
  for (let s = 1; s <= deals; s++) if (!done.has(s)) todo.push(s);
  let next = 0;
  for (let i = 0; i < Math.min(threads, todo.length); i++) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { bonus } });
    w.on('message', (m) => {
      if (m.rec) appendFileSync(out, JSON.stringify(m.rec) + '\n');
      w.postMessage(next < todo.length ? todo[next++] : null);
    });
  }
} else {
  parentPort.on('message', (seed) => {
    if (seed === null) process.exit(0);
    const a = play(['hard', 'hardG'], seed, workerData.bonus), b = play(['hardG', 'hard'], seed, workerData.bonus);
    parentPort.postMessage({ rec: { seed, games: [a, b] } });
  });
  parentPort.postMessage({});
}
