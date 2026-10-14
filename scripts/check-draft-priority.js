// Audit actual benchmark drafts against the public domino definitions and legal table options.
// Usage: node scripts/check-draft-priority.js benchmarks/draft-priority-2026-10-14
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { dealTable, playTurns } from '../src/core/table.js';
import { dominoById } from '../src/core/rules.js';
import { decodeMove } from '../src/core/moves.js';

const folder = process.argv[2];
assert.ok(folder, 'provide a completed benchmark folder');
const signature = (id) => dominoById(id).squares.map((s) => `${s.terrain}:${s.crowns}`).sort().join('|');
const audit = {};
for (const mode of ['standard', 'bonuses', 'duel', 'three']) {
  const path = resolve(folder, `${mode}.jsonl`);
  if (!existsSync(path)) continue;
  const rows = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
  const meta = rows[0], games = rows.filter((r) => r.type === 'game');
  assert.equal(rows.at(-1).type, 'complete');
  assert.equal(rows.at(-1).games, games.length);
  const count = { old: { drafts: 0, duplicateChoices: 0, laterCopies: 0 }, new: { drafts: 0, duplicateChoices: 0, laterCopies: 0 } };
  for (const saved of games) {
    const table = dealTable({ ...meta.rules, seed: saved.dealSeed }), turns = playTurns(table);
    let step = turns.next();
    for (const encoded of saved.moves) {
      const d = step.value, m = decodeMove(encoded), role = saved.roles[m.seat];
      if (m.kind === 'select' && role !== 'hard' && !(d.phase === 'open' && meta.rules.snake)) {
        const chosen = d.options.find((s) => s.index === m.value), s = count[role];
        const copies = d.options.filter((q) => signature(q.domino.id) === signature(chosen.domino.id));
        s.drafts++;
        if (copies.length > 1) {
          s.duplicateChoices++;
          if (copies.some((q) => q.index < m.value)) s.laterCopies++;
        }
      }
      step = turns.next(m.value);
    }
    assert.equal(step.done, true);
  }
  assert.equal(count.new.laterCopies, 0, `${mode}: new Expert gave up a free earlier identical copy`);
  audit[mode] = { games: games.length, ...count };
}
assert.ok(Object.keys(audit).length, 'no benchmark game files found');
writeFileSync(resolve(folder, 'draft-policy-audit.json'), JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify(audit, null, 2));
