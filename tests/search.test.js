// The search engine must agree with rules.js on every legal placement and every score, and the expert
// must only ever make legal moves in real game flows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMINOES, Kingdom, footprint, dominoById } from '../src/core/rules.js';
import { Rng, mulberry32 } from '../src/core/rng.js';
import { Board, PLACE, PICK, DONE, DISCARD } from '../src/core/search/engine.js';
import { gameFrom, moveOut } from '../src/core/search/state.js';
import { playGame } from '../scripts/headless.js';

// What a placement leaves on the table: the two squares with their terrain and crowns, in either order.
function outcomeKey(domino, { x, y, rot }) {
  return footprint(x, y, rot).map(([cx, cy], i) => `${cx},${cy}:${domino.squares[i].terrain}${domino.squares[i].crowns}`).sort().join(' ');
}

// An independent rules-engine snapshot of the whole kingdom after a move, up to rotation/reflection.
function rotatedKingdomKey(kingdom) {
  const cells = [...kingdom.cells].map(([key, c]) => [...key.split(',').map(Number), c.terrain, c.crowns]);
  const keys = [];
  for (const reflect of [false, true]) {
    let points = cells.map(([x, y, ...rest]) => [reflect ? -x : x, y, ...rest]);
    for (let r = 0; r < 4; r++) {
      keys.push(points.map(([x, y, terrain, crowns]) => `${x},${y}:${terrain}${crowns}`).sort().join(' '));
      points = points.map(([x, y, ...rest]) => [-y, x, ...rest]);
    }
  }
  return keys.sort()[0];
}

for (const size of [5, 7]) {
  test(`search groups only equivalent placements on ${size}×${size} kingdoms, before capping`, () => {
    for (const placements of [[], [{ id: 3, x: 1, y: 0, rot: 0 }],
      [{ id: 13, x: 1, y: 0, rot: 0 }, { id: 13, x: 0, y: 1, rot: 1 }]]) {
      const kingdom = new Kingdom(size);
      for (const p of placements) kingdom.place(dominoById(p.id), p.x, p.y, p.rot);
      const game = gameFrom({ size, kingdoms: [{ placements, discards: 0 }, { placements: [], discards: 0 }],
        seen: [], left: 0, phase: 'place', line: [32, 40], own: [0, 1], idx: 0 });
      const groups = game.moveGroups(game.legal(0)), d = dominoById(32);
      const expected = new Set(kingdom.validPlacements(d).map((v) => {
        const after = kingdom.clone(); after.place(d, v.x, v.y, v.rot);
        return rotatedKingdomKey(after);
      }));
      const actual = [];
      for (const [rep, equivalent] of groups) {
        const outcomes = equivalent.map((m) => {
          const v = moveOut(game, m), after = kingdom.clone();
          assert.ok(kingdom.canPlace(d, v.x, v.y, v.rot));
          after.place(d, v.x, v.y, v.rot);
          return rotatedKingdomKey(after);
        });
        assert.equal(new Set(outcomes).size, 1, 'every grouped move leaves an equivalent whole kingdom');
        assert.ok(equivalent.includes(rep), 'the representative is a legal member');
        actual.push(outcomes[0]);
      }
      assert.deepEqual(new Set(actual), expected);
      assert.equal(actual.length, expected.size, 'equivalent branches are searched just once');
      assert.equal([...groups.values()].reduce((n, g) => n + g.length, 0), game.legal(0).length);
      assert.equal(game.legal(3, new Int32Array(1024), true).length, Math.min(3, expected.size));
    }
    const game = gameFrom({ size, kingdoms: [{ placements: [], discards: 0 }, { placements: [], discards: 0 }],
      seen: [], left: 0, phase: 'place', line: [3, 40], own: [0, 1], idx: 0 });
    assert.equal(game.moveGroups(game.legal()).size, 2, 'identical halves leave only straight and alongside');
    game.phase = PICK; game.nextLine = new Int8Array([2, 3, 4, 5]); game.nextOwn = new Int8Array(4).fill(-1);
    assert.deepEqual([...game.moveGroups(game.legal()).values()], [[0], [1], [2], [3]], 'draft slots stay distinct');
    game.phase = PLACE;
    assert.deepEqual([...game.moveGroups([DISCARD]).values()], [[DISCARD]], 'discard stays a single move');
  });
}

test('terrain and crown differences in an existing kingdom prevent false symmetry', () => {
  // The same occupied outline: two arms along the positive axes. Diagonal reflection only works
  // when both their terrain and their crowns match.
  for (const second of [14, 19]) {
    const game = gameFrom({ size: 5, kingdoms: [{ placements: [{ id: 13, x: 1, y: 0, rot: 0 },
      { id: second, x: 0, y: 1, rot: 1 }], discards: 0 }, { placements: [], discards: 0 }],
      seen: [], left: 0, phase: 'place', line: [32, 40], own: [0, 1], idx: 0 });
    const groups = game.moveGroups(game.legal());
    assert.ok(groups.size > 4);
    assert.ok([...groups.values()].every((g) => g.length === 1), `domino ${second} breaks the reflection`);
  }
});

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
