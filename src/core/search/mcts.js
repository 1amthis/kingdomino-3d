// The expert AI: determinized open-loop Monte-Carlo tree search, ported from the Python solver
// experiments (where it beat an exact-score greedy bot 15–1). Each simulation deals the unseen chest
// afresh, walks the tree by move sequence, so its statistics average over deals while everything already
// on the table is searched exactly, then plays the game to the end with a quick epsilon-greedy heuristic.
// The same search, run with analyse(), is the coach: it reports what every move is worth.
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

// Each player's margin over their best opponent, from the final scores.
function margins(s) {
  return s.map((x, p) => x - Math.max(...s.filter((_, q) => q !== p)));
}

// A finished game's value to each player, in [0, 1]: mostly win / draw / loss, and a little for the
// margin over the best opponent so playouts still prefer bigger wins.
const value = (m) => 0.7 * (m > 0 ? 1 : m === 0 ? 0.5 : 0) + 0.3 * (0.5 + 0.5 * Math.max(-1, Math.min(1, m / 25)));

// The most promising spot from a { move: [simulations, summed value] } histogram of where a drafted domino
// was laid: the best average, less a little for thin evidence, so a lucky spot seen twice cannot beat a
// solid one seen two hundred times. Null when the data is too thin.
function landing(hist) {
  let total = 0;
  for (const [n] of hist.values()) total += n;
  const least = Math.max(3, total / 50);
  let best = null, bs = -Infinity;
  for (const [m, [n, w]] of hist) {
    if (n < least) continue;
    const s = w / n - 0.3 / Math.sqrt(n);
    if (s > bs) { bs = s; best = m; }
  }
  return best;
}

export class Search {
  // c: UCT exploration; cap / rootCap: placements kept (best by heuristic) inside the tree / at its root;
  // eps: playout randomness; sample: placements a playout compares before picking one.
  constructor({ c = 1, cap = 20, rootCap = 48, eps = 0.2, sample = 10, seed = (Math.random() * 2 ** 32) >>> 0, placementEval = null, playoutEval = placementEval } = {}) {
    Object.assign(this, { c, cap, rootCap, eps, sample, placementEval, playoutEval });
    this.rnd = mulberry32(seed);
    this.carry = null; // { key, node }: the subtree under the placement just played
    this.stats = null; // while analysing: per root move, { win, margin, land } summed over its simulations
    // while analysing a pick: the drafted domino to follow, and where its drafter lays it (hit)
    this.watch = { on: false, p: 0, d: 0, hit: null };
  }

  // Searches until `sims` simulations or `ms` milliseconds, then plays the most visited move.
  choose(game, { sims = 2000, ms = 1500 } = {}) {
    const acts = game.legal(this.rootCap, BUF, this.placementEval);
    const carry = this.carry;
    this.carry = null;
    if (acts.length === 1) return { move: acts[0], sims: 0 };
    // Placing reveals nothing, so the tree grown for the placement is a head start for the pick after it.
    let root = carry && carry.key === game.key() ? carry.node : null;
    if (!root) { root = new Node(); root.acts = acts; }
    const n = this.grow(game, root, sims, ms);
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

  // For the coach: searches every legal move (no cap), gives each at least `min` simulations so even
  // the ones dismissed early are judged on more than a few games, and reports per move its visits, value,
  // win rate and average final lead in points over the best opponent (ev). For a pick, `land` is the
  // spot where the picked domino did best. Moves come best first, ranked like choose() ranks them.
  analyse(game, { sims = 8000, ms = 2500, min = 24 } = {}) {
    const acts = game.legal(0, BUF), player = game.player;
    const blank = (move) => ({ move, visits: 0, value: 0, win: 0, ev: 0, land: null });
    if (acts.length < 2) return { player, sims: 0, moves: acts.map(blank) };
    const root = new Node();
    root.acts = acts;
    this.stats = new Map(acts.map((a) => [a, { win: 0, margin: 0, land: new Map() }]));
    let n = this.grow(game, root, sims, ms);
    for (const a of acts) {
      for (let k = root.kids.has(a) ? root.kids.get(a).n : 0; k < min; k++) {
        const st = game.clone();
        st.determinize(this.rnd);
        this.simulate(st, root, a);
        n++;
      }
    }
    const moves = acts.map((a) => {
      const k = root.kids.get(a), s = this.stats.get(a);
      if (!k) return blank(a);
      return { move: a, visits: k.n, value: k.w / k.n, win: s.win / k.n, ev: s.margin / k.n, land: landing(s.land) };
    }).sort((p, q) => q.visits - p.visits || q.value - p.value);
    this.stats = null;
    return { player, sims: n, moves };
  }

  grow(game, root, sims, ms) {
    const end = performance.now() + ms;
    let n = 0;
    while (n < sims && ((n & 15) || performance.now() < end)) {
      const st = game.clone();
      st.determinize(this.rnd);
      this.simulate(st, root);
      n++;
    }
    return n;
  }

  // One simulation: down the tree by UCT (or through `forced` at the root), expanding one new move, then
  // a playout to the end.
  simulate(st, root, forced = null) {
    let node = root, depth = 0, fixed = true; // fixed: no tile revealed yet, every deal agrees on the state
    let first = null; // this simulation's root move
    const path = [], actors = [], watch = this.watch;
    watch.on = false;
    while (st.phase !== DONE) {
      const actor = st.player;
      let acts = fixed ? node.acts : null;
      if (!acts) {
        acts = st.legal(depth ? this.cap : this.rootCap, BUF, this.placementEval);
        if (fixed) node.acts = acts;
      }
      let a = depth === 0 && forced !== null ? forced : this.untried(st, acts, node.kids);
      if (a === null) a = this.uct(node, acts);
      if (depth === 0) {
        first = a;
        if (this.stats && st.phase !== PLACE) Object.assign(watch, { on: true, p: actor, d: (st.phase === INIT ? st.line : st.nextLine)[a], hit: null });
      } else if (st.phase === PLACE) this.spot(st, a);
      let kid = node.kids.get(a);
      const r0 = st.reveals;
      st.apply(a);
      if (!kid) {
        kid = new Node();
        node.kids.set(a, kid);
        path.push(kid);
        actors.push(actor);
        break;
      }
      if (st.reveals !== r0) fixed = false;
      node = kid;
      path.push(node);
      actors.push(actor);
      depth++;
    }
    this.playout(st);
    const m = margins(st.scores());
    root.n++;
    for (let i = 0; i < path.length; i++) {
      path[i].n++;
      path[i].w += value(m[actors[i]]);
    }
    if (this.stats) {
      const s = this.stats.get(first), me = m[actors[0]];
      s.win += me > 0 ? 1 : me === 0 ? 0.5 : 0;
      s.margin += me;
      if (watch.on && watch.hit !== null && watch.hit !== DISCARD) {
        const rec = s.land.get(watch.hit);
        if (rec) { rec[0]++; rec[1] += value(me); } else s.land.set(watch.hit, [1, value(me)]);
      }
      watch.on = false;
    }
  }

  // Notes where the followed domino is laid, the first time its drafter places it.
  spot(st, m) {
    const w = this.watch;
    if (w.on && w.hit === null && st.line[st.idx] === w.d && st.player === w.p) w.hit = m;
  }

  uct(node, acts) {
    const logn = Math.log(node.n + 1);
    let best = acts[0], bu = -Infinity;
    for (const a of acts) {
      const k = node.kids.get(a);
      const u = k.w / k.n + this.c * Math.sqrt(logn / k.n);
      if (u > bu) { bu = u; best = a; }
    }
    return best;
  }

  // The heuristically best move not yet in the tree (null when all are), expanded first.
  untried(st, acts, kids) {
    const b = st.boards[st.player];
    const place = st.phase === PLACE, d = place ? st.line[st.idx] : 0;
    const line = st.phase === INIT ? st.line : st.nextLine;
    let best = null, bv = -Infinity;
    for (const a of acts) {
      if (kids.has(a)) continue;
      const v = (place ? (a === DISCARD ? 0 : (this.placementEval ? this.placementEval.call(b, a, d) : b.quickEval(a, d))) : b.pickEval(line[a]) - 0.05 * a) + 0.01 * this.rnd();
      if (v > bv) { bv = v; best = a; }
    }
    return best;
  }

  // Plays to the end: mostly the heuristically best of a few sampled placements and the most
  // promising free domino, with a random move now and then.
  playout(st) {
    const rnd = this.rnd, eps = this.eps, watching = this.watch.on;
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
            const v = this.playoutEval ? this.playoutEval.call(b, BUF[i], d) : b.quickEval(BUF[i], d);
            if (v > bv) { bv = v; m = BUF[i]; }
          }
        }
        if (watching) this.spot(st, m);
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
  }
}
