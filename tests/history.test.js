// The history keeps every finished game as plain data, reads back only sound records (from storage or a
// file), and its stats count each game from the right person's side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, cleanRecord, decodeMap, parseExport, GameLog, KEEP, profiles, statsFor, highlights } from '../src/core/history.js';
import { playGame } from '../scripts/headless.js';

// A real finished game, seated as the menu would seat it.
function realGame(seats, { seed = 5, middleKingdom = true, harmony = true } = {}) {
  const { players, ranking } = playGame({ types: seats.map((s) => (s.type === 'human' ? 'hard' : s.type)), seed, middleKingdom, harmony });
  players.forEach((p, i) => Object.assign(p, seats[i], { color: ['#e2558f', '#f2c230', '#4fb34f', '#3f7fdb'][i], crest: i }));
  const config = { seats: seats.map((s) => ({ ...s })), middleKingdom, harmony, mightyDuel: false };
  return { players, ranking, config };
}

// A memory stand-in for localStorage; `room` (characters) makes it refuse big writes like a full one.
function memoryStorage(room = Infinity) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (v.length > room) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
  };
}

// A hand-made game: players as [name, kind, place, total], plus any extra fields.
let clock = Date.UTC(2026, 9, 1);
function game(players, extra = {}) {
  clock += 60000;
  return cleanRecord({
    v: 1, id: `g${clock.toString(36)}`, end: clock, start: clock - 1200000,
    rules: { middleKingdom: true, harmony: true, mightyDuel: false },
    players: players.map(([name, kind, place, total, more = {}]) => ({ name, kind, place, total, color: '#e2558f', crest: 0, crowns: 0, largest: 0, props: [], map: [], ...more })),
    ...extra,
  });
}

test('a finished game becomes a record that reads back unchanged', () => {
  const { players, ranking, config } = realGame([
    { name: 'You', type: 'human' }, { name: 'Lady Aveline', type: 'normal' }, { name: 'Baron Ulric', type: 'hard' },
  ]);
  const verdict = { decisions: 30, loss: 2.4, counts: { Best: 10, Good: 15, Blunder: 5 }, hints: 1 };
  const rec = makeRecord({ players, rows: ranking, config, seed: 5, coach: 'trainer', verdict, start: 1000, end: 2000 });
  assert.deepEqual(cleanRecord(JSON.parse(JSON.stringify(rec))), rec, 'nothing is lost on the way through JSON and back');
  assert.deepEqual(rec.players.map((p) => p.kind), ['here', 'normal', 'hard']);
  for (const p of players) {
    const r = rec.players[p.index], row = ranking.find((x) => x.player === p);
    assert.equal(r.total, row.s.total);
    assert.equal(r.place, row.place);
    assert.equal(r.props.reduce((a, [, size, crowns]) => a + size * crowns, 0) + r.middle + r.harmony, r.total, 'the properties add up to the score');
    // the map holds the kingdom square for square, the castle included
    const cells = decodeMap(r.map).flat();
    assert.equal(cells.filter(Boolean).length, p.kingdom.cells.size);
    assert.equal(decodeMap(r.map)[-p.kingdom.minY][-p.kingdom.minX].terrain, 'castle');
    assert.equal(cells.reduce((a, c) => a + (c ? c.crowns : 0), 0), [...p.kingdom.cells.values()].reduce((a, c) => a + c.crowns, 0));
  }
});

test('online seats: friends, and a friend who left mid-game', () => {
  const { players, ranking, config } = realGame([
    { name: 'Host', type: 'human' }, { name: 'Léa', type: 'human', remote: true }, { name: 'Tom', type: 'human', remote: true },
  ]);
  players[2].type = 'normal'; // Tom left: the AI finished his kingdom
  const rec = makeRecord({ players, rows: ranking, config, online: 'host' });
  assert.deepEqual(rec.players.map((p) => [p.kind, !!p.left]), [['here', false], ['friend', false], ['friend', true]]);
});

test('only sound records are read back, and names are made safe', () => {
  const ok = game([['You', 'here', 1, 40], ['Ann', 'easy', 2, 20]]);
  assert.ok(ok);
  const bad = [
    null, 'x', { ...ok, v: 2 }, { ...ok, id: '<script>' }, { ...ok, end: 'yesterday' },
    { ...ok, players: [ok.players[0]] }, { ...ok, players: [ok.players[0], { ...ok.players[1], kind: 'god' }] },
    { ...ok, players: [ok.players[0], { ...ok.players[1], total: -3 }] },
  ];
  for (const r of bad) assert.equal(cleanRecord(r), null, JSON.stringify(r));
  const odd = cleanRecord({ ...ok, players: [{ ...ok.players[0], name: '<b>Eve</b>\u0007', color: 'red', map: ['W1F0', 'C0'], props: [['castle', 1, 1], ['forest', 3, 2]] }, ok.players[1]] });
  assert.equal(odd.players[0].name, 'bEve/b');
  assert.equal(odd.players[0].color, '#999999');
  assert.deepEqual(odd.players[0].map, [], 'ragged rows are dropped');
  assert.deepEqual(odd.players[0].props, [['forest', 3, 2]]);
});

test('the log in storage: adds, merges imports once, trims, survives a full storage', () => {
  const log = new GameLog(memoryStorage());
  assert.deepEqual(log.all(), []);
  const a = game([['You', 'here', 1, 40], ['Ann', 'easy', 2, 20]]), b = game([['You', 'here', 2, 30], ['Bo', 'hard', 1, 50]]);
  assert.ok(log.save(b));
  assert.ok(log.save(a));
  assert.deepEqual(log.all().map((g) => g.id), [a.id, b.id], 'oldest first');
  // the coach's late grades come as a newer copy of the same game
  assert.ok(log.save({ ...a, coach: 'trainer', verdict: { decisions: 3, loss: 1, counts: { Best: 3 }, hints: 0 } }));
  assert.equal(log.all().length, 2);
  assert.equal(log.all()[0].verdict.decisions, 3);

  // an export goes into another browser's history, and a second import adds nothing
  const other = new GameLog(memoryStorage());
  other.save(game([['Mia', 'here', 1, 33], ['Ann', 'normal', 2, 12]]));
  const games = parseExport(log.exportText());
  assert.deepEqual(other.merge(games), { added: 2, known: 0, ok: true });
  assert.deepEqual(other.merge(games), { added: 0, known: 2, ok: true });
  assert.equal(other.all().length, 3);
  assert.throws(() => parseExport('not json'), /not a Kingdomino history/);
  assert.throws(() => parseExport('{"games":[{"v":1}]}'), /could be read/);

  // beyond KEEP games the oldest go; a storage that is full drops the oldest until the rest fit
  const many = Array.from({ length: KEEP + 5 }, () => game([['You', 'here', 1, 40], ['Ann', 'easy', 2, 20]]));
  const big = new GameLog(memoryStorage());
  big.write(many.slice());
  assert.equal(big.all().length, KEEP);
  assert.equal(big.all()[0].id, many[5].id);
  const tight = new GameLog(memoryStorage(60000));
  assert.ok(tight.write(many.slice(0, 400)));
  const kept = tight.all();
  assert.ok(kept.length > 8 && kept.length < 400);
  assert.equal(kept[kept.length - 1].id, many[399].id, 'the newest games stay');
  log.clear();
  assert.deepEqual(log.all(), []);
});

test('stats count each game from the right side of the table', () => {
  const records = [
    game([['You', 'here', 1, 52], ['Easy Ed', 'easy', 2, 20], ['Hal', 'hard', 3, 18]]),
    game([['Host', 'here', 2, 40], ['Léa', 'friend', 1, 61], ['Ned', 'normal', 3, 30]], { online: 'host' }),
    game([['you', 'here', 1, 45, { middle: 10, props: [['forest', 6, 3]] }], ['Xa', 'expert', 2, 44]]),
    game([['You', 'here', 1, 47], ['Léa', 'here', 1, 47, { crowns: 9 }], ['Tom', 'friend', 2, 10, { left: true }]]),
    game([['Mia', 'here', 1, 70], ['Xa', 'expert', 2, 60]]),
    game([['Bot A', 'hard', 1, 50], ['Bot B', 'normal', 2, 40]]),
  ];
  assert.deepEqual(profiles(records).map((p) => [p.name, p.games]), [['You', 4], ['Mia', 1], ['Léa', 1]], 'most games first, then the latest');

  const s = statsFor(records, 'Host');
  assert.equal(s.name, 'You', '"You", "you" and "Host" are one person');
  assert.equal(s.games, 4);
  assert.equal(s.wins, 3, 'a shared first place is a win');
  assert.equal(s.average, (52 + 40 + 45 + 47) / 4);
  assert.deepEqual(s.best, { total: 52, end: records[0].end, id: records[0].id });
  assert.deepEqual(s.streak, { current: 2, best: 2 });
  assert.deepEqual(s.levels.map((l) => [l.level, l.won, l.lost, l.tied]), [['easy', 1, 0, 0], ['normal', 1, 0, 0], ['hard', 1, 0, 0], ['expert', 1, 0, 0]]);
  assert.deepEqual(s.people.map((p) => [p.name, p.games, p.won, p.lost, p.tied]), [['Léa', 2, 0, 1, 1]], 'a friend who left does not count');
  assert.deepEqual(s.middle, { got: 1, of: 4 });
  assert.deepEqual(s.richest && [s.richest.terrain, s.richest.score], ['forest', 18]);
  assert.equal(s.coach, null);
  assert.equal(statsFor(records, 'Léa').mostCrowns.crowns, 9);
  assert.equal(statsFor(records, 'Nobody').games, 0);
});

test('the coach stats weigh every move once, and compare the last five games with the ones before', () => {
  const v = (decisions, loss) => ({ decisions, loss, counts: { Best: decisions - 1, Mistake: 1 }, hints: 0 });
  const records = [
    game([['You', 'here', 1, 40], ['A', 'expert', 2, 30]], { coach: 'trainer', verdict: v(10, 4) }),
    game([['You', 'here', 2, 40], ['A', 'expert', 1, 50]], { coach: 'trainer', verdict: v(30, 2) }),
    game([['You', 'here', 2, 40], ['A', 'expert', 1, 50]]),
  ];
  const c = statsFor(records, 'You').coach;
  assert.equal(c.games, 2);
  assert.equal(c.decisions, 40);
  assert.equal(c.loss, (10 * 4 + 30 * 2) / 40);
  assert.deepEqual(c.counts, { Best: 38, Mistake: 2 });
  assert.equal(c.recent, null, 'too few games to compare');
  for (let i = 0; i < 5; i++) records.push(game([['You', 'here', 1, 40], ['A', 'expert', 2, 30]], { coach: 'study', verdict: v(20, 1) }));
  const d = statsFor(records, 'You').coach;
  assert.equal(d.recent.loss, 1);
  assert.equal(d.earlier.games, 2);
});

test('highlights: a new personal best, and a first win over the Expert', () => {
  const past = [game([['You', 'here', 2, 50], ['A', 'expert', 1, 55]]), game([['You', 'here', 1, 48], ['B', 'hard', 2, 20]])];
  const first = game([['Mia', 'here', 1, 30], ['A', 'normal', 2, 20]]);
  assert.deepEqual(highlights([], first), [], 'no best on a first game');
  const win = game([['You', 'here', 1, 51], ['A', 'expert', 2, 49]]);
  assert.deepEqual(highlights([...past, win], win), [{ type: 'expert', name: 'You' }, { type: 'best', name: 'You', total: 51, previous: 50 }]);
  const again = game([['You', 'here', 1, 40], ['A', 'expert', 2, 39]]);
  assert.deepEqual(highlights([...past, win, again], again), [], 'only the first win over the Expert stands out');
});
