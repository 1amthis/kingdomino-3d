// Heuristic AI: greedy look-one-ahead with a hand-tuned kingdom evaluation.
import { DIRS } from './rules.js';

// How likely a square of this terrain still is to bring crowns later (about crowns / squares in the box).
const CROWN_DENSITY = { wheat: 0.19, forest: 0.27, lake: 0.33, grass: 0.43, swamp: 0.6, mine: 1 };

// Empty squares that can never be covered: isolated holes, plus one square per odd-sized
// enclosed gap (dominoes always cover two squares). Gaps touching the still-growable
// border of the allowed rectangle are not enclosed.
function deadCells(k) {
  const r = k.allowedRect();
  const inside = (x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  const growX = r.x1 - r.x0 + 1 > k.maxX - k.minX + 1, growY = r.y1 - r.y0 + 1 > k.maxY - k.minY + 1;
  const seen = new Set();
  let dead = 0;
  for (let x = k.minX; x <= k.maxX; x++) {
    for (let y = k.minY; y <= k.maxY; y++) {
      const key0 = x * 100 + y;
      if (k.has(x, y) || seen.has(key0)) continue;
      // flood the empty gap inside the allowed rectangle
      const stack = [[x, y]];
      seen.add(key0);
      let size = 0, open = false;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        size++;
        if ((growX && (cx < k.minX || cx > k.maxX)) || (growY && (cy < k.minY || cy > k.maxY))) open = true;
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy, nk = nx * 100 + ny;
          if (!inside(nx, ny) || k.has(nx, ny) || seen.has(nk)) continue;
          seen.add(nk);
          stack.push([nx, ny]);
        }
        if (size > 40) { open = true; break; }
      }
      if (size === 1) dead++;
      else if (!open && size % 2 === 1) dead++;
    }
  }
  return dead;
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

// Soft risk: empty squares with a single empty neighbour can only be filled one way, and a
// two-square pocket bordered by a single terrain needs a domino carrying that terrain.
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

export function evaluateKingdom(k, opts) {
  let v = 0;
  for (const region of k.regions()) {
    v += region.size * region.crowns;
    const f = Math.min(frontier(k, region), 5);
    v += 0.3 * region.crowns * f + 0.18 * region.size * CROWN_DENSITY[region.terrain] * Math.min(f, 3);
  }
  const dead = deadCells(k);
  v -= 4.5 * dead + 1.6 * tightness(k);
  if (opts.middleKingdom) {
    const h = (k.size - 1) / 2;
    const centerable = k.minX >= -h && k.maxX <= h && k.minY >= -h && k.maxY <= h;
    v += centerable ? 0 : -6;
  }
  if (opts.harmony && (dead > 0 || k.discards.length > 0)) v -= 3;
  return v;
}

export function rankPlacements(kingdom, domino, opts) {
  return kingdom.validPlacements(domino).map((p) => {
    const k = kingdom.clone();
    k.place(domino, p.x, p.y, p.rot);
    return { ...p, value: evaluateKingdom(k, opts) };
  }).sort((a, b) => b.value - a.value);
}

export function choosePlacement(kingdom, domino, opts, level, rng) {
  const ranked = rankPlacements(kingdom, domino, opts);
  if (!ranked.length) return null;
  if (level === 'easy') {
    if (rng.chance(0.45)) return rng.pick(ranked);
    return ranked[Math.min(ranked.length - 1, rng.int(0, 2))];
  }
  return ranked[0];
}

function gainFor(kingdom, domino, opts) {
  const base = evaluateKingdom(kingdom, opts);
  const ranked = rankPlacements(kingdom, domino, opts);
  if (!ranked.length) return -9;
  return ranked[0].value - base;
}

// slots: [{ domino, index }] still unclaimed in the next line.
export function chooseSlot(me, others, slots, lineLength, opts, level, rng) {
  if (level === 'easy' && rng.chance(0.5)) return rng.pick(slots);
  let best = null;
  for (const slot of slots) {
    let v = gainFor(me.kingdom, slot.domino, opts);
    // Earlier slots mean picking earlier next round.
    v += (level === 'hard' ? 1.1 : 0.7) * (lineLength - 1 - slot.index) / Math.max(1, lineLength - 1);
    if (level === 'hard' && others.length) {
      const deny = Math.max(...others.map((o) => gainFor(o.kingdom, slot.domino, opts)));
      v += 0.3 * deny;
    }
    v += rng.float(-0.15, 0.15);
    if (!best || v > best.v) best = { slot, v };
  }
  return best.slot;
}
