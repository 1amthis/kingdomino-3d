// Strategy studies with the Expert's search, spread over worker threads (4 by default; --threads N).
//   node scripts/study.js openings --deals 3000 --sims 5000 --players 2 --out openings.json
//     Random opening lines; the first picker's options are each searched with the same budget, so every
//     line says what each of its dominoes is worth as a first pick, in points of expected final lead.
//   node scripts/study.js selfplay --games 600 --sims 2000 --players 2 --out selfplay.json
//     Expert against Expert: who wins from which seat, and what winning kingdoms are made of.
//   node scripts/study.js firstplace --count 1410 --sims 2000 --out firstplace.json
//     The first domino on an empty kingdom (two players): each of the ways to lay it, same budget each.
//   node scripts/study.js placement --games 400 --sims 300 --players 2 --out placement.json
//     Placements from Expert games: every legal placement searched with the same budget, then what its
//     features (points now, holes, compactness...) are worth, and how simple rules of thumb do.
// Each study writes its raw records to --out (JSON) and prints a summary; --summary FILE re-prints one.
// Records are also saved to --out + '.partial' as they come in: after a crash or a stop, the same command
// carries on from there.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DOMINOES, TERRAINS, DIRS, deckSize, lineSize } from '../src/core/rules.js';
import { mulberry32 } from '../src/core/rng.js';
import { Game, INIT, PLACE, DOM, grid } from '../src/core/search/engine.js';
import { Search } from '../src/core/search/mcts.js';
import { gameFrom } from '../src/core/search/state.js';
import { playGame } from './headless.js';

// ---- the work, one unit per deal (in a worker) ----

function shuffled(rnd, n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The opening draft of a fresh game: the first line on the board, nobody on it yet.
function openingGame(seed, n) {
  const rnd = mulberry32(seed), L = lineSize(n);
  const game = new Game(n, 5, false, false);
  const line = shuffled(rnd, 48).slice(0, L).sort((a, b) => a - b);
  for (const d of line) game.seen[d] = 1;
  game.left = deckSize(n, false) - L;
  game.line = Int8Array.from(line);
  game.own = new Int8Array(L).fill(-1);
  // two players draft in snake order (A, B, B, A); more draft one king each in a random order
  game.order = Int8Array.from(n === 2 ? [0, 1, 1, 0] : shuffled(rnd, n));
  game.phase = INIT;
  game.idx = 0;
  return game;
}

function opening({ seed, players, sims }) {
  const game = openingGame(seed, players);
  // sims: 0 skips the tree policy at the root, so each option gets exactly `min` simulations
  const a = new Search({ seed }).analyse(game, { sims: 0, ms: 1e9, min: sims });
  const bySlot = [...a.moves].sort((p, q) => p.move - q.move);
  return { seed, line: [...game.line].map((d) => d + 1), ev: bySlot.map((m) => m.ev), win: bySlot.map((m) => m.win) };
}

function selfplay({ seed, players, sims }) {
  let order = null;
  const picks = [];
  const { players: seats, ranking } = playGame({
    types: Array(players).fill('expert'), seed, budget: { sims, ms: 1e9 },
    onDecision: (table, move) => {
      if (table.phase !== 'open') return;
      order = table.order;
      picks.push({ player: table.order[table.idx], line: table.line, slot: move, domino: table.line[move] });
    },
  });
  const kingdoms = seats.map((p) => {
    const s = p.kingdom.score();
    const terrain = Object.fromEntries(TERRAINS.map((t) => [t, { squares: 0, crowns: 0, points: 0 }]));
    for (const r of s.regions) {
      terrain[r.terrain].squares += r.size;
      terrain[r.terrain].crowns += r.crowns;
      terrain[r.terrain].points += r.score;
    }
    return {
      total: s.total, largest: s.largest, crowns: s.crowns, discards: p.kingdom.discards.length,
      complete: p.kingdom.isComplete(), centered: p.kingdom.isCentered(), terrain,
      place: ranking.find((r) => r.player === p).place,
    };
  });
  return { seed, order, picks, kingdoms };
}

// The first domino of a kingdom goes on an empty board, where symmetry leaves only four distinct ways to
// lay it: straight out from the castle or alongside it, with square A or square B against the castle
// (two ways when both halves are the same). Two players; the domino studied is #(1 + (seed - 1) % 47).
// #48 is left out: it always sits last on its line, so its owner lays their other domino first.
const FIRST = (() => {
  const g = grid(5), E = g.center + 1;
  return [
    { shape: 'out', touch: 0, move: E << 8 | (E + 1) },
    { shape: 'out', touch: 1, move: (E + 1) << 8 | E },
    { shape: 'side', touch: 0, move: E << 8 | (E + g.W) },
    { shape: 'side', touch: 1, move: (E + g.W) << 8 | E },
  ];
})();

function firstplace({ seed, sims }) {
  const rnd = mulberry32(seed), d = (seed - 1) % 47;
  let line;
  do line = [d, ...shuffled(rnd, 48).filter((x) => x !== d).slice(0, 3)];
  while (Math.max(...line) === d);
  line.sort((a, b) => a - b);
  // player 0 holds d and a later slot, so d is the first domino they lay; player 1 holds the other two
  const k = line.indexOf(d), later = [];
  for (let j = k + 1; j < 4; j++) later.push(j);
  const j = later[Math.floor(rnd() * later.length)];
  const next = shuffled(rnd, 48).filter((x) => !line.includes(x)).slice(0, 4).sort((a, b) => a - b);
  const game = new Game(2, 5, false, false);
  for (const x of [...line, ...next]) game.seen[x] = 1;
  game.left = deckSize(2, false) - 8;
  game.line = Int8Array.from(line);
  game.own = Int8Array.from(line.map((_, i) => (i === k || i === j ? 0 : 1)));
  game.nextLine = Int8Array.from(next);
  game.nextOwn = new Int8Array(4).fill(-1);
  game.phase = PLACE;
  game.idx = 0;
  // player 1 lays and picks for any earlier slots
  const search = new Search({ seed });
  while (game.phase !== PLACE || game.idx !== k) game.apply(search.choose(game, { sims: 300, ms: 1e9 }).move);
  const sym = DOM[4 * d] === DOM[4 * d + 2] && DOM[4 * d + 1] === DOM[4 * d + 3];
  const opts = FIRST.filter((o) => !sym || !o.touch);
  game.legal = () => opts.map((o) => o.move); // analyse() takes its root moves from here
  const a = new Search({ seed: seed ^ 0x9e3779b9 }).analyse(game, { sims: 0, ms: 1e9, min: sims });
  return {
    seed, domino: d + 1, slot: k,
    options: opts.map((o) => {
      const m = a.moves.find((x) => x.move === o.move);
      return { shape: o.shape, touch: o.touch, ev: m.ev, win: m.win };
    }),
  };
}

// What a placement does to the kingdom, for the placement study. Within the rectangle the kingdom can
// still grow into: `dead` counts empty squares with no empty neighbour (no domino can ever cover them),
// `open` counts empty squares next to a property that has crowns (room for it to grow).
const CROWNED = new Uint8Array(15 * 15), VISIT = new Uint8Array(15 * 15), QUEUE = new Int16Array(15 * 15);
function room(b) {
  const { W, N, size, step } = b.g, { t, c } = b;
  const x0 = b.x1 - size + 1, x1 = b.x0 + size - 1, y0 = b.y1 - size + 1, y1 = b.y0 + size - 1;
  const inside = (i) => {
    const x = i % W, y = (i / W) | 0;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
  CROWNED.fill(0, 0, N);
  VISIT.fill(0, 0, N);
  for (let i = 0; i < N; i++) {
    if (t[i] < 2 || t[i] > 7 || VISIT[i]) continue;
    let top = 0, len = 0, crowns = 0;
    QUEUE[top++] = i;
    VISIT[i] = 1;
    while (len < top) {
      const j = QUEUE[len++];
      crowns += c[j];
      for (let k = 0; k < 4; k++) {
        const n = j + step[k];
        if (t[n] === t[i] && !VISIT[n]) { VISIT[n] = 1; QUEUE[top++] = n; }
      }
    }
    if (crowns) for (let q = 0; q < top; q++) CROWNED[QUEUE[q]] = 1;
  }
  let dead = 0, open = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (t[i]) continue;
      let free = false, crowned = false;
      for (let k = 0; k < 4; k++) {
        const n = i + step[k];
        if (!t[n] && inside(n)) free = true;
        if (CROWNED[n]) crowned = true;
      }
      if (!free) dead++;
      else if (crowned) open++;
    }
  }
  return { dead, open };
}

export const FEATURES = ['gain', 'match', 'touch', 'grow', 'dead', 'open', 'lone'];
function features(b, d, m) {
  const after = b.clone();
  after.place(m, d);
  const r0 = room(b), r1 = room(after), { step } = b.g;
  let match = 0, touch = 0, lone = 0;
  for (const [cell, other, h] of [[m >> 8, m & 255, 0], [m & 255, m >> 8, 2]]) {
    let own = 0;
    for (let k = 0; k < 4; k++) {
      const n = cell + step[k], tt = b.t[n];
      if (n === other || !tt || tt > 7) continue;
      touch++;
      if (tt === DOM[4 * d + h]) { match++; own++; }
    }
    if (DOM[4 * d + h + 1] && !own) lone++; // a crowned half that starts a new property
  }
  return {
    gain: after.score(false, false) - b.score(false, false), // points the kingdom is worth now, before and after
    match, touch, lone,
    grow: after.x1 - after.x0 + after.y1 - after.y0 - (b.x1 - b.x0 + b.y1 - b.y0), // how far the frame stretches
    dead: r1.dead - r0.dead,
    open: r1.open - r0.open,
  };
}

// Positions from Expert games (moves at 800 simulations), three placements per game; every legal
// placement of each gets the same budget, so their values can be compared with what they do.
function placement({ seed, players, sims }) {
  const seen = [];
  playGame({
    types: Array(players).fill('expert'), seed, budget: { sims: 800, ms: 1e9 },
    onDecision: (table, move) => { if (table.phase === 'place') seen.push({ table: JSON.parse(JSON.stringify(table)), move }); },
  });
  // one placement from each third of the game (a kingdom's dominoes 1-4, 5-8, 9-12)
  const rnd = mulberry32(seed ^ 0x2545f491);
  const pool = seen.map((s) => ({ ...s, game: gameFrom(s.table) })).filter((s) => s.move && s.game.legal(0).length >= 3);
  const stage = (s) => { const b = s.game.boards[s.game.player]; return b.placed + b.discards; };
  const picked = [[0, 4], [4, 8], [8, 12]].map(([lo, hi]) => {
    const band = pool.filter((s) => stage(s) >= lo && stage(s) < hi);
    return band[Math.floor(rnd() * band.length)];
  }).filter(Boolean);
  return {
    seed,
    positions: picked.map(({ table, move, game }) => {
      const b = game.boards[game.player], d = game.line[game.idx], g = b.g;
      const cell = (x, y) => (y + g.size) * g.W + x + g.size, [dx, dy] = DIRS[move.rot];
      const played = cell(move.x, move.y) << 8 | cell(move.x + dx, move.y + dy);
      const a = new Search({ seed: seed ^ 0x9e3779b9 }).analyse(game, { sims: 0, ms: 1e9, min: sims });
      return {
        stage: b.placed + b.discards, domino: d + 1,
        moves: a.moves.map((m) => ({ ev: m.ev, played: m.move === played, ...features(b, d, m.move) })),
      };
    }),
  };
}

const WORK = { openings: opening, selfplay, firstplace, placement };

// ---- the main thread: hand out deals, gather records, summarise ----

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

async function main() {
  const summaryOf = arg('summary', null);
  if (summaryOf) {
    const data = JSON.parse(readFileSync(summaryOf, 'utf8'));
    SUMMARY[data.study](data);
    return;
  }
  const study = process.argv[2];
  if (!WORK[study]) throw new Error('usage: node scripts/study.js openings|selfplay|firstplace|placement [--count N] [--sims N] [--players N] [--threads N] [--out FILE]');
  const DEFAULTS = { openings: [3000, 5000], selfplay: [600, 2000], firstplace: [47 * 30, 2000], placement: [400, 300] };
  const players = study === 'firstplace' ? 2 : +arg('players', 2), sims = +arg('sims', DEFAULTS[study][1]);
  const count = +arg('count', arg('deals', arg('games', DEFAULTS[study][0])));
  const first = +arg('seed', 1), out = arg('out', `${study}-${players}p.json`);
  // a few workers by default: a long study on every core makes a laptop loud and hot
  const threads = Math.min(count, +arg('threads', Math.min(4, availableParallelism())));

  // pick up the records an interrupted run of the same study already saved (a torn last line is dropped)
  const partial = `${out}.partial`, header = JSON.stringify({ study, players, sims });
  const records = [];
  if (existsSync(partial)) {
    const [head, ...lines] = readFileSync(partial, 'utf8').split('\n').filter(Boolean);
    if (head === header) {
      for (const line of lines) {
        try { records.push(JSON.parse(line)); } catch { /* cut off mid-write */ }
      }
    }
  }
  writeFileSync(partial, [header, ...records.map((r) => JSON.stringify(r))].join('\n') + '\n');
  const have = new Set(records.map((r) => r.seed)), todo = [];
  for (let s = first; s < first + count; s++) if (!have.has(s)) todo.push(s);
  if (records.length) process.stderr.write(`carrying on: ${records.length} of ${count} already done\n`);

  let next = 0, done = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: Math.min(threads, todo.length) }, () => new Promise((resolve, reject) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { study, players, sims } });
    const feed = () => w.postMessage(next < todo.length ? todo[next++] : null);
    w.on('message', (rec) => {
      records.push(rec);
      appendFileSync(partial, JSON.stringify(rec) + '\n');
      if (++done % 50 === 0 || done === todo.length) {
        const s = (performance.now() - t0) / 1000;
        process.stderr.write(`${records.length}/${count} in ${s.toFixed(0)} s, ~${((todo.length - done) * s / done).toFixed(0)} s to go\n`);
      }
      feed();
    });
    w.on('error', reject);
    w.on('exit', resolve);
    feed();
  })));
  records.sort((a, b) => a.seed - b.seed);
  const data = { study, players, sims, seconds: (performance.now() - t0) / 1000, records };
  writeFileSync(out, JSON.stringify(data));
  unlinkSync(partial);
  SUMMARY[study](data);
  console.log(`\nraw records in ${out}`);
}

// ---- summaries ----

const label = (id) => DOMINOES[id - 1].squares.map((s) => `${s.terrain}${'*'.repeat(s.crowns)}`).join('+');
const fmt = (x, d = 1) => (x >= 0 ? '+' : '') + x.toFixed(d);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// Solves A x = b (A symmetric positive definite) by Gauss-Jordan; also returns A's inverse.
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => +(i === j)), b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let k = 0; k <= 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c || !M[r][c]) continue;
      const f = M[r][c];
      for (let k = 0; k <= 2 * n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return { x: M.map((row) => row[2 * n]), inv: M.map((row) => row.slice(n, 2 * n)) };
}

// Spearman's rank correlation.
export function spearman(xs, ys) {
  const ranks = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = new Array(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const a = ranks(xs), b = ranks(ys), ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}

// Opening values: within each line, EV(slot) = line effect + value(domino) + cost(slot rank). Solved by
// least squares on the within-line deviations, which cancels the line effect; a whisker of ridge pins
// the free constants, so domino values average zero.
export function openingModel(records) {
  const L = records[0].line.length, P = 48 + L;
  const A = Array.from({ length: P }, () => new Float64Array(P)), b = new Float64Array(P);
  const rows = [];
  for (const r of records) {
    const m = mean(r.ev);
    for (let k = 0; k < L; k++) {
      const x = new Float64Array(P);
      for (let j = 0; j < L; j++) { x[r.line[j] - 1] -= 1 / L; x[48 + j] -= 1 / L; }
      x[r.line[k] - 1] += 1;
      x[48 + k] += 1;
      const y = r.ev[k] - m;
      rows.push([x, y]);
      for (let i = 0; i < P; i++) {
        if (!x[i]) continue;
        b[i] += x[i] * y;
        for (let j = 0; j < P; j++) if (x[j]) A[i][j] += x[i] * x[j];
      }
    }
  }
  for (let i = 0; i < P; i++) A[i][i] += 1e-6;
  const { x: beta, inv } = solve(A.map((r) => [...r]), [...b]);
  let rss = 0;
  for (const [x, y] of rows) {
    let f = 0;
    for (let i = 0; i < P; i++) f += x[i] * beta[i];
    rss += (y - f) ** 2;
  }
  // each line contributes L - 1 independent deviations
  const sigma2 = rss / (records.length * (L - 1) - (48 - 1) - (L - 1));
  // the error of a contrast c'beta (a domino against the average domino, a slot against the first)
  const se = (c) => {
    let v = 0;
    for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) if (c[i] && c[j]) v += c[i] * inv[i][j] * c[j];
    return Math.sqrt(sigma2 * v);
  };
  const contrast = (i, base) => {
    const c = new Float64Array(P);
    if (base === 'mean') for (let j = 0; j < 48; j++) c[j] = -1 / 48;
    else c[base] -= 1;
    c[i] += 1;
    return c;
  };
  const vMean = mean(beta.slice(0, 48)), rank0 = beta[48];
  return {
    value: beta.slice(0, 48).map((v, i) => ({ id: i + 1, value: v - vMean, se: se(contrast(i, 'mean')) })),
    rank: beta.slice(48).map((v, k) => ({ rank: k, cost: v - rank0, se: k ? se(contrast(48 + k, 48)) : 0 })),
    sigma: Math.sqrt(sigma2),
  };
}

// The first domino: each way of laying it, against the average of that domino's ways.
export function firstModel(records) {
  const per = new Map();
  for (const r of records) {
    const m = mean(r.options.map((o) => o.ev));
    if (!per.has(r.domino)) per.set(r.domino, new Map());
    for (const o of r.options) {
      const key = `${o.shape}-${o.touch}`, p = per.get(r.domino);
      if (!p.has(key)) p.set(key, []);
      p.get(key).push(o.ev - m);
    }
  }
  return [...per].sort((a, b) => a[0] - b[0]).map(([id, opts]) => ({
    id,
    options: [...opts].map(([key, xs]) => {
      const mu = mean(xs), sd = Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
      const [shape, touch] = key.split('-');
      return { shape, touch: +touch, value: mu, se: sd / Math.sqrt(xs.length), n: xs.length };
    }),
  }));
}

// Placements: within each position, a placement's value against the position's average, fitted on how
// its features differ from the position's average (least squares, so each feature's points are net of
// the others).
export function placementModel(positions, feats = FEATURES) {
  const P = feats.length, A = Array.from({ length: P }, () => new Float64Array(P)), b = new Float64Array(P);
  const rows = [];
  for (const pos of positions) {
    const mv = mean(pos.moves.map((m) => m.ev)), mf = feats.map((f) => mean(pos.moves.map((m) => m[f])));
    for (const m of pos.moves) {
      const x = feats.map((f, i) => m[f] - mf[i]), y = m.ev - mv;
      rows.push([x, y]);
      for (let i = 0; i < P; i++) {
        b[i] += x[i] * y;
        for (let j = 0; j < P; j++) A[i][j] += x[i] * x[j];
      }
    }
  }
  for (let i = 0; i < P; i++) A[i][i] += 1e-9;
  const { x: beta, inv } = solve(A.map((r) => [...r]), [...b]);
  let rss = 0, tss = 0;
  for (const [x, y] of rows) {
    rss += (y - x.reduce((s, v, i) => s + v * beta[i], 0)) ** 2;
    tss += y * y;
  }
  const sigma2 = rss / (rows.length - positions.length - P);
  return { feats, beta, se: inv.map((r, i) => Math.sqrt(sigma2 * r[i])), r2: 1 - rss / tss, n: rows.length };
}

// Simple rules for choosing a placement, scored on the analysed positions: the average value of the
// placements a rule would choose (ties shared), against the position's average placement.
export const RULES = [
  ['the Expert (as played in the game)', (ms) => ms.filter((m) => m.played)],
  ['most points now', (ms) => best(ms, (m) => m.gain)],
  ['most points now, then touch your own terrain', (ms) => best(best(ms, (m) => m.gain), (m) => m.match)],
  ['most points now, then no hole', (ms) => best(best(ms, (m) => m.gain), (m) => -m.dead)],
  ['no hole, then most points now', (ms) => best(best(ms, (m) => -m.dead), (m) => m.gain)],
  ['no hole, then points, then most room for crowned properties', (ms) => best(best(best(ms, (m) => -m.dead), (m) => m.gain), (m) => m.open)],
  ['touch the most of your own terrain', (ms) => best(ms, (m) => m.match)],
  ['most compact (touch the most squares)', (ms) => best(ms, (m) => m.touch)],
];
function best(ms, f) {
  const top = Math.max(...ms.map(f));
  return ms.filter((m) => f(m) === top);
}
export function ruleScores(positions) {
  return RULES.map(([name, pick]) => {
    const xs = [];
    for (const pos of positions) {
      const chosen = pick(pos.moves);
      if (!chosen.length) continue;
      xs.push(mean(chosen.map((m) => m.ev)) - mean(pos.moves.map((m) => m.ev)));
    }
    const mu = mean(xs), sd = Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
    return { name, value: mu, se: sd / Math.sqrt(xs.length), n: xs.length };
  });
}

export const SUMMARY = {
  firstplace({ sims, seconds, records }) {
    console.log(`\nThe first domino on an empty kingdom, 2 players: ${records.length} positions, ${sims} simulations per way of laying it (${seconds.toFixed(0)} s)`);
    const name = (id, o) => {
      const sq = DOMINOES[id - 1].squares, near = sq[o.touch], far = sq[1 - o.touch];
      const sym = sq[0].terrain === sq[1].terrain && sq[0].crowns === sq[1].crowns;
      return `${o.shape === 'out' ? 'straight out' : 'alongside'}${sym ? '' : `, ${near.terrain}${'*'.repeat(near.crowns)} on the castle`}`;
    };
    const model = firstModel(records);
    let outMinusSide = [], crownNear = [];
    for (const d of model) {
      const sorted = [...d.options].sort((a, b) => b.value - a.value);
      console.log(`  #${String(d.id).padEnd(3)} ${label(d.id).padEnd(18)} best: ${name(d.id, sorted[0]).padEnd(38)} ${sorted.map((o) => `${o.shape}/${o.touch} ${fmt(o.value, 2)}±${o.se.toFixed(2)}`).join('  ')}`);
      const v = (shape, touch) => d.options.find((o) => o.shape === shape && o.touch === touch)?.value;
      const sq = DOMINOES[d.id - 1].squares;
      outMinusSide.push(mean(d.options.filter((o) => o.shape === 'out').map((o) => o.value)) - mean(d.options.filter((o) => o.shape === 'side').map((o) => o.value)));
      if (sq[0].crowns !== sq[1].crowns) {
        const c = sq[0].crowns > sq[1].crowns ? 0 : 1; // the crowned half
        crownNear.push(mean([v('out', c) - v('out', 1 - c), v('side', c) - v('side', 1 - c)]));
      }
    }
    console.log(`\nstraight out minus alongside, averaged over dominoes: ${fmt(mean(outMinusSide), 2)} points`);
    console.log(`crowned half against the castle minus away from it (dominoes with one crowned half): ${fmt(mean(crownNear), 2)} points`);
  },

  placement({ players, sims, seconds, records }) {
    const positions = records.flatMap((r) => r.positions);
    console.log(`\nPlacements in Expert games, ${players} players: ${positions.length} positions, ${positions.reduce((s, p) => s + p.moves.length, 0)} placements, ${sims} simulations each (${seconds.toFixed(0)} s)`);
    const NAMES = {
      gain: 'points now (per point)', match: 'touching own terrain (per side)', touch: 'touching any square (per side)',
      grow: 'stretching the frame (per square)', dead: 'holes left (per hole)', open: 'room next to crowned properties (per square)',
      lone: 'crowned half starting a new property',
    };
    for (const [title, keep] of [['all stages', () => true], ['dominoes 1-4', (p) => p.stage < 4], ['dominoes 5-8', (p) => p.stage >= 4 && p.stage < 8], ['dominoes 9-12', (p) => p.stage >= 8]]) {
      const ps = positions.filter(keep), m = placementModel(ps);
      console.log(`\nwhat a placement feature is worth, ${title} (${ps.length} positions, R² ${m.r2.toFixed(2)}):`);
      m.feats.forEach((f, i) => console.log(`  ${NAMES[f].padEnd(46)} ${fmt(m.beta[i], 2)} ± ${m.se[i].toFixed(2)}`));
    }
    console.log('\nrules of thumb, points of final lead against an average legal placement:');
    for (const r of ruleScores(positions)) console.log(`  ${r.name.padEnd(62)} ${fmt(r.value, 2)} ± ${r.se.toFixed(2)}`);
  },

  openings({ players, sims, seconds, records }) {
    const L = records[0].line.length;
    console.log(`\nOpening first picks, ${players} players: ${records.length} random lines, ${sims} simulations per option (${seconds.toFixed(0)} s)`);
    const best = records.map((r) => Math.max(...r.ev));
    console.log(`first picker's expected lead with their best pick: ${fmt(mean(best), 2)} points, win rate ${(100 * mean(records.map((r) => Math.max(...r.win)))).toFixed(1)}%`);

    // raw per-domino tallies: how its pick compares with the line's best and average
    const per = Array.from({ length: 48 }, () => ({ n: 0, best: 0, regret: 0, rel: 0 }));
    for (const r of records) {
      const top = Math.max(...r.ev), m = mean(r.ev);
      r.line.forEach((id, k) => {
        const p = per[id - 1];
        p.n++;
        p.regret += top - r.ev[k];
        p.rel += r.ev[k] - m;
        if (r.ev[k] === top) p.best++;
      });
    }
    const model = openingModel(records);
    console.log('\ncost of the slot (in line order, lowest number first), relative to the first slot:');
    console.log(model.rank.map((r) => `  slot ${r.rank + 1}: ${fmt(r.cost, 2)} ± ${r.se.toFixed(2)}`).join('\n'));
    console.log(`\ndomino values as a first pick (points of final lead vs the average domino, slot cost removed; noise ${model.sigma.toFixed(2)} per option):`);
    console.log('  rank  domino  squares                  value    ±se   | best pick when dealt  regret  n');
    const rows = model.value.map((v) => ({ ...v, ...per[v.id - 1] })).sort((p, q) => q.value - p.value);
    rows.forEach((r, i) => {
      console.log(`  ${String(i + 1).padStart(4)}  #${String(r.id).padEnd(5)} ${label(r.id).padEnd(24)} ${fmt(r.value, 2).padStart(6)}  ${r.se.toFixed(2)}  | ${(100 * r.best / r.n).toFixed(0).padStart(3)}%               ${(r.regret / r.n).toFixed(2).padStart(5)}  ${r.n}`);
    });
    console.log(`\nSpearman correlation between domino number and value: ${spearman(rows.map((r) => r.id), rows.map((r) => r.value)).toFixed(3)}`);
    // how often the highest-numbered domino of the line is the best first pick
    const hi = records.filter((r) => r.ev[L - 1] === Math.max(...r.ev)).length;
    console.log(`the line's highest number is the best first pick in ${(100 * hi / records.length).toFixed(1)}% of lines; taking it always gives up ${mean(records.map((r) => Math.max(...r.ev) - r.ev[L - 1])).toFixed(2)} points on average`);
  },

  selfplay({ players, sims, seconds, records }) {
    console.log(`\nExpert against Expert, ${players} players: ${records.length} games, ${sims} simulations per move (${seconds.toFixed(0)} s)`);
    // seat = position in the opening draft (the first king to pick)
    const firstPos = (r, p) => r.order.indexOf(p);
    const bySeat = Array.from({ length: players }, () => ({ win: 0, games: 0, total: 0, margin: 0 }));
    for (const r of records) {
      r.kingdoms.forEach((k, p) => {
        const s = bySeat[firstPos(r, p)];
        const winners = r.kingdoms.filter((q) => q.place === 1).length;
        s.games++;
        s.win += k.place === 1 ? 1 / winners : 0;
        s.total += k.total;
        s.margin += k.total - Math.max(...r.kingdoms.filter((q) => q !== k).map((q) => q.total));
      });
    }
    console.log('\nby first pick in the opening draft:');
    bySeat.forEach((s, i) => {
      const w = s.win / s.games, se = Math.sqrt(w * (1 - w) / s.games);
      console.log(`  picks ${['1st', '2nd', '3rd', '4th'][i]}: wins ${(100 * w).toFixed(1)}% ± ${(100 * se).toFixed(1)}, average ${(s.total / s.games).toFixed(1)} points, lead ${fmt(s.margin / s.games)}`);
    });

    const all = records.flatMap((r) => r.kingdoms), winners = all.filter((k) => k.place === 1), losers = all.filter((k) => k.place > 1);
    const share = (ks, f) => `${(100 * ks.filter(f).length / ks.length).toFixed(0)}%`;
    const avg = (ks, f) => mean(ks.map(f)).toFixed(1);
    console.log('\nkingdoms                     all   winners  others');
    for (const [name, f, kind] of [
      ['points', (k) => k.total], ['crowns', (k) => k.crowns], ['largest property', (k) => k.largest],
      ['discarded dominoes', (k) => k.discards], ['full 5×5 (no discards)', (k) => k.complete, 'share'],
      ['castle in the centre', (k) => k.centered, 'share'],
    ]) {
      const g = kind === 'share' ? share : avg;
      console.log(`  ${name.padEnd(26)} ${g(all, f).padStart(5)}  ${g(winners, f).padStart(7)}  ${g(losers, f).padStart(6)}`);
    }

    console.log('\nterrain                 squares  crowns  points  (per kingdom)  points per square  winners\' points');
    for (const t of TERRAINS) {
      const sq = mean(all.map((k) => k.terrain[t].squares)), cr = mean(all.map((k) => k.terrain[t].crowns));
      const pt = mean(all.map((k) => k.terrain[t].points)), wpt = mean(winners.map((k) => k.terrain[t].points));
      console.log(`  ${t.padEnd(20)} ${sq.toFixed(1).padStart(7)} ${cr.toFixed(2).padStart(7)} ${pt.toFixed(1).padStart(7)}                ${(pt / sq).toFixed(2).padStart(6)}             ${wpt.toFixed(1)}`);
    }
    // the property a kingdom earns most from
    const top = Object.fromEntries(TERRAINS.map((t) => [t, 0]));
    for (const k of all) top[TERRAINS.reduce((a, t) => (k.terrain[t].points > k.terrain[a].points ? t : a))]++;
    console.log(`\nbiggest earner per kingdom: ${TERRAINS.map((t) => `${t} ${(100 * top[t] / all.length).toFixed(0)}%`).join(', ')}`);

    // what the Expert takes first when it can
    const first = Array.from({ length: 48 }, () => ({ offered: 0, taken: 0 }));
    for (const r of records) {
      const p0 = r.picks[0];
      for (const id of p0.line) first[id - 1].offered++;
      first[p0.domino - 1].taken++;
    }
    const favourites = first.map((f, i) => ({ id: i + 1, ...f })).filter((f) => f.offered >= 5).sort((a, b) => b.taken / b.offered - a.taken / a.offered).slice(0, 10);
    console.log(`\nthe Expert's favourite first picks (taken / offered): ${favourites.map((f) => `#${f.id} ${f.taken}/${f.offered}`).join(', ')}`);
  },
};

if (!isMainThread) {
  const { study, players, sims } = workerData;
  parentPort.on('message', (seed) => {
    if (seed === null) process.exit(0);
    parentPort.postMessage(WORK[study]({ seed, players, sims }));
  });
} else if (resolve(process.argv[1] || '').toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) main();
