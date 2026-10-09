// A game's moves, with its seed, replay it exactly; the saved game in progress reads back only when sound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMove, decodeMove, isMove, cleanSaved, SavedGame, FLOW } from '../src/core/moves.js';
import { playGame } from '../scripts/headless.js';

// A memory stand-in for localStorage.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// What a finished game left on the table: every kingdom's placements and discards, and the ranking.
const outcome = ({ players, ranking, unclaimed }) => ({
  kingdoms: players.map((p) => ({ placements: p.kingdom.placements, discards: p.kingdom.discards })),
  ranking: ranking.map((r) => [r.player.index, r.place, r.s.total]),
  unclaimed,
});

test('moves read back as they were written', () => {
  const moves = [
    [0, 'select', 3], [3, 'select', 0],
    [1, 'place', { x: -1, y: 0, rot: 3 }], [2, 'place', { x: 4, y: -6, rot: 0 }], [0, 'place', null],
  ];
  for (const [seat, kind, value] of moves) {
    const s = encodeMove(seat, kind, value);
    assert.ok(isMove(s), s);
    assert.deepEqual(decodeMove(s), { seat, kind, value });
  }
  assert.equal(encodeMove(1, 'place', { x: -1, y: 0, rot: 3 }), '1p-1,0,3');
  for (const junk of [null, 3, '', '4s0', '0s4', '0p1,1', '0p10,0,0', '0p1,0,4', '0dd', ' 0s1', '0x']) {
    assert.equal(isMove(junk), false, String(junk));
    assert.equal(decodeMove(junk), null, String(junk));
  }
});

test('the seed and the moves replay a game exactly, whoever sits in the seats', () => {
  const setups = [
    { types: ['hard', 'normal'], seed: 3 },
    { types: ['hard', 'easy'], seed: 8, mightyDuel: true, middleKingdom: true, harmony: true },
    { types: ['normal', 'hard', 'easy'], seed: 11 },
    { types: ['easy', 'hard', 'normal', 'hard'], seed: 21, harmony: true },
  ];
  for (const setup of setups) {
    const played = playGame(setup);
    const n = setup.types.length, dominoes = n === 2 && !setup.mightyDuel ? 24 : n === 3 ? 36 : 48;
    // every domino is picked once (3 players leave one per line) and placed or discarded once
    assert.equal(played.moves.length, 2 * dominoes, JSON.stringify(setup));
    assert.ok(played.moves.every(isMove));
    // the replaying seats would have played differently: the record alone decides
    const replayed = playGame({ ...setup, types: setup.types.map(() => 'easy'), replay: played.moves });
    assert.deepEqual(outcome(replayed), outcome(played), JSON.stringify(setup));
    assert.deepEqual(replayed.moves, played.moves);
  }
});

test('a record that does not fit its deal is refused', () => {
  const setup = { types: ['hard', 'normal'], seed: 3 };
  const { moves } = playGame(setup);
  const swap = (i, s) => moves.map((m, j) => (j === i ? s : m));
  const place = moves.findIndex((m) => m[1] === 'p');
  assert.throws(() => playGame({ ...setup, replay: swap(0, moves[0][0] === '0' ? '1s0' : '0s0') }), /out of step/);
  assert.throws(() => playGame({ ...setup, replay: swap(place, `${moves[place][0]}p4,4,0`) }), /illegal move/);
  assert.throws(() => playGame({ ...setup, replay: [...moves, '0s0'] }), /left over/);
  assert.throws(() => playGame({ ...setup, seed: 4, replay: moves }), /out of step|illegal|cannot be picked/, 'another seed deals another game');
});

test('the game in progress is saved, read back only when sound, and let go', () => {
  const seats = [{ name: 'You', type: 'human', color: '#e2558f', crest: 0 }, { name: 'Lady Aveline', type: 'expert', color: '#f2c230', crest: 1 }];
  const config = { seats, seed: 123456789, middleKingdom: true, harmony: false, mightyDuel: false };
  const state = { config, start: 1000, moves: ['1s2', '0s0', '0s3', '1s1', '0p1,0,0'], coach: [{ grade: 'Best', loss: 0, hinted: false }, { grade: 'Mistake', loss: 6.2, hinted: true }] };
  const store = new SavedGame(memoryStorage());
  assert.equal(store.load(), null);
  assert.ok(store.save(state));
  assert.deepEqual(store.load(), state);
  store.clear();
  assert.equal(store.load(), null);

  const saved = { v: 1, flow: FLOW, ...state };
  assert.deepEqual(cleanSaved(saved), state);
  const bad = [
    null, { ...saved, v: 2 }, { ...saved, flow: FLOW + 1 }, { ...saved, moves: ['0s9'] }, { ...saved, moves: 'x' },
    { ...saved, config: { ...config, seed: -1 } }, { ...saved, config: { ...config, seed: undefined } },
    { ...saved, config: { ...config, seats: [seats[0]] } }, { ...saved, config: { ...config, seats: [seats[0], { ...seats[1], type: 'remote' }] } },
  ];
  for (const g of bad) assert.equal(cleanSaved(g), null, JSON.stringify(g));
  const odd = cleanSaved({ ...saved, config: { ...config, mightyDuel: 1, seats: [{ ...seats[0], name: '<i>Eve</i>', color: 'red' }, seats[1]] }, coach: [{ grade: 'Superb', loss: 1 }, { grade: 'Good', loss: 2 }] });
  assert.equal(odd.config.seats[0].name, 'iEve/i');
  assert.equal(odd.config.seats[0].color, '#999999');
  assert.equal(odd.config.mightyDuel, true);
  assert.deepEqual(odd.coach, [{ grade: 'Good', loss: 2, hinted: false }]);

  // a browser that blocks storage keeps nothing, and says so
  const blocked = new SavedGame(null);
  assert.equal(blocked.save(state), false);
  assert.equal(blocked.load(), null);
});
