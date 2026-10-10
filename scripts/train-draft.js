// Train a cheap pick heuristic from equal-budget MCTS estimates of actual draft decisions.
// Reproducible, no third-party ML dependencies. Output JSON, with complete seed holdout.
//   node scripts/train-draft.js --train-games 160 --valid-games 40 --teacher-sims 32
import { Game, INIT, PICK, DONE } from '../src/core/search/engine.js';
import { Search } from '../src/core/search/mcts.js';
import { draftFeatureVector, DRAFT_FEATURES } from '../src/core/search/draftFeatures.js';
import { mulberry32 } from '../src/core/rng.js';
const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? fallback : +process.argv[i + 1];
};
const startSeed = arg('seed', 1000), trainGames = arg('train-games', 160),
  validGames = arg('valid-games', 40), teacherSims = arg('teacher-sims', 32),
  trajectorySims = arg('trajectory-sims', 24), ridge = arg('ridge', 0.12);
const P = DRAFT_FEATURES.length;
function initial(seed) {
  const rnd = mulberry32(seed), deck = Array.from({ length: 48 }, (_, i) => i);
  for (let i = 47; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const g = new Game(2, 5, false, false);
  g.line = Int8Array.from(deck.slice(0, 4).sort((a, b) => a - b));
  g.own = new Int8Array(4).fill(-1);
  g.order = new Int8Array([0, 1, 1, 0]);
  g.left = 20;
  for (const d of g.line) g.seen[d] = 1;
  g.determinize(rnd);
  return g;
}
function positions(seed) {
  const st = initial(seed);
  const ss = [new Search({ seed: seed * 31 + 1 }), new Search({ seed: seed * 31 + 2 })];
  // Distinct buckets reduce correlation and cover the opening, middle and late draft.
  const bucket = [[], [], [], []];
  for (let step = 0; st.phase !== DONE && step < 60; step++) {
    if (st.phase === INIT || st.phase === PICK) {
      const choices = st.freeSlots();
      if (choices.length >= 2) {
        const stage = st.boards[st.player].placed;
        const k = st.phase === INIT ? 0 : stage < 4 ? 1 : stage < 8 ? 2 : 3;
        bucket[k].push(st.clone());
      }
    }
    const a = ss[st.player].choose(st, { sims: trajectorySims, ms: 1e9 }).move;
    st.apply(a);
    if (st.nextLine) for (const d of st.nextLine) st.seen[d] = 1;
  }
  if (st.phase !== DONE) throw Error('Incomplete game ' + seed);
  const rnd = mulberry32(seed ^ 0x5163b3);
  return bucket.map(b => b[(rnd() * b.length) | 0]).filter(Boolean);
}
function labels(st, seed) {
  const analysis = new Search({ seed }).analyse(st, { sims: 0, min: teacherSims, ms: 1e9 });
  return analysis.moves.map(m => ({ x: draftFeatureVector(st, m.move), y: m.ev, move: m.move }));
}
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    if (Math.abs(A[i][i]) < 1e-10) continue;
    const div = A[i][i];
    for (let j = i; j < n; j++) A[i][j] /= div;
    b[i] /= div;
    for (let k = 0; k < n; k++) if (k !== i) {
      const mul = A[k][i];
      for (let j = i; j < n; j++) A[k][j] -= mul * A[i][j];
      b[k] -= mul * b[i];
    }
  }
  return [...b];
}
function fit(data, which, lambda) {
  const n = which.length, A = Array.from({ length: n }, () => Array(n).fill(0));
  const b = Array(n).fill(0), scale = Array(n).fill(0);
  for (const { rows } of data) {
    const mx = which.map(i => rows.reduce((s, r) => s + r.x[i], 0) / rows.length);
    const my = rows.reduce((s, r) => s + r.y, 0) / rows.length;
    for (const row of rows) {
      const xx = which.map((j, i) => row.x[j] - mx[i]), y = row.y - my;
      for (let i = 0; i < n; i++) {
        b[i] += xx[i] * y; scale[i] += xx[i] * xx[i];
        for (let j = 0; j < n; j++) A[i][j] += xx[i] * xx[j];
      }
    }
  }
  for (let i = 0; i < n; i++) A[i][i] += lambda * scale[i] + 1e-7;
  return solve(A, b);
}
function validate(data, which, weights) {
  const stats = Array.from({ length: 4 }, () => ({ positions: 0, regBase: 0, regLearn: 0, winsBase: 0, winsLearn: 0, agree: 0 }));
  for (const { stage, rows } of data) {
    const best = Math.max(...rows.map(r => r.y));
    const base = rows.reduce((a, b) => b.x[0] > a.x[0] ? b : a);
    const score = r => weights.reduce((s, w, i) => s + w * r.x[which[i]], 0);
    const select = rows.reduce((a, b) => score(b) > score(a) ? b : a);
    const s = stats[stage]; s.positions++;
    s.regBase += best - base.y; s.regLearn += best - select.y;
    s.winsBase += base.y === best; s.winsLearn += select.y === best;
    s.agree += base.move === select.move;
  }
  const total = stats.reduce((a, b) => ({
    positions: a.positions + b.positions, regBase: a.regBase + b.regBase, regLearn: a.regLearn + b.regLearn,
    winsBase: a.winsBase + b.winsBase, winsLearn: a.winsLearn + b.winsLearn, agree: a.agree + b.agree,
  }), { positions: 0, regBase: 0, regLearn: 0, winsBase: 0, winsLearn: 0, agree: 0 });
  const norm = s => ({
    positions: s.positions, baseRegret: s.regBase / s.positions, learnedRegret: s.regLearn / s.positions,
    baseTopRate: s.winsBase / s.positions, learnedTopRate: s.winsLearn / s.positions,
    agreement: s.agree / s.positions,
  });
  return { overall: norm(total), opening: norm(stats[0]), early: norm(stats[1]), middle: norm(stats[2]), late: norm(stats[3]) };
}
const t0 = performance.now(), train = [], valid = [];
for (let seed = startSeed; seed < startSeed + trainGames + validGames; seed++) {
  const target = seed < startSeed + trainGames ? train : valid;
  for (const [stage, st] of positions(seed).entries()) {
    // `positions` may skip empty buckets; use the actual state to identify its stage.
    const stage0 = st.phase === INIT ? 0 : st.boards[st.player].placed < 4 ? 1 : st.boards[st.player].placed < 8 ? 2 : 3;
    target.push({ stage: stage0, rows: labels(st, seed * 31 + stage) });
  }
}
const configs = {
  baseline: [0], minimal: [0,1,6,7,8,10], small: [0,1,2,3,6,7,8,10,11],
  full: DRAFT_FEATURES.map((_, i) => i),
};
const out = {
  seedRanges: { train: [startSeed, startSeed + trainGames - 1], valid: [startSeed + trainGames, startSeed + trainGames + validGames - 1] },
  teacherSims, trajectorySims, ridge, features: DRAFT_FEATURES,
  trainPositions: train.length, trainActions: train.reduce((s,p)=>s+p.rows.length,0),
  validPositions: valid.length, validActions: valid.reduce((s,p)=>s+p.rows.length,0),
  models: {},
};
for (const [name, which] of Object.entries(configs)) {
  const weights = fit(train, which, ridge);
  out.models[name] = { columns: which.map(i=>DRAFT_FEATURES[i]), weights, validation: validate(valid, which, weights) };
}
out.elapsedSeconds = (performance.now() - t0) / 1000;
console.log(JSON.stringify(out, null, 2));
