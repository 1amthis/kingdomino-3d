// Pure game logic for Kingdomino: tiles, kingdoms, placement rules and scoring.
// Nothing in here knows about rendering, so the AI can simulate freely.

export const TERRAINS = ['wheat', 'forest', 'lake', 'grass', 'swamp', 'mine'];

export const TERRAIN_INFO = {
  wheat:  { name: 'Wheat Fields', short: 'Fields',    color: '#e7bf3c', ink: '#5a4308' },
  forest: { name: 'Forest',       short: 'Forest',    color: '#2e6b37', ink: '#e4f5dd' },
  lake:   { name: 'Lake',         short: 'Lake',      color: '#2f86cf', ink: '#e6f3ff' },
  grass:  { name: 'Grassland',    short: 'Grassland', color: '#8fcd4c', ink: '#243d0b' },
  swamp:  { name: 'Swamp',        short: 'Swamp',     color: '#7c7043', ink: '#f3edd3' },
  mine:   { name: 'Mines',        short: 'Mines',     color: '#4a4750', ink: '#f0eef5' },
  castle: { name: 'Castle',       short: 'Castle',    color: '#b9b2a4', ink: '#222' },
};

const W = 'wheat', F = 'forest', L = 'lake', G = 'grass', S = 'swamp', M = 'mine';

// The 48 official dominoes: [number, terrainA, crownsA, terrainB, crownsB]
const RAW = [
  [1, W, 0, W, 0], [2, W, 0, W, 0], [3, F, 0, F, 0], [4, F, 0, F, 0], [5, F, 0, F, 0], [6, F, 0, F, 0],
  [7, L, 0, L, 0], [8, L, 0, L, 0], [9, L, 0, L, 0], [10, G, 0, G, 0], [11, G, 0, G, 0], [12, S, 0, S, 0],
  [13, W, 0, F, 0], [14, W, 0, L, 0], [15, W, 0, G, 0], [16, W, 0, S, 0], [17, F, 0, L, 0], [18, F, 0, G, 0],
  [19, W, 1, F, 0], [20, W, 1, L, 0], [21, W, 1, G, 0], [22, W, 1, S, 0], [23, W, 1, M, 0],
  [24, F, 1, W, 0], [25, F, 1, W, 0], [26, F, 1, W, 0], [27, F, 1, W, 0], [28, F, 1, L, 0], [29, F, 1, G, 0],
  [30, L, 1, W, 0], [31, L, 1, W, 0], [32, L, 1, F, 0], [33, L, 1, F, 0], [34, L, 1, F, 0], [35, L, 1, F, 0],
  [36, W, 0, G, 1], [37, L, 0, G, 1], [38, W, 0, S, 1], [39, G, 0, S, 1], [40, M, 1, W, 0],
  [41, W, 0, G, 2], [42, L, 0, G, 2], [43, W, 0, S, 2], [44, G, 0, S, 2], [45, M, 2, W, 0],
  [46, S, 0, M, 2], [47, S, 0, M, 2], [48, W, 0, M, 3],
];

export const DOMINOES = RAW.map(([id, ta, ca, tb, cb]) => Object.freeze({
  id,
  squares: Object.freeze([
    Object.freeze({ terrain: ta, crowns: ca }),
    Object.freeze({ terrain: tb, crowns: cb }),
  ]),
}));

export const dominoById = (id) => DOMINOES[id - 1];

// Rotation r places square B at A + DIRS[r]. Grid x → right, y → towards the player.
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const key = (x, y) => `${x},${y}`;

export function footprint(x, y, rot) {
  const [dx, dy] = DIRS[rot];
  return [[x, y], [x + dx, y + dy]];
}

export class Kingdom {
  constructor(size = 5) {
    this.size = size;
    this.cells = new Map([[key(0, 0), { terrain: 'castle', crowns: 0 }]]);
    this.minX = 0; this.maxX = 0; this.minY = 0; this.maxY = 0;
    this.placements = [];
    this.discards = [];
  }

  clone() {
    const k = new Kingdom(this.size);
    k.cells = new Map(this.cells);
    k.minX = this.minX; k.maxX = this.maxX; k.minY = this.minY; k.maxY = this.maxY;
    k.placements = this.placements.slice();
    k.discards = this.discards.slice();
    return k;
  }

  get(x, y) { return this.cells.get(key(x, y)); }
  has(x, y) { return this.cells.has(key(x, y)); }

  // The rectangle of cells that may still legally hold a square.
  allowedRect() {
    const s = this.size - 1;
    return { x0: this.maxX - s, x1: this.minX + s, y0: this.maxY - s, y1: this.minY + s };
  }

  fits(cells) {
    let { minX, maxX, minY, maxY } = this;
    for (const [x, y] of cells) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return maxX - minX < this.size && maxY - minY < this.size;
  }

  canPlace(domino, x, y, rot) {
    const fp = footprint(x, y, rot);
    if (this.has(fp[0][0], fp[0][1]) || this.has(fp[1][0], fp[1][1])) return false;
    if (!this.fits(fp)) return false;
    for (let i = 0; i < 2; i++) {
      const [cx, cy] = fp[i];
      const t = domino.squares[i].terrain;
      for (const [dx, dy] of DIRS) {
        const n = this.get(cx + dx, cy + dy);
        if (n && (n.terrain === 'castle' || n.terrain === t)) return true;
      }
    }
    return false;
  }

  validPlacements(domino) {
    const out = [];
    const r = this.allowedRect();
    for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
      for (let y = r.y0 - 1; y <= r.y1 + 1; y++) {
        for (let rot = 0; rot < 4; rot++) {
          if (this.canPlace(domino, x, y, rot)) out.push({ x, y, rot });
        }
      }
    }
    return out;
  }

  place(domino, x, y, rot) {
    const fp = footprint(x, y, rot);
    fp.forEach(([cx, cy], i) => {
      this.cells.set(key(cx, cy), { terrain: domino.squares[i].terrain, crowns: domino.squares[i].crowns, dominoId: domino.id });
      if (cx < this.minX) this.minX = cx; if (cx > this.maxX) this.maxX = cx;
      if (cy < this.minY) this.minY = cy; if (cy > this.maxY) this.maxY = cy;
    });
    this.placements.push({ id: domino.id, x, y, rot });
  }

  discard(domino) { this.discards.push(domino.id); }

  // Connected same-terrain properties (castle excluded).
  regions() {
    const seen = new Set();
    const regions = [];
    for (const [k0, cell] of this.cells) {
      if (cell.terrain === 'castle' || seen.has(k0)) continue;
      const [sx, sy] = k0.split(',').map(Number);
      const stack = [[sx, sy]];
      const region = { terrain: cell.terrain, cells: [], crowns: 0 };
      seen.add(k0);
      while (stack.length) {
        const [x, y] = stack.pop();
        const c = this.get(x, y);
        region.cells.push([x, y]);
        region.crowns += c.crowns;
        for (const [dx, dy] of DIRS) {
          const nk = key(x + dx, y + dy);
          if (seen.has(nk)) continue;
          const n = this.cells.get(nk);
          if (n && n.terrain === cell.terrain) { seen.add(nk); stack.push([x + dx, y + dy]); }
        }
      }
      region.size = region.cells.length;
      region.score = region.size * region.crowns;
      regions.push(region);
    }
    return regions;
  }

  isCentered() {
    const h = (this.size - 1) / 2;
    return this.minX === -h && this.maxX === h && this.minY === -h && this.maxY === h;
  }

  isComplete() { return this.cells.size === this.size * this.size; }

  score(opts = {}) {
    const regions = this.regions();
    const base = regions.reduce((s, r) => s + r.score, 0);
    const middle = opts.middleKingdom && this.isCentered() ? 10 : 0;
    const harmony = opts.harmony && this.isComplete() && this.discards.length === 0 ? 5 : 0;
    const largest = regions.reduce((m, r) => Math.max(m, r.size), 0);
    const crowns = regions.reduce((s, r) => s + r.crowns, 0);
    return { total: base + middle + harmony, base, middle, harmony, regions, largest, crowns };
  }
}

export function kingsPerPlayer(numPlayers) { return numPlayers === 2 ? 2 : 1; }
export function lineSize(numPlayers) { return numPlayers === 3 ? 3 : 4; }
export function deckSize(numPlayers, mightyDuel) {
  if (numPlayers === 2) return mightyDuel ? 48 : 24;
  return numPlayers === 3 ? 36 : 48;
}

// Final ranking with the official tie-breakers: score, largest property, total crowns.
export function rank(players, opts) {
  const rows = players.map((p) => ({ player: p, s: p.kingdom.score(opts) }));
  rows.sort((a, b) => b.s.total - a.s.total || b.s.largest - a.s.largest || b.s.crowns - a.s.crowns);
  let place = 1;
  rows.forEach((r, i) => {
    if (i > 0) {
      const p = rows[i - 1];
      const tied = p.s.total === r.s.total && p.s.largest === r.s.largest && p.s.crowns === r.s.crowns;
      if (!tied) place = i + 1;
    }
    r.place = place;
  });
  return rows;
}
