// The solo placement game: 12 dominoes drawn at random, each seen only when it must be laid. Online
// policies against the clairvoyant optimum (the exact solver, which knows the whole sequence).
//   node scripts/graph/solo.js --from 1 --to 200 --threads 4 --out solo.jsonl --oracleMs 180000
// One JSON line per sequence; a stopped run carries on from the sequences already in --out.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Kingdom, dominoById } from '../../src/core/rules.js';
import { choosePlacement } from '../../src/core/ai.js';
import { Rng } from '../../src/core/rng.js';
import {
  shuffled, mulberry32, playOnline, randomPolicy, greedyPolicy, quickPolicy, evalPolicy, graphEval, mcePolicy,
  beamSearch, upperBound, suffixStats, score, solveOffline, Board,
} from './lib.js';
import { choosePlacementG } from './ai-matching.js';

const seqOf = (seed) => shuffled(mulberry32(seed), 48).slice(0, 12);

// The Hard placement (or its matching variant) on the rules engine.
function playRules(seq, choose) {
  const k = new Kingdom(5), rng = new Rng(1);
  for (const d of seq) {
    const dom = dominoById(d + 1), p = choose(k, dom, rng);
    if (p) k.place(dom, p.x, p.y, p.rot); else k.discard(dom);
  }
  return { score: k.score().base, discards: k.discards.length, complete: k.isComplete() };
}

function runOne(seed, oracleMs) {
  const seq = seqOf(seed), rec = { seed, seq: seq.map((d) => d + 1), agents: {} };
  const time = (name, f) => {
    const t0 = performance.now(), r = f();
    rec.agents[name] = { score: r.score, discards: r.discards, complete: r.complete, ms: +(performance.now() - t0).toFixed(1) };
  };
  time('random', () => playOnline(seq, randomPolicy, { rnd: mulberry32(seed ^ 0xabc) }));
  time('greedy', () => playOnline(seq, greedyPolicy));
  time('quick', () => playOnline(seq, quickPolicy));
  time('hard', () => playRules(seq, (k, dom, rng) => choosePlacement(k, dom, {}, 'hard', rng)));
  time('hardMatching', () => playRules(seq, (k, dom) => choosePlacementG(k, dom, {})));
  time('graph', () => playOnline(seq, evalPolicy(graphEval)));
  time('mce50', () => playOnline(seq, mcePolicy(50), { rnd: mulberry32(seed ^ 0x123) }));
  time('mce200', () => playOnline(seq, mcePolicy(200), { rnd: mulberry32(seed ^ 0x456) }));
  // clairvoyant: two beam searches give an incumbent, then the exact branch and bound
  const t0 = performance.now(), { cells, crowns } = suffixStats(seq);
  const beam = Math.max(beamSearch(seq, 400, (b) => graphEval(b)), beamSearch(seq, 200, (b, s) => 0.5 * score(b) + 0.5 * upperBound(b, cells[s], crowns[s])));
  const beamMs = performance.now() - t0;
  const r = solveOffline(seq, { timeMs: oracleMs, incumbent: beam - 1 });
  rec.oracle = { beam, beamMs: +beamMs.toFixed(0), optimum: r.optimum, best: Math.max(r.best, beam), aborted: r.aborted, nodes: r.nodes, ttHits: r.ttHits, ms: +r.ms.toFixed(0), rootBound: upperBound(new Board(5), cells[0], crowns[0]) };
  return rec;
}

if (isMainThread) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const from = +arg('from', 1), to = +arg('to', 200), out = arg('out', 'solo.jsonl'), oracleMs = +arg('oracleMs', 180000);
  const threads = +arg('threads', Math.min(4, availableParallelism()));
  const done = new Set(existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).seed) : []);
  const todo = [];
  for (let s = from; s <= to; s++) if (!done.has(s)) todo.push(s);
  console.log(`${todo.length} sequences to play (${done.size} already in ${out})`);
  let next = 0;
  for (let i = 0; i < Math.min(threads, todo.length); i++) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { oracleMs } });
    w.on('message', (m) => {
      if (m.rec) {
        appendFileSync(out, JSON.stringify(m.rec) + '\n');
        const o = m.rec.oracle;
        console.log(m.rec.seed, Object.entries(m.rec.agents).map(([k, v]) => `${k}=${v.score}`).join(' '), `opt=${o.optimum ?? '≥' + o.best} (${o.ms} ms)`);
      }
      w.postMessage(next < todo.length ? todo[next++] : null);
    });
  }
} else {
  parentPort.on('message', (seed) => {
    if (seed === null) process.exit(0);
    parentPort.postMessage({ rec: runOne(seed, workerData.oracleMs) });
  });
  parentPort.postMessage({});
}
