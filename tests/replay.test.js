// A finished game plays back move by move from its record, and the coach's review grades the people's
// moves from the very positions they faced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, cleanRecord, statsFor } from '../src/core/history.js';
import { replayable, replayRecord } from '../src/core/replay.js';
import { reviewedSeats, reviewPlan, markMove, reviewVerdicts, gradeOf, isPoor } from '../src/core/review.js';
import { judge } from '../src/core/coach.js';
import { dominoById } from '../src/core/rules.js';
import { isAction } from '../src/core/moves.js';
import { Search } from '../src/core/search/mcts.js';
import { gameFrom, analysisOut } from '../src/core/search/state.js';
import { playGame } from '../scripts/headless.js';

const COLORS = ['#e2558f', '#f2c230', '#4fb34f', '#3f7fdb'];

// A finished game as the history keeps it. seats: [{ name, type, remote? }]; a person plays like `as`.
function record(seats, { seed = 9, as = 'hard', mightyDuel = false, snake = false, ...rest } = {}) {
  const rules = { middleKingdom: true, harmony: true, mightyDuel, snake };
  const played = playGame({ types: seats.map((s) => (s.type === 'human' ? as : s.type)), seed, ...rules, ...rest });
  played.players.forEach((p, i) => Object.assign(p, seats[i], { color: COLORS[i], crest: i }));
  const config = { seats: seats.map((s) => ({ ...s })), ...rules };
  const r = makeRecord({ players: played.players, rows: played.ranking, config, seed, moves: played.moves, start: 1000, end: 2000 });
  return { r: cleanRecord(JSON.parse(JSON.stringify(r))), played };
}

const analyse = (table) => analysisOut(gameFrom(table), new Search({ seed: 3 }).analyse(gameFrom(table), { sims: 300, ms: 2000, min: 6 }));

test('a record plays back move by move, to the very kingdoms it ended with', () => {
  for (const [seats, opts] of [
    [[{ name: 'You', type: 'human' }, { name: 'Ann', type: 'normal' }], {}],
    [[{ name: 'You', type: 'human' }, { name: 'Bo', type: 'hard' }], { mightyDuel: true }],
    [[{ name: 'You', type: 'human' }, { name: 'Ann', type: 'easy' }, { name: 'Bo', type: 'normal' }], {}],
    [[{ name: 'You', type: 'human' }, { name: 'Ann', type: 'easy' }, { name: 'Bo', type: 'normal' }, { name: 'Cy', type: 'hard' }], { seed: 4 }],
    [[{ name: 'You', type: 'human' }, { name: 'Ann', type: 'easy' }, { name: 'Bo', type: 'normal' }, { name: 'Cy', type: 'hard' }], { seed: 4, snake: true }],
  ]) {
    const { r, played } = record(seats, opts);
    assert.ok(replayable(r));
    const { frames, turns, rounds } = replayRecord(r);
    const n = seats.length;
    assert.equal(turns.length, r.moves.length);
    assert.equal(frames.length, r.moves.length + 1);
    assert.equal(rounds, n === 2 && !opts.mightyDuel ? 6 : 12);
    // dealt: nobody has played, the opening line is out, and someone opens the draft
    const first = frames[0];
    assert.equal(first.round, 0);
    assert.deepEqual(first.kingdoms.map((k) => k.placements.length), seats.map(() => 0));
    assert.equal(first.next.length, 4);
    assert.ok(first.next.every((s) => s.seat === -1));
    assert.ok(first.mover >= 0);
    // the rounds come one after another, and the game ends with nobody to move
    assert.deepEqual([...new Set(frames.map((f) => f.round))], Array.from({ length: rounds + 1 }, (_, i) => i));
    const last = frames[frames.length - 1];
    assert.equal(last.mover, -1);
    assert.equal(last.left, 0);
    played.players.forEach((p, i) => {
      assert.deepEqual(last.kingdoms[i].placements, p.kingdom.placements);
      assert.equal(last.kingdoms[i].score, r.players[i].total);
    });
    assert.equal(last.unclaimed.length, n === 3 ? 12 : 0, 'three players leave a domino a line');
    // every move names its domino and how many moves were open, and each pick knows its line
    for (const [k, t] of turns.entries()) {
      assert.equal(t.seat, Number(r.moves[k][0]));
      assert.ok(t.id >= 1 && t.id <= 48 && t.choices >= (t.value === null ? 0 : 1));
      if (t.kind === 'select') assert.equal(t.line[t.value], t.id);
    }
  }
});

test('the review sees each position exactly as the Expert saw it during the game', () => {
  const seen = [];
  const { r } = record([{ name: 'Ann', type: 'hard' }, { name: 'You', type: 'human' }], {
    seed: 6, as: 'expert', budget: { sims: 40, ms: 1000 },
    onDecision: (table) => seen.push(JSON.parse(JSON.stringify(table))),
  });
  const { turns } = replayRecord(r, { positions: true });
  const mine = turns.filter((t) => t.seat === 1);
  assert.equal(mine.length, seen.length);
  mine.forEach((t, i) => assert.deepEqual(t.table, seen[i], `decision ${i}`));
});

test('a record that does not fit its deal cannot be played back', () => {
  const { r } = record([{ name: 'You', type: 'human' }, { name: 'Ann', type: 'normal' }]);
  assert.throws(() => replayRecord({ ...r, seed: r.seed + 1 }), /out of step|illegal|cannot be picked/);
  assert.throws(() => replayRecord({ ...r, moves: r.moves.slice(0, -1) }), /out of step/);
  assert.throws(() => replayRecord({ ...r, moves: [...r.moves, '0s0'] }), /left over/);
  assert.equal(replayable({ ...r, flow: 99 }), false);
  assert.equal(replayable({ ...r, moves: undefined }), false);
});

test('the review grades the people’s moves, and the verdicts join the stats', () => {
  const { r } = record([{ name: 'You', type: 'human' }, { name: 'Léa', type: 'human', remote: true }, { name: 'Bo', type: 'hard' }], { seed: 12 });
  assert.deepEqual(reviewedSeats(r), [0, 1]);
  const { turns } = replayRecord(r, { positions: true });
  const plan = reviewPlan(r, turns);
  assert.ok(plan.length > 20);
  assert.ok(plan.every((k) => turns[k].seat !== 2 && turns[k].choices > 1), 'not the computer, and only real choices');

  // grade a few moves for real
  const review = {};
  for (const k of plan.filter((_, i) => i % 6 === 0)) {
    const t = turns[k], a = analyse(t.table), mark = markMove(a, t);
    review[k] = mark;
    // a domino with two identical halves can have two valid spots that are one and the same move
    if (!mark) { assert.equal(gameFrom(t.table).legal(0).length, 1, `move ${k}`); continue; }
    const [loss, best] = mark;
    assert.ok(loss >= 0 && isAction(best) && best[0] === (t.kind === 'select' ? 's' : best[0]));
    const v = judge(a, t.value, t.kind === 'place' ? dominoById(t.id) : undefined);
    assert.equal(gradeOf(loss), v.grade, 'the grade follows from the points given up');
    assert.equal(isPoor(loss), ['Inaccuracy', 'Mistake', 'Blunder'].includes(v.grade));
  }
  assert.deepEqual(reviewVerdicts({ ...r, review }, plan, turns), [null, null, null], 'no verdict before every move is graded');

  // the rest, made up: You plays perfectly, Léa gives up 3 points a move
  for (const k of plan) if (!(k in review) || turns[k].seat === 1) review[k] = [turns[k].seat === 0 ? 0 : 3, 's0'];
  const verdicts = reviewVerdicts({ ...r, review }, plan, turns);
  const mine = plan.filter((k) => turns[k].seat === 1).length;
  assert.deepEqual(verdicts[1], { decisions: mine, loss: 3, counts: { Best: 0, Excellent: 0, Good: 0, Inaccuracy: mine, Mistake: 0, Blunder: 0 }, hints: 0 });
  assert.equal(verdicts[2], null);

  // the record keeps all of it, and the stats count the reviewed game for You
  const done = { ...r, review, players: r.players.map((p, i) => (verdicts[i] ? { ...p, verdict: verdicts[i] } : p)) };
  const back = cleanRecord(JSON.parse(JSON.stringify(done)));
  assert.deepEqual(back.review, Object.fromEntries(Object.entries(review).map(([k, v]) => [k, v])));
  assert.deepEqual(back.players[1].verdict, verdicts[1]);
  assert.equal(statsFor([back], 'You').coach.games, 1);
  assert.equal(statsFor([r], 'You').coach, null);

  // junk is dropped: a move beyond the record, a loss out of range, a move that is not one
  const junk = cleanRecord({ ...back, review: { ...back.review, 999: [1, 's0'], [plan[0]]: [-1, 's0'], [plan[1]]: [1, 'x'], [plan[2]]: null } });
  assert.equal(999 in junk.review, false);
  assert.equal(plan[0] in junk.review, false);
  assert.equal(plan[1] in junk.review, false);
  assert.equal(junk.review[plan[2]], null, 'a move the analysis had nothing on stays known');
  assert.equal(cleanRecord({ ...back, moves: undefined }).review, undefined, 'no moves, no review');
});

test('a game with the snake opening keeps its rule and plays back in its order', () => {
  const seats = [{ name: 'You', type: 'human' }, { name: 'Ann', type: 'easy' }, { name: 'Bo', type: 'normal' }, { name: 'Cy', type: 'hard' }];
  const { r } = record(seats, { seed: 6, snake: true });
  assert.equal(r.rules.snake, true);
  const { turns, frames } = replayRecord(r);
  // the opening draft's order, then the first round's lays in reverse
  const opening = turns.filter((t) => t.phase === 'open').map((t) => t.seat);
  const firstLays = turns.filter((t) => t.kind === 'place').slice(0, 4).map((t) => t.seat);
  assert.deepEqual(firstLays, opening.slice().reverse());
  // the board still shows each line in number order
  for (const f of frames) for (const line of [f.current, f.next]) assert.deepEqual(line.map((s) => s.id), line.map((s) => s.id).sort((a, b) => a - b));
});
