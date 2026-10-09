// The Dynasty: three games at the same table, their scores added up. It travels with each game (saved,
// resumed, dealt online), and the history keeps its games together and counts the dynasties won.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES, newDynasty, gameNumber, isOver, addGame, nextDynasty, standings, cleanDynasty } from '../src/core/dynasty.js';
import { makeRecord, cleanRecord, dynastyOf, statsFor } from '../src/core/history.js';
import { cleanSaved, FLOW } from '../src/core/moves.js';
import { HostSession, GuestSession } from '../src/net/online.js';
import { playGame } from '../scripts/headless.js';

const COLORS = ['#e2558f', '#f2c230', '#4fb34f', '#3f7fdb'];
const SEATS = [{ name: 'You', type: 'human' }, { name: 'Lady Aveline', type: 'normal' }, { name: 'Baron Ulric', type: 'hard' }]
  .map((s, i) => ({ ...s, color: COLORS[i], crest: i }));
const RULES = { middleKingdom: true, harmony: true };

// A dynasty played out with the rules alone, as the menu would seat it: each game's record and the
// dynasty after each game.
function playDynasty(seeds = [3, 4, 5]) {
  let d = newDynasty();
  const records = [], states = [];
  seeds.forEach((seed, k) => {
    const config = { seats: SEATS.map((s) => ({ ...s })), ...RULES, mightyDuel: false, dynasty: d };
    const { players, ranking } = playGame({ types: SEATS.map((s) => (s.type === 'human' ? 'hard' : s.type)), seed, ...RULES });
    players.forEach((p, i) => Object.assign(p, SEATS[i]));
    records.push(makeRecord({ players, rows: ranking, config, seed, end: Date.UTC(2026, 9, 9, 20, k) }));
    d = addGame(d, players.map((p) => p.kingdom.score(RULES)));
    states.push(d);
  });
  return { records, states };
}

// One game's scores, seat by seat: [total, largest, crowns]
const game = (...seats) => seats.map(([total, largest, crowns]) => ({ total, largest, crowns }));

test('a dynasty plays three games, adds their scores up, then makes way for a new one', () => {
  const { records, states } = playDynasty();
  const d = states[GAMES - 1];
  assert.deepEqual(states.map(gameNumber), [2, 3, 4]);
  assert.deepEqual(states.map(isOver), [false, false, true]);
  assert.deepEqual(records.map((r) => r.dynasty), [1, 2, 3].map((game) => ({ id: d.id, game })), 'every game carries its number');

  const table = standings(d);
  for (const row of table) {
    assert.deepEqual(row.games, records.map((r) => r.players[row.seat].total));
    assert.equal(row.s.total, row.games.reduce((a, b) => a + b, 0));
  }
  assert.deepEqual(table.map((r) => r.s.total), table.map((r) => r.s.total).sort((a, b) => b - a), 'best first');
  assert.equal(table[0].place, 1);

  // playing again: the next game of the dynasty, a new dynasty once it is over, or a game on its own
  assert.equal(nextDynasty(states[0]), states[0]);
  const fresh = nextDynasty(d);
  assert.notEqual(fresh.id, d.id);
  assert.deepEqual(fresh.games, []);
  assert.equal(nextDynasty(null), null);
});

test('a tie on points goes to the largest properties, then the crowns, over the games', () => {
  // 70 points each; seats 0 and 1 also have 14 squares of largest property and 11 crowns, seat 2 has 13 and 13
  const d = { id: 'd1', games: [game([40, 8, 6], [40, 9, 6], [45, 7, 9]), game([30, 6, 5], [30, 5, 5], [25, 6, 4])] };
  const table = standings(d);
  assert.deepEqual(table.map((r) => r.s), [{ total: 70, largest: 14, crowns: 11 }, { total: 70, largest: 14, crowns: 11 }, { total: 70, largest: 13, crowns: 13 }]);
  assert.deepEqual(table.map((r) => [r.seat, r.place]), [[0, 1], [1, 1], [2, 3]], 'level on points: the larger properties win; level on both: a shared place');
  const crowns = standings({ id: 'd2', games: [game([50, 10, 7], [50, 10, 8])] });
  assert.deepEqual(crowns.map((r) => [r.seat, r.place]), [[1, 1], [0, 2]], 'then the crowns');
});

test('a dynasty in progress travels with the saved game and the online deal, when sound', () => {
  const d = { id: 'dk2x-ab12cd', games: [game([40, 8, 6], [31, 6, 5])] };
  assert.deepEqual(cleanDynasty(d, 2), d);
  const bad = [
    null, 'd', { ...d, id: '<b>' }, { ...d, games: 'x' }, { ...d, games: [game([40, 8, 6])] },
    { ...d, games: [game([40, 8, 6], [-1, 6, 5])] }, { ...d, games: [game([40, 8, 6], [31, 60, 5])] },
    { ...d, games: Array(GAMES).fill(d.games[0]) }, // over: nothing left to play
  ];
  for (const x of bad) assert.equal(cleanDynasty(x, 2), null, JSON.stringify(x));

  // a saved game keeps its dynasty, and one without keeps none
  const seats = SEATS.slice(0, 2);
  const saved = { v: 1, flow: FLOW, config: { seats, seed: 7, middleKingdom: true, harmony: false, mightyDuel: false, snake: false, dynasty: d }, start: 1, moves: [], coach: [] };
  assert.deepEqual(cleanSaved(saved).config.dynasty, d);
  assert.equal('dynasty' in cleanSaved({ ...saved, config: { ...saved.config, dynasty: null } }).config, false);
  assert.equal('dynasty' in cleanSaved({ ...saved, config: { ...saved.config, dynasty: { ...d, games: [game([1, 1, 1])] } } }).config, false, 'a dynasty that does not fit the table is let go');

  // the host deals it to every guest; a guest's table takes it as the host's
  const host = new HostSession({ seats: seats.map((s) => ({ ...s })), middleKingdom: true, dynasty: newDynasty() });
  assert.deepEqual(host.start(d).dynasty, d, 'the next game of the dynasty');
  assert.deepEqual(host.start().dynasty, host.config.dynasty, 'the first game, from the menu');
  assert.equal(host.start(null).dynasty, null);
  const guest = new GuestSession('abcd');
  assert.deepEqual(guest.mirror({ config: host.start(d), you: 1 }).dynasty, d);
  assert.equal(guest.mirror({ config: { ...host.start(d), dynasty: { ...d, id: 'no way' } }, you: 1 }).dynasty, null);
});

test('the history keeps a dynasty’s games together and counts the dynasties won', () => {
  const { records, states } = playDynasty();
  const d = states[GAMES - 1];
  const kept = records.map((r) => cleanRecord(JSON.parse(JSON.stringify(r))));
  assert.deepEqual(kept, records, 'the dynasty tag reads back unchanged');
  assert.equal(cleanRecord({ ...records[0], dynasty: { id: d.id, game: 4 } }).dynasty, undefined);
  assert.equal(cleanRecord({ ...records[0], dynasty: { id: '<i>', game: 1 } }).dynasty, undefined);

  const other = cleanRecord({ ...records[0], id: 'lone-game', dynasty: undefined });
  const all = [other, ...kept];
  const found = dynastyOf(all, d.id);
  assert.ok(found.complete);
  assert.deepEqual(found.games.map((r) => r.id), records.map((r) => r.id));
  assert.deepEqual(found.standings.map((r) => [r.seat, r.s.total, r.place]), standings(d).map((r) => [r.seat, r.s.total, r.place]));
  assert.equal(dynastyOf(all, 'nobody'), null);

  // stats: a dynasty counts once, played to the end, from the seat of the person at this screen
  const you = standings(d).find((r) => r.seat === 0);
  assert.deepEqual(statsFor(all, 'You').dynasties, { won: you.place === 1 ? 1 : 0, of: 1 });
  assert.equal(statsFor(all, 'You').games, 4, 'each of its games still counts as a game');

  // without its first game (trimmed from the history), or its last (still to be played), it is not complete
  const gap = dynastyOf(kept.slice(1), d.id);
  assert.equal(gap.games[0], null);
  assert.equal(gap.complete, false);
  assert.deepEqual(gap.standings.map((r) => r.games.length), [2, 2, 2]);
  assert.deepEqual(statsFor(kept.slice(0, 2), 'You').dynasties, { won: 0, of: 0 });
});
