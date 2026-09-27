// The expert AI: determinized open-loop Monte-Carlo tree search, ported from the Python solver
// experiments (where it beat an exact-score greedy bot 15–1). Each simulation deals the unseen chest
// afresh, walks the tree by move sequence, so its statistics average over deals while everything already
// on the table is searched exactly, then plays the game to the end with a quick epsilon-greedy heuristic.
import { INIT, PLACE, DONE, DISCARD } from './engine.js';
import { mulberry32 } from '../rng.js';

const BUF = new Int32Array(1024);

class Node {
  constructor() {
    this.n = 0; // visits
    this.w = 0; // summed value for the player who moved into this node
    this.kids = new Map();
    this.acts = null; // legal moves, cached while no new tile has been revealed
  }
}

// A finished game's value to each player, in [0, 1]: mostly win / draw / loss, and a little for the
// margin over the best opponent so playouts still prefer bigger wins.
export function outcome(g) {
  const s = g.scores(), v = new Array(g.n);
  for (let p = 0; p < g.n; p++) {
    let best = -Infinity;
    for (let q = 0; q < g.n; q++) if (q !== p && s[q] > best) best = s[q];
    const m = s[p] - best;
    v[p] = 0.7 * (m > 0 ? 1 : m === 0 ? 0.5 : 0) + 0.3 * (0.5 + 0.5 * Math.max(-1, Math.min(1, m / 25)));
  }
  return v;
}

export class Search {
  // c: UCT exploration; cap / rootCap: placements kept (best by heuristic) inside the tree / at its root;
  // eps: playout randomness; sample: placements a playout compares before picking one.
  constructor({ c = 1, cap = 20, rootCap = 48, eps = 0.2, sample = 10, seed = (Math.random() * 2 ** 32) >>> 0 } = {}) {
    Object.assign(this, { c, cap, rootCap, eps, sample });
    this.rnd = mulberry32(seed);
    this.carry = null; // { key, node }: the subtree under the placement just played
  }

  // Searches until `sims` simulations or `ms` milliseconds, then plays the most visited move.
  choose(game, { sims = 2000, ms = 1500 } = {}) {
    const acts = game.legal(this.rootCap, BUF);
    const carry = this.carry;
    this.carry = null;
    if (acts.length === 1) return { move: acts[0], sims: 0 };
    // Placing reveals nothing, so the tree grown for the placement is a head start for the pick after it.
    let root = carry && carry.key === game.key() ? carry.node : null;
    if (!root) { root = new Node(); root.acts = acts; }
    const end = performance.now() + ms;
    let n = 0;
    while (n < sims && ((n & 15) || performance.now() < end)) {
      const st = game.clone();
      st.determinize(this.rnd);
      this.simulate(st, root);
      n++;
    }
    let best = acts[0], bn = -1, bw = 0;
    for (const a of acts) {
      const k = root.kids.get(a);
      if (!k) continue;
      if (k.n > bn || (k.n === bn && k.w / k.n > bw)) { best = a; bn = k.n; bw = k.w / k.n; }
    }
    if (game.phase === PLACE && game.nextLine && root.kids.has(best)) {
      const after = game.clone();
      after.apply(best);
      this.carry = { key: after.key(), node: root.kids.get(best) };
    }
    return { move: best, sims: n };
  }

  simulate(st, root) {
    let node = root, depth = 0, fixed = true; // fixed: no tile revealed yet, every deal agrees on the state
    const path = [], actors = [];
    while (st.phase !== DONE) {
      const actor = st.player;
      let acts = fixed ? node.acts : null;
      if (!acts) {
        acts = st.legal(depth ? this.cap : this.rootCap, BUF);
        if (fixed) node.acts = acts;
      }
      const fresh = this.untried(st, acts, node.kids);
      if (fresh !== null) {
        const kid = new Node();
        node.kids.set(fresh, kid);
        st.apply(fresh);
        path.push(kid);
        actors.push(actor);
        break;
      }
      const logn = Math.log(node.n + 1);
      let best = acts[0], bu = -Infinity;
      for (const a of acts) {
        const k = node.kids.get(a);
        const u = k.w / k.n + this.c * Math.sqrt(logn / k.n);
        if (u > bu) { bu = u; best = a; }
      }
      const r0 = st.reveals;
      st.apply(best);
      if (st.reveals !== r0) fixed = false;
      node = node.kids.get(best);
      path.push(node);
      actors.push(actor);
      depth++;
    }
    const v = this.playout(st);
    root.n++;
    for (let i = 0; i < path.length; i++) {
      path[i].n++;
      path[i].w += v[actors[i]];
    }
  }

  // The heuristically best move not yet in the tree (null when all are), expanded first.
  untried(st, acts, kids) {
    const b = st.boards[st.player];
    const place = st.phase === PLACE, d = place ? st.line[st.idx] : 0;
    const line = st.phase === INIT ? st.line : st.nextLine;
    let best = null, bv = -Infinity;
    for (const a of acts) {
      if (kids.has(a)) continue;
      const v = (place ? (a === DISCARD ? 0 : b.quickEval(a, d)) : b.pickEval(line[a]) - 0.05 * a) + 0.01 * this.rnd();
      if (v > bv) { bv = v; best = a; }
    }
    return best;
  }

  // Plays to the end: mostly the heuristically best of a few sampled placements and the most
  // promising free domino, with a random move now and then.
  playout(st) {
    const rnd = this.rnd, eps = this.eps;
    while (st.phase !== DONE) {
      const b = st.boards[st.player];
      if (st.phase === PLACE) {
        const d = st.line[st.idx];
        let n = b.placements(d, BUF), m = DISCARD;
        if (n === 1) m = BUF[0];
        else if (n > 1 && rnd() < eps) m = BUF[(rnd() * n) | 0];
        else if (n > 1) {
          if (n > this.sample) {
            for (let i = 0; i < this.sample; i++) {
              const j = i + ((rnd() * (n - i)) | 0), x = BUF[i];
              BUF[i] = BUF[j];
              BUF[j] = x;
            }
            n = this.sample;
          }
          let bv = -Infinity;
          for (let i = 0; i < n; i++) {
            const v = b.quickEval(BUF[i], d);
            if (v > bv) { bv = v; m = BUF[i]; }
          }
        }
        st.apply(m);
      } else {
        const init = st.phase === INIT, line = init ? st.line : st.nextLine, own = init ? st.own : st.nextOwn;
        let free = 0, m = -1, bv = -Infinity;
        for (let i = 0; i < st.L; i++) if (own[i] < 0) BUF[free++] = i;
        if (free === 1) m = BUF[0];
        else if (rnd() < eps) m = BUF[(rnd() * free) | 0];
        else {
          for (let i = 0; i < free; i++) {
            const v = b.pickEval(line[BUF[i]]) - 0.05 * BUF[i];
            if (v > bv) { bv = v; m = BUF[i]; }
          }
        }
        st.apply(m);
      }
    }
    return outcome(st);
  }
}
