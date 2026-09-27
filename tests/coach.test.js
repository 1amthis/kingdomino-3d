// The coach's analysis covers every legal move with sound numbers, and its grades follow from them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dominoById } from '../src/core/rules.js';
import { Search } from '../src/core/search/mcts.js';
import { gameFrom, analysisOut } from '../src/core/search/state.js';
import { judge, tally, placementKey, GRADES } from '../src/core/coach.js';
import { playGame } from '../scripts/headless.js';

// Real positions from an expert game: every decision, as the table stood (copied, since it lives on).
function positions(setup, every = 3) {
  const out = [];
  let i = 0;
  playGame({ ...setup, budget: { sims: 60, ms: 1000 }, onDecision: (table, move, domino) => {
    if (i++ % every === 0) out.push({ table: JSON.parse(JSON.stringify(table)), domino });
  } });
  return out;
}

const analyse = (table, budget = { sims: 400, ms: 2000, min: 8 }) => {
  const game = gameFrom(table);
  return { game, a: analysisOut(game, new Search({ seed: 7 }).analyse(game, budget)) };
};

test('the analysis covers every legal move once, best first, with sound numbers', () => {
  for (const setup of [{ types: ['expert', 'hard'], seed: 3 }, { types: ['expert', 'hard', 'normal'], seed: 4, middleKingdom: true }]) {
    for (const { table } of positions(setup)) {
      const { game, a } = analyse(table);
      const legal = game.legal(0);
      if (legal.length < 2) continue;
      assert.equal(a.moves.length, legal.length, 'one entry per legal move');
      assert.equal(new Set(a.moves.map((m) => JSON.stringify(m.move))).size, a.moves.length, 'no move twice');
      assert.equal(a.player, game.player);
      for (let i = 0; i < a.moves.length; i++) {
        const m = a.moves[i];
        assert.ok(m.visits >= 8, 'every move is tried at least `min` times');
        assert.ok(m.win >= 0 && m.win <= 1 && m.value >= 0 && m.value <= 1, 'win rate and value are shares');
        assert.ok(Math.abs(m.ev) < 150, 'the lead is a point margin');
        if (i) assert.ok(a.moves[i - 1].visits >= m.visits, 'ranked by visits');
      }
    }
  }
});

test('picks report where the Expert would lay the domino', () => {
  let picks = 0, spots = 0;
  for (const { table } of positions({ types: ['expert', 'hard'], seed: 5 }, 1)) {
    if (table.phase === 'place') continue;
    const own = table.phase === 'open' ? table.own : table.nextOwn;
    if (own.filter((o) => o < 0).length < 2) continue;
    const { a } = analyse(table, { sims: 1500, ms: 3000, min: 8 });
    picks++;
    for (const m of a.moves) {
      if (!m.land) continue;
      spots++;
      assert.ok(Number.isInteger(m.land.x) && Number.isInteger(m.land.y) && m.land.rot >= 0 && m.land.rot < 4);
    }
  }
  assert.ok(picks > 0 && spots > 0, `picks ${picks}, landing spots ${spots}`);
});

test('grades follow the points given up against the best move', () => {
  const { table, domino } = positions({ types: ['expert', 'hard'], seed: 6 }, 1).find((p) => p.table.phase === 'place');
  const { a } = analyse(table);
  const best = a.moves[0];
  assert.deepEqual(judge(a, best.move, domino), { grade: 'Best', loss: 0, stats: best, best });
  for (const m of a.moves.slice(1)) {
    const v = judge(a, m.move, domino);
    const loss = Math.max(0, best.ev - m.ev);
    assert.equal(v.loss, loss);
    assert.equal(v.grade, GRADES.find(([most]) => loss <= most)[1]);
  }
});

test('both ways of laying a domino with identical halves get the same verdict', () => {
  const d = dominoById(3); // forest | forest
  assert.equal(placementKey(d, { x: 1, y: 0, rot: 0 }), placementKey(d, { x: 2, y: 0, rot: 2 }));
  assert.notEqual(placementKey(dominoById(19), { x: 1, y: 0, rot: 0 }), placementKey(dominoById(19), { x: 2, y: 0, rot: 2 }));
  const a = { moves: [{ move: { x: 1, y: 0, rot: 0 }, visits: 10, ev: 2 }, { move: { x: 0, y: 1, rot: 1 }, visits: 5, ev: 0 }] };
  assert.equal(judge(a, { x: 2, y: 0, rot: 2 }, d).grade, 'Best');
  assert.equal(judge(a, { x: 0, y: 2, rot: 3 }, d).grade, 'Good');
});

test('a game of grades sums up', () => {
  const t = tally([{ grade: 'Best', loss: 0, hinted: false }, { grade: 'Mistake', loss: 6, hinted: true }, { grade: 'Good', loss: 1.5, hinted: false }]);
  assert.equal(t.decisions, 3);
  assert.equal(t.loss, 2.5);
  assert.equal(t.hints, 1);
  assert.deepEqual(t.counts, { Best: 1, Excellent: 0, Good: 1, Inaccuracy: 0, Mistake: 1, Blunder: 0 });
});
