// How big the placement graph is: legal placements per turn (raw and up to symmetry) along greedy solo
// games, then the exact number of distinct positions against paths at each depth for three sequences.
//   node --max-old-space-size=6000 scripts/graph/branching.js --out branching.json
import { writeFileSync } from 'node:fs';
import { shuffled, mulberry32, Board, child, DISCARD, canonKey, greedyPolicy } from './lib.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const seqOf = (seed) => shuffled(mulberry32(seed), 48).slice(0, 12);
const buf = new Int32Array(512);

// branching along greedy games
const per = Array.from({ length: 12 }, () => ({ raw: [], sym: [], kids: [] }));
for (let seed = 1001; seed <= 1400; seed++) {
  const seq = seqOf(seed);
  let b = new Board(5);
  for (let s = 0; s < 12; s++) {
    const d = seq[s], n = b.placements(d, buf);
    const moves = Array.from(buf.subarray(0, n));
    per[s].raw.push(n);
    per[s].sym.push(n ? b.placementGroups(moves, d).size : 0);
    per[s].kids.push(new Set(moves.map((m) => canonKey(child(b, m, d)))).size);
    b = n ? child(b, greedyPolicy(b, d, buf, n), d) : child(b, DISCARD, d);
  }
}
const stat = (a) => {
  const m = a.reduce((x, y) => x + y, 0) / a.length, s = [...a].sort((x, y) => x - y);
  return { mean: +m.toFixed(1), p10: s[Math.floor(0.1 * s.length)], p90: s[Math.floor(0.9 * s.length)], max: s.at(-1) };
};
const branching = per.map((p, s) => ({ turn: s + 1, raw: stat(p.raw), sym: stat(p.sym), distinctKids: stat(p.kids) }));
console.table(branching.map((r) => ({ turn: r.turn, raw: r.raw.mean, rawP90: r.raw.p90, sym: r.sym.mean, kids: r.distinctKids.mean })));

// every position of the graph, level by level, until a level passes 300,000 positions
const layers = [];
for (const seed of [1, 2, 3]) {
  const seq = seqOf(seed);
  let layer = new Map([[canonKey(new Board(5), false), { b: new Board(5), paths: 1 }]]);
  for (let s = 0; s < 12; s++) {
    const d = seq[s], next = new Map(), nextSym = new Set();
    let paths = 0;
    for (const { b, paths: p } of layer.values()) {
      const n = b.placements(d, buf);
      const kids = n ? Array.from(buf.subarray(0, n), (m) => child(b, m, d)) : [child(b, DISCARD, d)];
      for (const c of kids) {
        const k = canonKey(c, false), e = next.get(k);
        if (e) e.paths += p; else next.set(k, { b: c, paths: p });
        nextSym.add(canonKey(c, true));
        paths += p;
      }
    }
    layers.push({ seed, depth: s + 1, positions: next.size, positionsSym: nextSym.size, paths });
    console.log(layers.at(-1));
    layer = next;
    if (next.size > 3e5) break;
  }
}
writeFileSync(arg('out', 'branching.json'), JSON.stringify({ branching, layers }, null, 1));
