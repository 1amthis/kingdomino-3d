// The graph models of the placement study (benchmarks/graph-study-2026-10-23), on the search engine's boards.
// Board cells live on an 11×11 grid (castle at the centre, a wall ring outside), terrain codes 2–7.
import { Board, DOM, grid, DISCARD } from '../../src/core/search/engine.js';
import { mulberry32 } from '../../src/core/rng.js';
export { Board, DOM, grid, DISCARD, mulberry32 };

export const G = grid(5);
const { W, N, step, col, row, transforms } = G;

export function shuffled(rnd, n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const score = (b) => b.score(false, false);
export function child(b, m, d) {
  const c = b.clone();
  if (m === DISCARD) c.discards++; else c.place(m, d);
  return c;
}

// ---- Model 1: connected components of the terrain subgraphs ----
// For each component: terrain, size, crowns, and whether it can still grow (an empty neighbour inside
// the rectangle the kingdom may still occupy). Adding squares only ever merges components.
const SEEN = new Int32Array(N), STK = new Int16Array(N);
let stamp = 0;
export function components(b) {
  stamp++;
  const { t, c } = b, out = [];
  const ax0 = b.x1 - 4, ax1 = b.x0 + 4, ay0 = b.y1 - 4, ay1 = b.y0 + 4;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * W + x, tt = t[i];
      if (tt <= 1 || tt === 8 || SEEN[i] === stamp) continue;
      let top = 0, size = 0, crowns = 0, open = 0;
      STK[top++] = i; SEEN[i] = stamp;
      while (top) {
        const j = STK[--top];
        size++; crowns += c[j];
        for (let k = 0; k < 4; k++) {
          const nb = j + step[k], nt = t[nb];
          if (nt === tt) { if (SEEN[nb] !== stamp) { SEEN[nb] = stamp; STK[top++] = nb; } }
          else if (nt === 0 && col[nb] >= ax0 && col[nb] <= ax1 && row[nb] >= ay0 && row[nb] <= ay1) open++;
        }
      }
      out.push({ terrain: tt, size, crowns, open });
    }
  }
  return out;
}

// Admissible bound on the final score: a closed component keeps its points; every open component of a
// terrain and every square of that terrain still to come may at best end up in one single property.
const OS = new Int32Array(8), OC = new Int32Array(8);
export function upperBound(b, remCells, remCrowns) {
  OS.fill(0); OC.fill(0);
  let ub = 0;
  for (const k of components(b)) {
    if (k.open) { OS[k.terrain] += k.size; OC[k.terrain] += k.crowns; } else ub += k.size * k.crowns;
  }
  for (let tt = 2; tt < 8; tt++) ub += (OS[tt] + remCells[tt]) * (OC[tt] + remCrowns[tt]);
  return ub;
}

// Tighter bound from the graph of free "pockets" (connected regions of free cells inside the allowed
// rectangle). Two components of a terrain can only ever merge through new squares laid in a pocket they
// both touch, so per terrain the components fall into groups that can never join. With S, K a group's
// squares and crowns and r, c the squares and crowns it receives, its final points are at most
// (S + r)(K + c) = SK + Sc + Kr + rc; each sum is bounded on its own, r by the pockets' free cells.
const POCKET = new Int16Array(N), PSIZE = new Int16Array(N), UF = new Int16Array(N);
const find = (p) => { while (UF[p] !== p) p = UF[p] = UF[UF[p]]; return p; };
export function upperBoundPockets(b, remCells, remCrowns) {
  const { t, c } = b;
  const ax0 = b.x1 - 4, ax1 = b.x0 + 4, ay0 = b.y1 - 4, ay1 = b.y0 + 4;
  const inRect = (i) => col[i] >= ax0 && col[i] <= ax1 && row[i] >= ay0 && row[i] <= ay1;
  // label pockets
  stamp++;
  let np = 0;
  for (let y = ay0; y <= ay1; y++) {
    for (let x = ax0; x <= ax1; x++) {
      const i = y * W + x;
      if (t[i] || SEEN[i] === stamp) continue;
      let top = 0, size = 0;
      STK[top++] = i; SEEN[i] = stamp;
      while (top) {
        const j = STK[--top];
        POCKET[j] = np; size++;
        for (let k = 0; k < 4; k++) {
          const nb = j + step[k];
          if (!t[nb] && SEEN[nb] !== stamp && inRect(nb)) { SEEN[nb] = stamp; STK[top++] = nb; }
        }
      }
      PSIZE[np++] = size;
    }
  }
  let maxPocket = 0;
  for (let p = 0; p < np; p++) if (PSIZE[p] > maxPocket) maxPocket = PSIZE[p];
  // components, each with the pockets it touches
  stamp++;
  const comps = [];
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * W + x, tt = t[i];
      if (tt <= 1 || tt === 8 || SEEN[i] === stamp) continue;
      let top = 0, size = 0, crowns = 0;
      const pk = [];
      STK[top++] = i; SEEN[i] = stamp;
      while (top) {
        const j = STK[--top];
        size++; crowns += c[j];
        for (let k = 0; k < 4; k++) {
          const nb = j + step[k], nt = t[nb];
          if (nt === tt) { if (SEEN[nb] !== stamp) { SEEN[nb] = stamp; STK[top++] = nb; } }
          else if (nt === 0 && inRect(nb)) { const p = POCKET[nb]; if (!pk.includes(p)) pk.push(p); }
        }
      }
      comps.push({ terrain: tt, size, crowns, pk });
    }
  }
  let ub = 0;
  for (let tt = 2; tt < 8; tt++) {
    const R = remCells[tt], RC = remCrowns[tt];
    for (let p = 0; p < np; p++) UF[p] = p;
    const mine = comps.filter((k) => k.terrain === tt);
    for (const k of mine) {
      if (!k.pk.length) { ub += k.size * k.crowns; continue; }
      for (let q = 1; q < k.pk.length; q++) UF[find(k.pk[q])] = find(k.pk[0]);
    }
    if (!R && !RC) { // nothing more of this terrain: groups keep what they have, merged at best
      const S = new Map();
      for (const k of mine) if (k.pk.length) { const g = find(k.pk[0]); const e = S.get(g) || [0, 0]; e[0] += k.size; e[1] += k.crowns; S.set(g, e); }
      for (const [s, kk] of S.values()) ub += s * kk;
      continue;
    }
    const groups = new Map(); // root -> [S, K, cap]
    for (const k of mine) {
      if (!k.pk.length) continue;
      const g = find(k.pk[0]);
      const e = groups.get(g) || [0, 0, 0];
      e[0] += k.size; e[1] += k.crowns;
      groups.set(g, e);
    }
    for (let p = 0; p < np; p++) { const e = groups.get(find(p)); if (e) e[2] += PSIZE[p]; }
    let sk = 0, maxS = 0;
    const byK = [];
    for (const [S, K, cap] of groups.values()) {
      sk += S * K;
      if (cap > 0 && S > maxS) maxS = S;
      byK.push([K, cap]);
    }
    byK.sort((p, q) => q[0] - p[0]);
    let left = R, kr = 0;
    for (const [K, cap] of byK) { const r = Math.min(left, cap); kr += K * r; left -= r; if (!left) break; }
    ub += sk + RC * maxS + kr + Math.min(R, maxPocket) * RC;
  }
  return ub;
}

// ---- Model 2: dominoes as edges, a full kingdom as a perfect matching ----
// Maximum matching (Kuhn) of the free cells of one 5×5 window; cells of even parity on the left.
const MATCH = new Int16Array(N), VIS = new Int32Array(N), INWIN = new Int32Array(N);
let vstamp = 0, wstamp = 0;
function augment(u, t) {
  for (let k = 0; k < 4; k++) {
    const v = u + step[k];
    if (INWIN[v] !== wstamp || t[v] || VIS[v] === vstamp) continue;
    VIS[v] = vstamp;
    if (MATCH[v] < 0 || augment(MATCH[v], t)) { MATCH[v] = u; return true; }
  }
  return false;
}
function windowMatching(b, wx, wy) {
  wstamp++;
  const t = b.t, left = [];
  for (let y = wy; y < wy + 5; y++) {
    for (let x = wx; x < wx + 5; x++) {
      const i = y * W + x;
      INWIN[i] = wstamp;
      MATCH[i] = -1;
      if (!t[i] && ((x + y) & 1) === 0) left.push(i);
    }
  }
  let m = 0;
  for (const u of left) { vstamp++; if (augment(u, t)) m++; }
  return m;
}
// Over every 5×5 window the kingdom can still end in: the fewest squares that can never be covered,
// whatever dominoes come (a lower bound on waste, exact for the shape alone), and whether a full
// 5×5 (Harmony) is still geometrically possible.
export function deficiency(b) {
  let occupied = 0;
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (b.t[y * W + x]) occupied++;
  let best = -1;
  for (let wy = b.y1 - 4; wy <= b.y0; wy++) {
    for (let wx = b.x1 - 4; wx <= b.x0; wx++) {
      const m = windowMatching(b, wx, wy);
      if (m > best) best = m;
    }
  }
  const free = 25 - occupied;
  return { wasted: free - 2 * best, free, matching: best };
}

// ---- Canonical position keys: Zobrist hashing up to the 8 symmetries about the castle ----
const ZR = mulberry32(12345);
const Z1 = new Uint32Array(N * 32).map(() => (ZR() * 2 ** 32) >>> 0);
const Z2 = new Uint32Array(N * 32).map(() => (ZR() * 2 ** 32) >>> 0);
export function canonKey(b, useSym = true) {
  const { t, c } = b;
  let b1 = 0xffffffff, b2 = 0xffffffff;
  for (let k = 0; k < (useSym ? 8 : 1); k++) {
    const map = transforms[k];
    let h1 = 0, h2 = 0;
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const i = y * W + x, tt = t[i];
        if (tt < 2) continue;
        const z = map[i] * 32 + tt * 4 + c[i];
        h1 ^= Z1[z]; h2 ^= Z2[z];
      }
    }
    h1 >>>= 0; h2 >>>= 0;
    if (h1 < b1 || (h1 === b1 && h2 < b2)) { b1 = h1; b2 = h2; }
  }
  return b1 * 2097152 + (b2 >>> 11);
}

// Terrain squares and crowns still to come, from each step of a sequence.
export function suffixStats(seq) {
  const L = seq.length;
  const cells = Array.from({ length: L + 1 }, () => new Int32Array(8));
  const crowns = Array.from({ length: L + 1 }, () => new Int32Array(8));
  for (let s = L - 1; s >= 0; s--) {
    cells[s].set(cells[s + 1]); crowns[s].set(crowns[s + 1]);
    const d = seq[s];
    cells[s][DOM[4 * d]]++; crowns[s][DOM[4 * d]] += DOM[4 * d + 1];
    cells[s][DOM[4 * d + 2]]++; crowns[s][DOM[4 * d + 2]] += DOM[4 * d + 3];
  }
  return { cells, crowns };
}

// ---- Model 3: the state graph, solved exactly ----
// Depth-first branch and bound over the DAG of positions (one level per domino of a known sequence),
// with a transposition table keyed by canonical position: the longest path to a leaf is the optimum.
export function solveOffline(seq, { timeMs = 60000, start = null, incumbent = -1, useTT = true, useSym = true, useBound = true, orderBy = 'quick', bound = 'pockets' } = {}) {
  const UB = bound === 'pockets' ? upperBoundPockets : upperBound;
  const L = seq.length, { cells, crowns } = suffixStats(seq);
  const TT = Array.from({ length: L + 1 }, () => new Map());
  const bufs = Array.from({ length: L }, () => new Int32Array(512));
  const path = new Int32Array(L), bestPath = new Int32Array(L).fill(DISCARD);
  let inc = incumbent, nodes = 0, ttHits = 0, pruned = 0, aborted = false, found = false;
  const t0 = performance.now();
  function dfs(b, s) {
    nodes++;
    if (s === L) {
      const v = score(b);
      if (v > inc) { inc = v; found = true; bestPath.set(path); }
      return v;
    }
    if ((nodes & 2047) === 0 && performance.now() - t0 > timeMs) aborted = true;
    if (aborted) return Infinity;
    if (useBound) {
      const ub = UB(b, cells[s], crowns[s]);
      if (ub <= inc) { pruned++; return ub; }
    }
    let key = 0, map = null;
    if (useTT) {
      key = canonKey(b, useSym); map = TT[s];
      const e = map.get(key);
      if (e !== undefined) {
        const v = e >> 1;
        if (e & 1 || v <= inc) { ttHits++; return v; }
      }
    }
    const incEntry = inc, d = seq[s], buf = bufs[s];
    const n = b.placements(d, buf);
    let best = -Infinity;
    if (!n) {
      path[s] = DISCARD;
      best = dfs(child(b, DISCARD, d), s + 1);
    } else {
      const order = Array.from({ length: n }, (_, i) => i);
      if (orderBy === 'ub') {
        // children best bound first; a child already beaten by the incumbent is not even entered
        const kids = order.map((i) => child(b, buf[i], d));
        const ub = kids.map((c) => UB(c, cells[s + 1], crowns[s + 1]));
        const ev = order.map((i) => b.quickEval(buf[i], d));
        order.sort((p, q) => ub[q] - ub[p] || ev[q] - ev[p]);
        for (const i of order) {
          if (ub[i] <= inc) { pruned++; if (ub[i] > best) best = ub[i]; continue; }
          path[s] = buf[i];
          const v = dfs(kids[i], s + 1);
          if (v > best) best = v;
          if (aborted) break;
        }
      } else {
        const ev = order.map((i) => b.quickEval(buf[i], d));
        order.sort((p, q) => ev[q] - ev[p]);
        for (const i of order) {
          const m = buf[i];
          path[s] = m;
          const v = dfs(child(b, m, d), s + 1);
          if (v > best) best = v;
          if (aborted) break;
        }
      }
    }
    if (useTT && !aborted) map.set(key, best > incEntry ? best * 2 + 1 : best * 2);
    return best;
  }
  const root = start ? start.clone() : new Board(5);
  const v = dfs(root, 0);
  const ms = performance.now() - t0;
  const ttSize = TT.reduce((n, m) => n + m.size, 0);
  // Not aborted: the optimum is the root's exact value, or the incumbent we started from when nothing beat it.
  const optimum = aborted ? null : Math.max(v, inc);
  return { optimum, best: inc, found, aborted, nodes, ttHits, pruned, ttSize, ms, path: found ? Array.from(bestPath) : null };
}

// Beam search over the same state graph: keep the `width` best distinct positions at each level.
export function beamSearch(seq, width, evalFn = (b) => score(b)) {
  let layer = [new Board(5)];
  const buf = new Int32Array(512);
  for (let s = 0; s < seq.length; s++) {
    const d = seq[s], seen = new Map();
    for (const b of layer) {
      const n = b.placements(d, buf);
      if (!n) { const c = child(b, DISCARD, d); seen.set(canonKey(c), c); continue; }
      for (let i = 0; i < n; i++) {
        const c = child(b, buf[i], d), k = canonKey(c);
        if (!seen.has(k)) seen.set(k, c);
      }
    }
    const next = [...seen.values()].map((b) => [b, evalFn(b, s + 1)]);
    next.sort((p, q) => q[1] - p[1]);
    layer = next.slice(0, width).map((p) => p[0]);
  }
  return Math.max(...layer.map(score));
}

// ---- Online placement policies (the solo game: each domino is seen only when it must be laid) ----
// policy(b, d, moves, n, ctx) returns one of moves[0..n).
export function playOnline(seq, policy, ctx = {}) {
  let b = new Board(5);
  const buf = new Int32Array(512);
  for (let s = 0; s < seq.length; s++) {
    const d = seq[s], n = b.placements(d, buf);
    if (!n) { b.discards++; continue; }
    const m = n === 1 ? buf[0] : policy(b, d, buf, n, { ...ctx, s, seq });
    b.place(m, d);
  }
  return { score: score(b), discards: b.discards, complete: b.placed === 12, board: b };
}

export const randomPolicy = (b, d, buf, n, { rnd }) => buf[(rnd() * n) | 0];

// Best immediate points, ties broken by the repo's playout heuristic.
export function greedyPolicy(b, d, buf, n) {
  let best = buf[0], bv = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = score(child(b, buf[i], d)) + 0.001 * b.quickEval(buf[i], d);
    if (v > bv) { bv = v; best = buf[i]; }
  }
  return best;
}

// The repo's playout heuristic alone (engine.js quickEval).
export function quickPolicy(b, d, buf, n) {
  let best = buf[0], bv = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = b.quickEval(buf[i], d);
    if (v > bv) { bv = v; best = buf[i]; }
  }
  return best;
}

// A graph evaluation of a position: points now, the growth potential of open crowned components,
// and a penalty per square the matching proves can never be covered.
const DENSITY = [0, 0, 0.19, 0.27, 0.33, 0.43, 0.6, 1];
export function graphEval(b, { wWaste = 4.5, wOpen = 0.3, wPot = 0.18 } = {}) {
  let v = 0;
  for (const k of components(b)) {
    v += k.size * k.crowns;
    if (k.open) v += wOpen * k.crowns * Math.min(k.open, 5) + wPot * k.size * DENSITY[k.terrain] * Math.min(k.open, 3);
  }
  return v - wWaste * deficiency(b).wasted;
}
export function evalPolicy(evalFn) {
  return (b, d, buf, n) => {
    let best = buf[0], bv = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = evalFn(child(b, buf[i], d)) + 0.001 * b.quickEval(buf[i], d);
      if (v > bv) { bv = v; best = buf[i]; }
    }
    return best;
  };
}

// Flat Monte Carlo (Monte Carlo Evaluation): every distinct placement is played out `rollouts` times,
// the unseen dominoes dealt afresh each time and laid by the greedy playout; the best average wins.
export function mcePolicy(rollouts, playout = 'quick') {
  const pbuf = new Int32Array(512);
  return (b, d, buf, n, { rnd, s, seq }) => {
    const seen = new Uint8Array(48);
    for (let i = 0; i <= s; i++) seen[seq[i]] = 1;
    const pool = [];
    for (let x = 0; x < 48; x++) if (!seen[x]) pool.push(x);
    const left = seq.length - 1 - s;
    const groups = b.placementGroups(Array.from(buf.subarray(0, n)), d);
    let best = buf[0], bv = -Infinity;
    for (const rep of groups.keys()) {
      const after = child(b, rep, d);
      let sum = 0;
      for (let r = 0; r < rollouts; r++) {
        // a fresh deal of the unseen dominoes (partial Fisher–Yates)
        for (let i = 0; i < left; i++) {
          const j = i + ((rnd() * (pool.length - i)) | 0);
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const st = after.clone();
        for (let i = 0; i < left; i++) {
          const dd = pool[i], m = st.placements(dd, pbuf);
          if (!m) { st.discards++; continue; }
          st.place(m === 1 ? pbuf[0] : (playout === 'greedy' ? greedyPolicy : quickPolicy)(st, dd, pbuf, m), dd);
        }
        sum += score(st);
      }
      if (sum / rollouts > bv) { bv = sum / rollouts; best = rep; }
    }
    return best;
  };
}
