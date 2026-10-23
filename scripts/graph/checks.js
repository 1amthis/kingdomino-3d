// Sanity checks for the graph study, then how the hand rule for dead squares compares with the matching.
//   node scripts/graph/checks.js [--positions 300]
// 1. The pruned exact solver finds the same optimum as plain exhaustive search on short sequences.
// 2. Neither bound ever falls below the exact optimum of a mid-game position.
// 3. The matching count on the engine's boards agrees with the one on rules.js kingdoms.
// 4. src/core/ai.js's deadCells (copied) against the matching, on Hard and on random play.
import { Kingdom, dominoById, DIRS } from '../../src/core/rules.js';
import { choosePlacement } from '../../src/core/ai.js';
import { Rng } from '../../src/core/rng.js';
import { solveOffline, shuffled, mulberry32, upperBound, upperBoundPockets, suffixStats, Board, child, DISCARD, deficiency, G } from './lib.js';
import { wastedCells } from './ai-matching.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
let failures = 0;
const fail = (...m) => { failures++; console.log('FAIL', ...m); };

// 1
{
  const rnd = mulberry32(7);
  for (let t = 0; t < 30; t++) {
    const seq = shuffled(rnd, 48).slice(0, 5);
    const plain = solveOffline(seq, { useTT: false, useBound: false }).optimum;
    for (const opts of [{}, { useSym: false }, { bound: 'simple' }, { orderBy: 'ub' }]) {
      const v = solveOffline(seq, opts).optimum;
      if (v !== plain) fail('solver', JSON.stringify(opts), seq, v, plain);
    }
  }
  console.log('1. solver against exhaustive search: 30 sequences of 5 dominoes checked');
}

// 2
{
  const rnd = mulberry32(99), buf = new Int32Array(512), count = +arg('positions', 300);
  let n = 0, slackSimple = 0, slackPockets = 0, tighter = 0;
  for (let t = 0; t < count; t++) {
    const seq = shuffled(rnd, 48).slice(0, 12), k = 6 + (t % 4);
    let b = new Board(5);
    for (let s = 0; s < k; s++) {
      const m = b.placements(seq[s], buf);
      b = child(b, m ? buf[(rnd() * m) | 0] : DISCARD, seq[s]);
    }
    const rest = seq.slice(k), { cells, crowns } = suffixStats(rest);
    const a = upperBound(b, cells[0], crowns[0]), p = upperBoundPockets(b, cells[0], crowns[0]);
    const opt = solveOffline(rest, { start: b, bound: 'simple', timeMs: 20000 }).optimum;
    if (opt === null) continue;
    n++; slackSimple += a - opt; slackPockets += p - opt;
    if (p < a) tighter++;
    if (a < opt || p < opt) fail('bound', { a, p, opt });
  }
  console.log(`2. bounds on ${n} positions: mean slack ${(slackSimple / n).toFixed(2)} (simple), ${(slackPockets / n).toFixed(2)} (pockets), pockets tighter in ${tighter}`);
}

// 3
{
  const rnd = mulberry32(5);
  let n = 0;
  for (let g = 0; g < 300; g++) {
    const seq = shuffled(rnd, 48).slice(0, 12), k = new Kingdom(5);
    let b = new Board(5);
    for (const d of seq) {
      const dom = dominoById(d + 1), v = k.validPlacements(dom);
      if (!v.length) { k.discard(dom); b = child(b, DISCARD, d); continue; }
      const p = v[(rnd() * v.length) | 0], [dx, dy] = DIRS[p.rot];
      k.place(dom, p.x, p.y, p.rot);
      const a = (p.y + 5) * G.W + p.x + 5, c = (p.y + dy + 5) * G.W + p.x + dx + 5;
      b = child(b, a << 8 | c, d);
      n++;
      if (wastedCells(k) !== deficiency(b).wasted) fail('matching', seq, wastedCells(k), deficiency(b).wasted);
    }
  }
  console.log(`3. both matching counts agree on ${n} positions`);
}

// 4
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
for (const mode of ['hard', 'random']) {
  const rnd = mulberry32(mode === 'hard' ? 11 : 12), rng = new Rng(3);
  let n = 0, waste = 0, flagged = 0, missed = 0, falseAlarm = 0;
  for (let g = 0; g < 400; g++) {
    const seq = shuffled(rnd, 48).slice(0, 12), k = new Kingdom(5);
    for (const d of seq) {
      const dom = dominoById(d + 1), v = k.validPlacements(dom);
      if (!v.length) { k.discard(dom); continue; }
      const p = mode === 'hard' ? choosePlacement(k, dom, {}, 'hard', rng) : v[(rnd() * v.length) | 0];
      k.place(dom, p.x, p.y, p.rot);
      const a = deadCells(k), w = wastedCells(k);
      n++;
      if (w > 0) waste++;
      if (a > 0) flagged++;
      if (w > 0 && !a) missed++;
      if (!w && a > 0) falseAlarm++;
    }
  }
  console.log(`4. ${mode} play, ${n} positions: waste proven by matching in ${waste}, flagged by the rule in ${flagged}, missed ${missed}, false alarms ${falseAlarm}`);
}

if (failures) { console.log(`${failures} failures`); process.exit(1); }
console.log('all checks passed');
