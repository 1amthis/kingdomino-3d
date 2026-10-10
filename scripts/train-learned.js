// Reproducible small-regression training of the optional fast placement evaluator.
// Run: node scripts/train-learned.js --train-games 100 --valid-games 20 --teacher-sims 24
// This prints learned coefficients and out-of-sample decision regret. It does NOT
// overwrite learnedEval.js: copying weights should follow separate match benchmarks.
import { Game, Board, DOM, PLACE, DONE } from '../src/core/search/engine.js';
import { Search } from '../src/core/search/mcts.js';
import { mulberry32 } from '../src/core/rng.js';

const opt = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? fallback : Number(process.argv[i + 1]);
};
const start = opt('start', 500);
const trainGames = opt('train-games', 100);
const validGames = opt('valid-games', 20);
const teacherSims = opt('teacher-sims', 24);
const quick = Board.prototype.quickEval;
const cols = ['quick', 'match', 'lone', 'grow', 'touch', 'growlate'];

function initial(seed) {
  const rnd = mulberry32(seed), xs = Array.from({ length: 48 }, (_, i) => i);
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
  return g;
}

// Label 1 position from each third of each full Expert self-play game.
function sample(seed) {
  const g = initial(seed);
  const ss = [new Search({ seed: seed * 10 + 1 }), new Search({ seed: seed * 10 + 2 })];
  const buckets = [[], [], []];
  for (let step = 0; g.phase !== DONE && step < 50; step++) {
    const actor = g.player;
    if (g.phase === PLACE && g.legal().length >= 3) {
      const stage = g.boards[actor].placed;
      buckets[stage < 4 ? 0 : stage < 8 ? 1 : 2].push(g.clone());
    }
    g.apply(ss[actor].choose(g, { sims: 24, ms: 1e9 }).move);
    if (g.nextLine) for (const d of g.nextLine) g.seen[d] = 1;
  }
  if (g.phase !== DONE) throw new Error('Incomplete training game: ' + seed);
  const rnd = mulberry32(seed ^ 0x73a5);
  return buckets.map(b => b[(rnd() * b.length) | 0]).filter(Boolean);
}

function features(b, d, move) {
  const g = b.g, st = g.step, a = move >> 8, z = move & 255;
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
      if (terrain === tt) { own++; match++; }
    }
    if (cc && !own) lone++;
  }
  return [quick.call(b, move, d), match, lone, grow, touch, grow * (b.placed / 12)];
}

function labels(st, seed) {
  const moves = new Search({ seed }).analyse(st, { sims: 0, min: teacherSims, ms: 1e9 }).moves;
  const b = st.boards[st.player], d = st.line[st.idx];
  return moves.map(m => ({ x: features(b, d, m.move), y: m.ev }));
}

function fit(dataset, ridge = 0.08) {
  const n = cols.length, A = Array.from({ length: n }, () => new Float64Array(n));
  const B = new Float64Array(n), scales = new Float64Array(n);
  for (const rows of dataset) {
    const mx = Array(n).fill(0);
    let my = 0;
    for (const row of rows) { my += row.y; for (let i = 0; i < n; i++) mx[i] += row.x[i]; }
    my /= rows.length;
    for (let i = 0; i < n; i++) mx[i] /= rows.length;
    for (const row of rows) {
      const x = row.x.map((v, i) => v - mx[i]), y = row.y - my;
      for (let i = 0; i < n; i++) {
        B[i] += x[i] * y;
        scales[i] += x[i] * x[i];
        for (let j = 0; j < n; j++) A[i][j] += x[i] * x[j];
      }
    }
  }
  for (let i = 0; i < n; i++) A[i][i] += ridge * scales[i] + 1e-7;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[pivot][i])) pivot = j;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [B[i], B[pivot]] = [B[pivot], B[i]];
    const v = A[i][i];
    for (let j = i; j < n; j++) A[i][j] /= v;
    B[i] /= v;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const u = A[k][i];
      for (let j = i; j < n; j++) A[k][j] -= u * A[i][j];
      B[k] -= u * B[i];
    }
  }
  return [...B];
}

function regret(dataset, weights) {
  let original = 0, learned = 0, agreement = 0;
  for (const rows of dataset) {
    const best = Math.max(...rows.map(r => r.y));
    let old = rows[0], pick = rows[0], pv = -Infinity;
    for (const row of rows) {
      if (row.x[0] > old.x[0]) old = row;
      let v = 0;
      for (let i = 0; i < weights.length; i++) v += weights[i] * row.x[i];
      if (v > pv) { pv = v; pick = row; }
    }
    original += best - old.y;
    learned += best - pick.y;
    if (old === pick) agreement++;
  }
  return { original: original / dataset.length, learned: learned / dataset.length, agreement: agreement / dataset.length };
}

const train = [], valid = [];
const t0 = performance.now();
for (let seed = start; seed < start + trainGames + validGames; seed++) {
  for (const [index, st] of sample(seed).entries()) {
    (seed < start + trainGames ? train : valid).push(labels(st, seed * 31 + index));
  }
}
const weights = fit(train);
console.log(JSON.stringify({
  seedRanges: { train: [start, start + trainGames - 1], validation: [start + trainGames, start + trainGames + validGames - 1] },
  teacherSimsPerLegalMove: teacherSims,
  samples: { trainPositions: train.length, trainActions: train.reduce((s, r) => s + r.length, 0), validPositions: valid.length },
  weights: Object.fromEntries(cols.map((name, i) => [name, weights[i]])),
  validation: regret(valid, weights),
  elapsedSeconds: (performance.now() - t0) / 1000,
}, null, 2));
