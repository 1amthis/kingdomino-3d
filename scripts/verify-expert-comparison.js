// Replays saved benchmark actions through the rules engine and checks every persisted final result.
// Usage: node scripts/verify-expert-comparison.js benchmarks/symmetry-2026-10-14/*.jsonl
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dealTable, playTurns } from '../src/core/table.js';
import { decodeMove } from '../src/core/moves.js';
import { rank } from '../src/core/rules.js';

const paths = process.argv.slice(2);
assert.ok(paths.length, 'provide one or more completed JSONL files');
for (const path of paths) {
  const records = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
  const meta = records[0], completed = records.at(-1), games = records.filter((r) => r.type === 'game');
  assert.equal(meta.type, 'metadata');
  assert.equal(completed.type, 'complete', `${path}: incomplete run`);
  assert.equal(games.length, completed.games);
  assert.equal(games.length, meta.deals * meta.rules.players * (meta.rules.players - 1));
  for (const saved of games) {
    const table = dealTable({ ...meta.rules, seed: saved.dealSeed });
    const turns = playTurns(table);
    let step = turns.next();
    for (const encoded of saved.moves) {
      assert.equal(step.done, false);
      const move = decodeMove(encoded), d = step.value;
      assert.equal(move.seat, d.player.index);
      assert.equal(move.kind, d.kind);
      step = turns.next(move.value); // checks placement/draft/discard legality independently of saved scores
    }
    assert.equal(step.done, true);
    const ranking = rank(table.players, table.opts);
    const a = ranking.find((r) => r.player.index === saved.newSeat), b = ranking.find((r) => r.player.index === saved.oldSeat);
    assert.equal(a.s.total, saved.scoreNew);
    assert.equal(b.s.total, saved.scoreOld);
    assert.equal(a.s.total - b.s.total, saved.margin);
    assert.equal(a.place, saved.rankNew);
    assert.equal(b.place, saved.rankOld);
    assert.equal(saved.result, a.place < b.place ? 'win' : a.place > b.place ? 'loss' : 'tie');
    if (meta.oldRevision === meta.newRevision) {
      const inverse = games.find((g) => g.dealSeed === saved.dealSeed && g.newSeat === saved.oldSeat && g.oldSeat === saved.newSeat);
      assert.deepEqual(saved.moves, inverse.moves, 'same-version control must be label-independent');
      assert.equal(saved.margin, -inverse.margin);
    }
  }
  console.log(`${path}: replayed and verified ${games.length} games`);
}
