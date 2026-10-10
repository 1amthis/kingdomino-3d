// Optional learned rollout heuristic: numeric parity, legal decisions, and no state mutations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, DOM, Game, DONE } from '../src/core/search/engine.js';
import { Search } from '../src/core/search/mcts.js';
import { fastLearnedEval, LEARNED_WEIGHTS } from '../src/core/search/learnedEval.js';
import { mulberry32 } from '../src/core/rng.js';

function reference(b, d, move) {
  const a = move >> 8, z = move & 255, g = b.g, st = g.step;
  const ta = DOM[4 * d], tz = DOM[4 * d + 2], ca = DOM[4 * d + 1], cz = DOM[4 * d + 3];
  const x0 = Math.min(b.x0, g.col[a], g.col[z]), x1 = Math.max(b.x1, g.col[a], g.col[z]);
  const y0 = Math.min(b.y0, g.row[a], g.row[z]), y1 = Math.max(b.y1, g.row[a], g.row[z]);
  const grow = x1 - x0 + y1 - y0 - (b.x1 - b.x0 + b.y1 - b.y0);
  let match = 0, touch = 0, lone = 0;
  for (let j = 0; j < 2; j++) {
    const cell = j ? z : a, other = j ? a : z, tt = j ? tz : ta, cc = j ? cz : ca;
    let own = 0;
    for (let k = 0; k < 4; k++) {
      const n = cell + st[k], terrain = b.t[n];
      if (!terrain || terrain === 8 || n === other) continue;
      touch++;
      if (terrain === tt) { match++; own++; }
    }
    if (cc && !own) lone++;
  }
  return LEARNED_WEIGHTS.quick * b.quickEval(move, d) +
    LEARNED_WEIGHTS.match * match + LEARNED_WEIGHTS.lone * lone +
    LEARNED_WEIGHTS.grow * grow + LEARNED_WEIGHTS.touch * touch +
    LEARNED_WEIGHTS.growlate * grow * (b.placed / 12);
}

test('fused model equals a separate feature implementation on random legal moves, both sizes', () => {
  const buf = new Int32Array(1024);
  let checks = 0;
  for (const size of [5, 7]) for (let seed = 1; seed <= 80; seed++) {
    const b = new Board(size), rnd = mulberry32(seed + 300);
    for (let step = 0; step < (size === 5 ? 12 : 24); step++) {
      const d = (rnd() * 48) | 0, n = b.placements(d, buf);
      if (!n) continue;
      for (let i = 0; i < n; i++) {
        const m = buf[i];
        assert.ok(Math.abs(fastLearnedEval.call(b, m, d) - reference(b, d, m)) < 1e-8);
        checks++;
      }
      b.place(buf[(rnd() * n) | 0], d);
    }
  }
  assert.ok(checks > 2000, String(checks));
});

test('learned pruning remains legal, and the default MCTS does not change', () => {
  const rnd = mulberry32(104);
  const xs = Array.from({ length: 48 }, (_, i) => i);
  for (let i = 47; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  const g = new Game(2, 5, false, false);
  g.line = Int8Array.from(xs.slice(0, 4).sort((a, b) => a - b));
  g.own = new Int8Array(4).fill(-1);
  g.order = new Int8Array([0, 1, 1, 0]);
  g.left = 20;
  for (const d of g.line) g.seen[d] = 1;
  g.determinize(rnd);
  const baselineA = new Search({ seed: 9 });
  const baselineB = new Search({ seed: 9, placementEval: null });
  const r1 = baselineA.choose(g.clone(), { sims: 100, ms: 100000 });
  const r2 = baselineB.choose(g.clone(), { sims: 100, ms: 100000 });
  assert.deepEqual(r1, r2);
  const experts = [new Search({ seed: 13, placementEval: fastLearnedEval }), new Search({ seed: 17 })];
  for (let step = 0; g.phase !== DONE && step < 50; step++) {
    const actor = g.player;
    const legal = g.legal();
    const { move } = experts[actor].choose(g, { sims: 40, ms: 100000 });
    assert.ok(legal.includes(move), 'the chosen action must be legal');
    g.apply(move);
    if (g.nextLine) for (const d of g.nextLine) g.seen[d] = 1;
  }
  assert.equal(g.phase, DONE);
});
