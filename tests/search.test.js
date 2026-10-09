// The search engine must agree with rules.js on every legal placement and every score, and the expert
// must only ever make legal moves in real game flows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMINOES, Kingdom, footprint } from '../src/core/rules.js';
import { Rng, mulberry32 } from '../src/core/rng.js';
import { Board, DONE } from '../src/core/search/engine.js';
import { gameFrom, moveOut } from '../src/core/search/state.js';
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

test('three players draft lines of 4 and discard the domino nobody claims', () => {
  const tables = [];
  const { players, unclaimed } = playGame({ types: ['expert', 'hard', 'normal'], seed: 7, budget: { sims: 40, ms: 1000 },
    onDecision: (table) => tables.push(structuredClone(table)) }); // (as the worker receives it)
  // 12 lines, each leaving one domino out: every domino in the box goes through, 12 to each kingdom
  assert.equal(unclaimed.length, 12);
  const dealt = new Set(unclaimed);
  for (const p of players) {
    assert.equal(p.kingdom.placements.length + p.kingdom.discards.length, 12);
    for (const pl of p.kingdom.placements) dealt.add(pl.id);
    for (const id of p.kingdom.discards) dealt.add(id);
  }
  assert.equal(dealt.size, 48);
  // the search knows the discarded dominoes are gone: the chest is exactly what it has not seen
  for (const t of tables) assert.equal(48 - t.seen.length, t.left, `${t.phase} with ${t.left} left`);
  // and plays the same game: from the opening draft to the end, every king lays 12 dominoes
  const game = gameFrom(tables[0]), rnd = mulberry32(7);
  game.determinize(rnd);
  while (game.phase !== DONE) {
    const acts = game.legal();
    game.apply(acts[(rnd() * acts.length) | 0]);
  }
  for (const b of game.boards) assert.equal(b.placed + b.discards, 12);
});

test('with the snake house rule the first round goes in reverse opening order, at the table and in the search', () => {
  const tables = [];
  playGame({ types: ['expert', 'expert', 'expert', 'expert'], seed: 5, snake: true, budget: { sims: 30, ms: 1000 },
    onDecision: (table) => tables.push(structuredClone(table)) });
  const opening = tables.filter((t) => t.phase === 'open'), order = opening[0].order;
  assert.equal(opening.length, 4);
  // at the table: the first four dominoes are laid by the openers in reverse, each then picking
  const placers = tables.filter((t) => t.phase !== 'open').slice(0, 8).filter((t) => t.phase === 'place').map((t) => t.own[t.idx]);
  assert.deepEqual(placers, [...order].reverse());
  // in the search: once the last opener has drafted, the engine plays the first round in the same order
  const game = gameFrom(opening[3]);
  game.determinize(mulberry32(5));
  game.apply(game.legal()[0]);
  assert.deepEqual([...game.own], [...order].reverse());
  // without the rule, the first round goes in slot order (lowest domino first) as usual
  const plain = [];
  playGame({ types: ['expert', 'expert', 'expert', 'expert'], seed: 5, budget: { sims: 30, ms: 1000 },
    onDecision: (table) => plain.push(structuredClone(table)) });
  const first = plain.find((t) => t.phase === 'place');
  assert.deepEqual(first.line, [...first.line].sort((a, b) => a - b));
});
