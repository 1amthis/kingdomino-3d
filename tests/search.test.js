// The search engine must agree with rules.js on every legal placement and every score, and the expert
// must only ever make legal moves in real game flows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMINOES, Kingdom, footprint } from '../src/core/rules.js';
import { Rng } from '../src/core/rng.js';
import { Board } from '../src/core/search/engine.js';
import { moveOut } from '../src/core/search/state.js';
import { playGame } from '../scripts/headless.js';

// What a placement leaves on the table: the two squares with their terrain and crowns, in either order.
function outcomeKey(domino, { x, y, rot }) {
  return footprint(x, y, rot).map(([cx, cy], i) => `${cx},${cy}:${domino.squares[i].terrain}${domino.squares[i].crowns}`).sort().join(' ');
}

// Squares already around a placement: packing dominoes tightly fills kingdoms, so the bonuses get tested.
const snug = (k, v) => footprint(v.x, v.y, v.rot).reduce((s, [x, y]) => s + [[1, 0], [0, 1], [-1, 0], [0, -1]].filter(([dx, dy]) => k.has(x + dx, y + dy)).length, 0);

// Lays legal dominoes (random ones, or the snuggest) into both representations side by side,
// checking them against each other at every step, and counts the bonuses earned along the way.
let earned;
function lockstep(size, seed, packed) {
  const rng = new Rng(seed);
  const kingdom = new Kingdom(size), board = new Board(size), buf = new Int32Array(1024);
  const place = { phase: 1, boards: [board] }; // enough of a Game for moveOut
  for (const domino of rng.shuffle(DOMINOES.slice())) {
    const valid = kingdom.validPlacements(domino);
    const n = board.placements(domino.id - 1, buf);
    const ours = Array.from(buf.subarray(0, n), (m) => outcomeKey(domino, moveOut(place, m)));
    assert.equal(new Set(ours).size, ours.length, 'a placement is listed twice');
    assert.deepEqual(new Set(ours), new Set(valid.map((v) => outcomeKey(domino, v))), `placements of domino ${domino.id}`);
    if (valid.length) {
      const most = packed && Math.max(...valid.map((v) => snug(kingdom, v)));
      const v = rng.pick(packed ? valid.filter((w) => snug(kingdom, w) === most) : valid);
      kingdom.place(domino, v.x, v.y, v.rot);
      board.place(buf[ours.indexOf(outcomeKey(domino, v))], domino.id - 1);
    } else {
      kingdom.discard(domino);
      board.discards++;
    }
    const bonus = { middleKingdom: true, harmony: true };
    assert.equal(board.score(false, false), kingdom.score().total, 'score');
    assert.equal(board.score(true, true), kingdom.score(bonus).total, 'score with bonuses');
    const s = kingdom.score(bonus);
    if (s.middle) earned.middle++;
    if (s.harmony) earned.harmony++;
  }
}

for (const size of [5, 7]) {
  test(`placements and scores match rules.js on ${size}×${size} kingdoms`, () => {
    earned = { middle: 0, harmony: 0 };
    for (let seed = 1; seed <= 120; seed++) lockstep(size, seed, seed % 2 === 0);
    // both bonuses were actually on the line in some of those games
    assert.ok(earned.middle > 0 && earned.harmony > 0, JSON.stringify(earned));
  });
}

test('the expert plays legal moves in every game setup', () => {
  const setups = [
    { types: ['expert', 'hard'] },
    { types: ['hard', 'expert'], middleKingdom: true, harmony: true },
    { types: ['expert', 'normal', 'expert'] },
    { types: ['easy', 'expert', 'hard', 'expert'], harmony: true },
    { types: ['expert', 'expert'], mightyDuel: true, middleKingdom: true },
  ];
  setups.forEach((setup, i) => {
    const { ranking } = playGame({ ...setup, seed: 11 + i, budget: { sims: 80, ms: 1000 } });
    assert.equal(ranking.length, setup.types.length);
  });
});
