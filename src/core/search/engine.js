// A compact Kingdomino state for tree search. rules.js stays the source of truth (the tests hold the
// two to the same placements and scores); this one trades readability for speed, so the expert AI can
// play thousands of games to the end on every move: kingdoms are typed arrays and moves are integers.
import { DOMINOES, TERRAINS, lineSize } from '../rules.js';

// Terrain codes: 0 empty, 1 castle, 2–7 the six terrains, 8 the wall around the grid.
const CASTLE = 1, WALL = 8;
const CODE = Object.fromEntries(TERRAINS.map((t, i) => [t, i + 2]));

// The dominoes as [terrainA, crownsA, terrainB, crownsB]; domino number n starts at 4 * (n - 1).
export const DOM = new Uint8Array(DOMINOES.flatMap((d) => d.squares.flatMap((s) => [CODE[s.terrain], s.crowns])));

// A square may be laid next to its own terrain or the castle.
const MATCH = Array.from({ length: 8 }, (_, t) => (1 << CASTLE) | (1 << t));

export const INIT = 0, PLACE = 1, PICK = 2, DONE = 3;
// Moves: a slot index when drafting, cellA << 8 | cellB when placing (square A on cellA), or DISCARD.
export const DISCARD = -1;

// The castle sits at the centre of a (2·size + 1)² grid whose outer ring is wall. A kingdom spans at
// most `size` squares each way, so it never reaches the wall and neighbour lookups need no bounds checks.
const GRIDS = {};
export function grid(size) {
  if (GRIDS[size]) return GRIDS[size];
  const W = 2 * size + 1, N = W * W;
  const blank = new Uint8Array(N), col = new Uint8Array(N), row = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    col[i] = i % W;
    row[i] = (i / W) | 0;
    if (!col[i] || !row[i] || col[i] === W - 1 || row[i] === W - 1) blank[i] = WALL;
  }
  // step[r] follows rules.js DIRS: right, towards the player, left, away
  return (GRIDS[size] = { size, W, N, center: size * W + size, step: [1, W, -1, -W], blank, col, row });
}

const SEEN = new Uint8Array(15 * 15), STACK = new Int16Array(15 * 15);

export class Board {
  constructor(size) {
    const g = this.g = grid(size);
    this.t = g.blank.slice(); // terrain code per cell
    this.c = new Uint8Array(g.N); // crowns per cell
    this.adj = new Uint8Array(g.N); // bit 1 << code for each terrain next to the cell
    this.terr = new Uint8Array(8); // squares of each terrain
    this.crowns = new Uint8Array(8); // crowns on each terrain
    // bounding box of the kingdom, in grid columns and rows
    this.x0 = this.x1 = this.y0 = this.y1 = size;
    this.placed = 0;
    this.discards = 0;
    this.set(g.center, CASTLE, 0);
  }

  clone() {
    const b = Object.create(Board.prototype);
    b.g = this.g;
    b.t = this.t.slice(); b.c = this.c.slice(); b.adj = this.adj.slice();
    b.terr = this.terr.slice(); b.crowns = this.crowns.slice();
    b.x0 = this.x0; b.x1 = this.x1; b.y0 = this.y0; b.y1 = this.y1;
    b.placed = this.placed;
    b.discards = this.discards;
    return b;
  }

  set(i, tt, cc) {
    const { col, row, step } = this.g;
    this.t[i] = tt;
    this.c[i] = cc;
    const bit = 1 << tt;
    for (let k = 0; k < 4; k++) this.adj[i + step[k]] |= bit;
    if (col[i] < this.x0) this.x0 = col[i]; if (col[i] > this.x1) this.x1 = col[i];
    if (row[i] < this.y0) this.y0 = row[i]; if (row[i] > this.y1) this.y1 = row[i];
    this.terr[tt]++;
    this.crowns[tt] += cc;
  }

  place(m, d) {
    this.set(m >> 8, DOM[4 * d], DOM[4 * d + 1]);
    this.set(m & 255, DOM[4 * d + 2], DOM[4 * d + 3]);
    this.placed++;
  }

  // Writes every legal placement of domino index d into out and returns how many there are. Both squares
  // must lie in the rectangle the kingdom may still grow into (an adjacent pair inside it always fits)
  // and one of them must touch its own terrain or the castle. Pairs are listed from a square that already
  // touches the kingdom; a mirrored domino is listed one way only.
  placements(d, out) {
    const { t, adj } = this, { W, size, step } = this.g;
    const tA = DOM[4 * d], tB = DOM[4 * d + 2], mA = MATCH[tA], mB = MATCH[tB];
    const sym = tA === tB && DOM[4 * d + 1] === DOM[4 * d + 3];
    const x0 = this.x1 - size + 1, x1 = this.x0 + size - 1, y0 = this.y1 - size + 1, y1 = this.y0 + size - 1;
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const a = y * W + x, aa = adj[a];
        if (t[a] || !aa) continue;
        for (let r = 0; r < 4; r++) {
          if (r === 0 ? x === x1 : r === 1 ? y === y1 : r === 2 ? x === x0 : y === y0) continue;
          const b = a + step[r];
          if (t[b]) continue;
          const ab = adj[b];
          if (ab && b < a) continue; // listed from b
          if (aa & mA || ab & mB) out[n++] = a << 8 | b;
          if (!sym && (ab & mA || aa & mB)) out[n++] = b << 8 | a;
        }
      }
    }
    return n;
  }

  // The playout heuristic from the Python solver: roughly the points a placement adds, a little credit
  // for every neighbour (compact kingdoms leave fewer holes), less for stretching the bounding box.
  quickEval(m, d) {
    const a = m >> 8, b = m & 255, { col, row } = this.g;
    let v = this.half(a, DOM[4 * d], DOM[4 * d + 1]) + this.half(b, DOM[4 * d + 2], DOM[4 * d + 3]);
    if (row[a] < this.y0 || row[b] < this.y0 || row[a] > this.y1 || row[b] > this.y1) v -= 0.25;
    if (col[a] < this.x0 || col[b] < this.x0 || col[a] > this.x1 || col[b] > this.x1) v -= 0.25;
    return v;
  }

  half(i, tt, cc) {
    const { t, c } = this, step = this.g.step;
    let same = 0, near = 0, occ = 0;
    for (let k = 0; k < 4; k++) {
      const n = i + step[k], bt = t[n];
      if (!bt || bt === WALL) continue;
      occ++;
      if (bt === tt) { same++; near += c[n]; }
    }
    return cc * (1 + same) + near + 0.15 * occ;
  }

  // Cheap drafting heuristic: crowns, plus terrains this kingdom already grows.
  pickEval(d) {
    const tA = DOM[4 * d], tB = DOM[4 * d + 2];
    return 2 * (DOM[4 * d + 1] + DOM[4 * d + 3]) + 0.4 * (this.crowns[tA] + this.crowns[tB])
      + (this.terr[tA] ? 0.3 : 0) + (this.terr[tB] ? 0.3 : 0);
  }

  // Properties are flood-filled on demand: a playout scores each kingdom only once, at the end.
  score(middle, harmony) {
    const { t, c } = this, { W, N, size, step } = this.g;
    SEEN.fill(0, 0, N);
    let total = 0;
    for (let y = this.y0; y <= this.y1; y++) {
      for (let x = this.x0; x <= this.x1; x++) {
        const i = y * W + x, tt = t[i];
        if (tt <= CASTLE || SEEN[i]) continue;
        let top = 0, squares = 0, crowns = 0;
        STACK[top++] = i;
        SEEN[i] = 1;
        while (top) {
          const j = STACK[--top];
          squares++;
          crowns += c[j];
          for (let k = 0; k < 4; k++) {
            const n = j + step[k];
            if (t[n] === tt && !SEEN[n]) { SEEN[n] = 1; STACK[top++] = n; }
          }
        }
        total += squares * crowns;
      }
    }
    const h = (size - 1) / 2;
    if (middle && this.x0 === size - h && this.x1 === size + h && this.y0 === size - h && this.y1 === size + h) total += 10;
    if (harmony && !this.discards && 2 * this.placed + 1 === size * size) total += 5;
    return total;
  }
}

const POOL = new Int8Array(48);

export class Game {
  // Filled in by gameFrom() (state.js) from the table the controller sees.
  constructor(n, size, middle, harmony) {
    this.n = n;
    this.L = lineSize(n); // dominoes per line (with 3 players, one more than there are kings)
    this.middle = middle;
    this.harmony = harmony;
    this.boards = Array.from({ length: n }, () => new Board(size));
    this.seen = new Uint8Array(48); // dominoes revealed before the search began
    this.deck = new Int8Array(48); // the chest, drawn from deck[left - 1] down
    this.left = 0;
    this.line = null; // domino indices of the line being placed, claimed slots only (in the opening: being drafted)
    this.own = null; // who holds each of its slots (-1: nobody yet)
    this.nextLine = null; // the line being drafted
    this.nextOwn = null;
    this.order = null; // the opening draft's turn order
    this.snake = false; // house rule (one king each): the first round goes in reverse opening order
    this.phase = INIT;
    this.idx = 0; // the slot (or opening turn) being played
    this.reveals = 0;
  }

  clone() {
    const g = Object.create(Game.prototype);
    g.n = this.n; g.L = this.L; g.middle = this.middle; g.harmony = this.harmony;
    g.boards = this.boards.map((b) => b.clone());
    g.seen = this.seen;
    g.deck = this.deck.slice();
    g.left = this.left;
    g.line = this.line; // lines never change once drawn, only who holds their slots
    g.own = this.own.slice();
    g.nextLine = this.nextLine;
    g.nextOwn = this.nextOwn && this.nextOwn.slice();
    g.order = this.order;
    g.snake = this.snake;
    g.phase = this.phase; g.idx = this.idx; g.reveals = this.reveals;
    return g;
  }

  get player() {
    return this.phase === INIT ? this.order[this.idx] : this.phase === DONE ? -1 : this.own[this.idx];
  }

  // Nobody knows the chest's order: each simulation deals it afresh from the dominoes not yet seen.
  determinize(rnd) {
    let n = 0;
    for (let d = 0; d < 48; d++) if (!this.seen[d]) POOL[n++] = d;
    for (let i = 0; i < this.left; i++) {
      const j = i + Math.floor(rnd() * (n - i));
      const d = POOL[j];
      POOL[j] = POOL[i];
      this.deck[i] = POOL[i] = d;
    }
  }

  reveal() {
    const line = new Int8Array(this.L);
    for (let i = 0; i < this.L; i++) line[i] = this.deck[--this.left];
    this.reveals++;
    return line.sort();
  }

  freeSlots() {
    const own = this.phase === INIT ? this.own : this.nextOwn, out = [];
    for (let i = 0; i < this.L; i++) if (own[i] < 0) out.push(i);
    return out;
  }

  // Legal moves; cap keeps only the most promising placements (by the playout heuristic).
  legal(cap = 0, buf = new Int32Array(1024), placementEval = null) {
    if (this.phase !== PLACE) return this.freeSlots();
    const d = this.line[this.idx], b = this.boards[this.own[this.idx]];
    const n = b.placements(d, buf);
    if (!n) return [DISCARD];
    const moves = Array.from(buf.subarray(0, n));
    if (!cap || n <= cap) return moves;
    return moves.map((m) => [m, (placementEval ? placementEval.call(b, m, d) : b.quickEval(m, d))]).sort((p, q) => q[1] - p[1]).slice(0, cap).map((p) => p[0]);
  }

  apply(m) {
    if (this.phase === INIT) {
      this.own[m] = this.order[this.idx++];
      if (this.idx === this.order.length) {
        this.dropUnclaimed();
        if (this.snake) this.reverseRound();
        this.nextLine = this.reveal();
        this.nextOwn = new Int8Array(this.L).fill(-1);
        this.phase = PLACE;
        this.idx = 0;
      }
    } else if (this.phase === PLACE) {
      const b = this.boards[this.own[this.idx]];
      if (m === DISCARD) b.discards++;
      else b.place(m, this.line[this.idx]);
      if (this.nextLine) this.phase = PICK;
      else if (++this.idx === this.line.length) this.phase = DONE;
    } else if (this.phase === PICK) {
      this.nextOwn[m] = this.own[this.idx];
      if (++this.idx === this.line.length) {
        this.line = this.nextLine;
        this.own = this.nextOwn;
        this.dropUnclaimed();
        if (this.left) {
          this.nextLine = this.reveal();
          this.nextOwn = new Int8Array(this.L).fill(-1);
        } else this.nextLine = this.nextOwn = null;
        this.idx = 0;
      }
      this.phase = PLACE;
    }
  }

  // Once every king has claimed a domino in the line, the one nobody took (3 players) is discarded.
  dropUnclaimed() {
    const own = this.own;
    if (!own.includes(-1)) return;
    this.line = this.line.filter((_, i) => own[i] >= 0);
    this.own = own.filter((o) => o >= 0);
  }

  // The snake house rule: the line's kings play in reverse opening order instead of slot order.
  reverseRound() {
    const at = (i) => this.order.indexOf(this.own[i]);
    const ix = Array.from(this.line, (_, i) => i).sort((a, b) => at(b) - at(a));
    this.line = Int8Array.from(ix, (i) => this.line[i]);
    this.own = Int8Array.from(ix, (i) => this.own[i]);
  }

  scores() { return this.boards.map((b) => b.score(this.middle, this.harmony)); }

  // Identifies a position, so a search tree can carry over from placing a domino to the pick after it.
  key() {
    return [this.phase, this.idx, this.left, this.line, this.own, this.nextLine, this.nextOwn,
      ...this.boards.map((b) => `${b.t}/${b.c}/${b.discards}`)].join('|');
  }
}
