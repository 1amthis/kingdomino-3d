// The repo's heuristic AI (src/core/ai.js) with one change: the squares that can never be covered are
// counted exactly, by a maximum matching of the free cells over every 5×5 window the kingdom can still
// end in, instead of the hand rule (isolated holes + one per odd enclosed gap). Everything else is copied.
import { DIRS } from '../../src/core/rules.js';

const CROWN_DENSITY = { wheat: 0.19, forest: 0.27, lake: 0.33, grass: 0.43, swamp: 0.6, mine: 1 };

// Fewest free squares left uncovered by any set of dominoes, over the windows still possible (König:
// in the bipartite grid graph, free cells − 2 × maximum matching).
export function wastedCells(k) {
  const s = k.size;
  let best = -1, free = 0;
  for (let wx = k.maxX - s + 1; wx <= k.minX; wx++) {
    for (let wy = k.maxY - s + 1; wy <= k.minY; wy++) {
      const freeSet = new Set(), left = [];
      for (let x = wx; x < wx + s; x++) {
        for (let y = wy; y < wy + s; y++) {
          if (k.has(x, y)) continue;
          freeSet.add(x * 100 + y);
          if (((x + y) & 1) === 0) left.push([x, y]);
        }
      }
      free = freeSet.size;
      const match = new Map();
      let m = 0;
      for (const [ux, uy] of left) {
        const vis = new Set();
        const aug = (x, y) => {
          for (const [dx, dy] of DIRS) {
            const v = (x + dx) * 100 + (y + dy);
            if (!freeSet.has(v) || vis.has(v)) continue;
            vis.add(v);
            const owner = match.get(v);
            if (owner === undefined || aug(owner[0], owner[1])) { match.set(v, [x, y]); return true; }
          }
          return false;
        };
        if (aug(ux, uy)) m++;
      }
      if (m > best) best = m;
    }
  }
  return free - 2 * best;
}

function frontier(k, region) {
  const r = k.allowedRect();
  const seen = new Set();
  for (const [x, y] of region.cells) {
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < r.x0 || nx > r.x1 || ny < r.y0 || ny > r.y1 || k.has(nx, ny)) continue;
      seen.add(nx * 100 + ny);
    }
  }
  return seen.size;
}

function tightness(k) {
  const r = k.allowedRect();
  const inside = (x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  const fixed = r.x1 - r.x0 === k.maxX - k.minX && r.y1 - r.y0 === k.maxY - k.minY;
  let risk = 0;
  for (let x = k.minX; x <= k.maxX; x++) {
    for (let y = k.minY; y <= k.maxY; y++) {
      if (k.has(x, y)) continue;
      let empty = 0;
      const terrains = new Set();
      let castle = false;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        const c = k.get(nx, ny);
        if (!c) empty++;
        else if (c.terrain === 'castle') castle = true;
        else terrains.add(c.terrain);
      }
      if (empty === 1) risk += fixed ? 0.9 : 0.4;
      if (empty <= 1 && !castle && terrains.size === 1) risk += fixed ? 0.8 : 0.3;
    }
  }
  return risk;
}

export function evaluateKingdomG(k, opts) {
  let v = 0;
  for (const region of k.regions()) {
    v += region.size * region.crowns;
    const f = Math.min(frontier(k, region), 5);
    v += 0.3 * region.crowns * f + 0.18 * region.size * CROWN_DENSITY[region.terrain] * Math.min(f, 3);
  }
  const dead = wastedCells(k);
  v -= 4.5 * dead + 1.6 * tightness(k);
  if (opts.middleKingdom) {
    const h = (k.size - 1) / 2;
    const centerable = k.minX >= -h && k.maxX <= h && k.minY >= -h && k.maxY <= h;
    v += centerable ? 0 : -6;
  }
  if (opts.harmony && (dead > 0 || k.discards.length > 0)) v -= 3;
  return v;
}

export function rankPlacementsG(kingdom, domino, opts) {
  return kingdom.validPlacements(domino).map((p) => {
    const k = kingdom.clone();
    k.place(domino, p.x, p.y, p.rot);
    return { ...p, value: evaluateKingdomG(k, opts) };
  }).sort((a, b) => b.value - a.value);
}

export function choosePlacementG(kingdom, domino, opts) {
  const ranked = rankPlacementsG(kingdom, domino, opts);
  return ranked.length ? ranked[0] : null;
}

function gainFor(kingdom, domino, opts) {
  const base = evaluateKingdomG(kingdom, opts);
  const ranked = rankPlacementsG(kingdom, domino, opts);
  if (!ranked.length) return -9;
  return ranked[0].value - base;
}

// chooseSlot of ai.js at the 'hard' level, on the same evaluation.
export function chooseSlotG(me, others, slots, lineLength, opts, rng) {
  let best = null;
  for (const slot of slots) {
    let v = gainFor(me.kingdom, slot.domino, opts);
    v += 1.1 * (lineLength - 1 - slot.index) / Math.max(1, lineLength - 1);
    if (others.length) {
      const deny = Math.max(...others.map((o) => gainFor(o.kingdom, slot.domino, opts)));
      v += 0.3 * deny;
    }
    v += rng.float(-0.15, 0.15);
    if (!best || v > best.v) best = { slot, v };
  }
  return best.slot;
}
