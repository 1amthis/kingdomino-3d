// Achievements are read from the history alone: each one is earned by the game that first met it, counts
// only the person's own seat, and the game just played says what it earned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRecord, makeRecord } from '../src/core/history.js';
import { ACHIEVEMENTS, GROUPS, achievementsFor, newAchievements } from '../src/core/achievements.js';
import { playGame } from '../scripts/headless.js';

// A hand-made game: players as [name, kind, place, total, more fields], plus any extra fields.
let clock = Date.UTC(2026, 9, 1);
function game(players, extra = {}) {
  clock += 60000;
  return cleanRecord({
    v: 1, id: `g${clock.toString(36)}`, end: clock, start: clock - 1200000,
    rules: { middleKingdom: false, harmony: false, mightyDuel: false },
    players: players.map(([name, kind, place, total, more = {}]) => ({ name, kind, place, total, color: '#e2558f', crest: 0, crowns: 0, largest: 0, props: [], map: [], ...more })),
    ...extra,
  });
}
const get = (list, id) => list.find((a) => a.id === id);
const earned = (records, name = 'You') => achievementsFor(records, name).filter((a) => a.done).map((a) => a.id);

test('every achievement has its own id, a group, a name and a text', () => {
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  for (const a of ACHIEVEMENTS) {
    assert.ok(GROUPS.includes(a.group), a.id);
    assert.ok(a.name && a.text.endsWith('.'), a.id);
  }
});

test('nothing is earned without a game, and a loss earns only the games played', () => {
  assert.deepEqual(earned([]), []);
  const all = achievementsFor([game([['You', 'here', 2, 30], ['A', 'normal', 1, 40]])], 'You');
  assert.deepEqual(all.filter((a) => a.done), []);
  assert.deepEqual([get(all, 'games-10').have, get(all, 'games-10').need], [1, 10]);
});

test('a win earns the first crown, from the game that won it', () => {
  const lost = game([['You', 'here', 2, 30], ['A', 'normal', 1, 40]]);
  const win = game([['You', 'here', 1, 45], ['A', 'normal', 2, 40]]);
  const later = game([['You', 'here', 1, 50], ['A', 'normal', 2, 40]]);
  const first = get(achievementsFor([lost, win, later], 'You'), 'first-win');
  assert.equal(first.done, true);
  assert.equal(first.game, win);
  // someone else's win is not yours
  assert.ok(!earned([game([['You', 'here', 2, 30], ['Mia', 'here', 1, 40]])]).includes('first-win'));
  assert.ok(earned([game([['You', 'here', 2, 30], ['Mia', 'here', 1, 40]])], 'Mia').includes('first-win'));
});

test('beating the computer: the Expert, and each level for the ladder', () => {
  const vs = (kind, place = 1) => game([['You', 'here', place, 50], ['A', kind, place === 1 ? 2 : 1, 45]]);
  assert.ok(earned([vs('expert')]).includes('beat-expert'));
  assert.ok(!earned([vs('expert', 2)]).includes('beat-expert'), 'a loss to the Expert');
  // a shared first place with the Expert is no win over it
  assert.ok(!earned([game([['You', 'here', 1, 50], ['A', 'expert', 1, 50]])]).includes('beat-expert'));
  const climbing = [vs('easy'), vs('normal'), vs('hard')];
  assert.deepEqual([get(achievementsFor(climbing, 'You'), 'all-levels').have, get(achievementsFor(climbing, 'You'), 'all-levels').done], [3, false]);
  const ladder = get(achievementsFor([...climbing, vs('expert')], 'You'), 'all-levels');
  assert.equal(ladder.done, true);
  assert.equal(ladder.game.players[1].kind, 'expert');
});

test('wins in a row, and by a hair', () => {
  const w = (total = 50, second = 40) => game([['You', 'here', 1, total], ['A', 'hard', 2, second]]);
  const l = () => game([['You', 'here', 2, 30], ['A', 'hard', 1, 40]]);
  assert.ok(!earned([w(), w(), l(), w()]).includes('hat-trick'));
  const run = [w(), l(), w(), w(), w()];
  assert.equal(get(achievementsFor(run, 'You'), 'hat-trick').game, run[4]);
  assert.ok(earned([w(41, 40)]).includes('photo-finish'));
  assert.ok(earned([w(40, 40)]).includes('photo-finish'), 'a win on a tie-breaker');
  assert.ok(!earned([w(42, 40)]).includes('photo-finish'));
});

test('kingdoms: score, properties, crowns, terrains, a full kingdom', () => {
  const k = (more, rules = {}) => game([['You', 'here', 2, more.total ?? 40, more], ['A', 'hard', 1, 99]], { rules: { middleKingdom: false, harmony: false, mightyDuel: false, ...rules } });
  assert.ok(earned([k({ total: 60 })]).includes('score-60'));
  assert.ok(!earned([k({ total: 59 })]).includes('score-60'));
  assert.ok(earned([k({ props: [['forest', 6, 5]] })]).includes('jewel'));
  assert.ok(!earned([k({ props: [['forest', 7, 4]] })]).includes('jewel'));
  assert.ok(earned([k({ crowns: 12 })]).includes('crowns-12'));
  assert.ok(earned([k({ largest: 10 })]).includes('vast'));
  const six = ['wheat', 'forest', 'lake', 'grass', 'swamp', 'mine'].map((t) => [t, 2, 1]);
  assert.ok(earned([k({ props: six })]).includes('six-terrains'));
  assert.ok(!earned([k({ props: six.slice(1) })]).includes('six-terrains'));
  // full, with the castle in a corner, then in the middle
  const corner = ['C0W0W0W0W0', ...Array(4).fill('W0W0W0W0W0')];
  const middle = ['W0W0W0W0W0', 'W0W0W0W0W0', 'W0W0C0W0W0', 'W0W0W0W0W0', 'W0W0W0W0W0'];
  assert.deepEqual(earned([k({ map: corner })]).filter((id) => ['full', 'flawless'].includes(id)), ['full']);
  assert.deepEqual(earned([k({ map: middle })]).filter((id) => ['full', 'flawless'].includes(id)), ['full', 'flawless']);
  assert.ok(!earned([k({ map: ['W0W0..W0W0', ...middle.slice(1)] })]).includes('full'), 'a gap');
  assert.ok(!earned([k({ map: middle }, { mightyDuel: true })]).includes('full'), 'a Mighty Duel kingdom is 7×7');
});

test('the coach: a clean graded game, a sharp one, ten graded games', () => {
  const graded = (verdict) => game([['You', 'here', 2, 40], ['A', 'expert', 1, 50]], { coach: 'trainer', verdict });
  assert.ok(earned([graded({ decisions: 24, loss: 1.8, counts: { Best: 20, Inaccuracy: 4 } })]).includes('steady'));
  assert.ok(!earned([graded({ decisions: 24, loss: 1.8, counts: { Best: 20, Mistake: 4 } })]).includes('steady'));
  assert.ok(earned([graded({ decisions: 24, loss: 0.9, counts: { Best: 24 } })]).includes('sharp'));
  assert.ok(!earned([graded({ decisions: 5, loss: 0, counts: { Best: 5 } })]).includes('sharp'), 'a few moves are not a game');
  // a review after the game grades a seat as well
  const reviewed = game([['You', 'here', 2, 40, { verdict: { decisions: 24, loss: 0.5, counts: { Best: 24 } } }], ['A', 'expert', 1, 50]]);
  assert.ok(earned([reviewed]).includes('sharp'));
  const ten = Array.from({ length: 10 }, () => graded({ decisions: 24, loss: 3, counts: { Good: 24 } }));
  assert.equal(get(achievementsFor(ten.slice(0, 9), 'You'), 'student').have, 9);
  assert.equal(get(achievementsFor(ten, 'You'), 'student').game, ten[9]);
});

test('a Dynasty won, from its last game', () => {
  const d = (n, place) => game([['You', 'here', place, 50], ['A', 'hard', 3 - place, 45]], { dynasty: { id: 'dyn1', game: n } });
  const games = [d(1, 1), d(2, 1), d(3, 2)];
  assert.equal(get(achievementsFor(games, 'You'), 'dynasty').game, games[2], 'won over the three games, though not the last');
  assert.ok(!earned(games.slice(0, 2)).includes('dynasty'), 'unfinished');
});

test('online: a win against a friend who stayed', () => {
  const online = (left) => game([['You', 'here', 1, 50], ['Sam', 'friend', 2, 40, left ? { left: true } : {}]], { online: 'host' });
  assert.ok(earned([online(false)]).includes('among-friends'));
  assert.ok(!earned([online(true)]).includes('among-friends'));
});

test('the game just played says what it earned, for each person at the screen', () => {
  const before = [game([['You', 'here', 1, 50], ['A', 'normal', 2, 40]])];
  const now = game([['You', 'here', 1, 62], ['Mia', 'here', 2, 61], ['A', 'expert', 3, 40]]);
  const out = newAchievements(before, now);
  assert.deepEqual(out.map((o) => o.name), ['You', 'Mia']);
  assert.deepEqual(out[0].earned.map((a) => a.id), ['beat-expert', 'photo-finish', 'score-60'], 'not the first win again');
  assert.deepEqual(out[1].earned.map((a) => a.id), ['score-60']);
  // whether the history already holds the game or not
  assert.deepEqual(newAchievements([...before, now], now), out);
  assert.deepEqual(newAchievements([...before, now], game([['You', 'here', 2, 30], ['A', 'normal', 1, 40]])), []);
});

test('a real game reads the same', () => {
  const { players, ranking, moves } = playGame({ types: ['hard', 'hard'], seed: 7 });
  players[0].name = 'You';
  const config = { seats: [{ type: 'human', name: 'You' }, { type: 'hard' }], middleKingdom: false, harmony: false, mightyDuel: false };
  const rec = cleanRecord(JSON.parse(JSON.stringify(makeRecord({ players, rows: ranking, config, seed: 7, moves }))));
  const mine = rec.players[0];
  const list = achievementsFor([rec], 'You');
  assert.equal(get(list, 'first-win').done, mine.place === 1);
  assert.equal(get(list, 'full').done, players[0].kingdom.cells.size === 25);
  assert.equal(get(list, 'crowns-12').done, mine.crowns >= 12);
});
