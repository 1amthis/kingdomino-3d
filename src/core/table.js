// The game flow with the rules alone, for whatever plays a game without the 3D: the headless runner,
// a recorded game's replay and the coach's review. The seed deals the chest and the opening order; then
// come the opening draft and each round's place-and-pick in slot order, with 3 players the domino nobody
// claimed discarded from each line. The controller plays the same flow with its animations.
import { DOMINOES, Kingdom, kingsPerPlayer, lineSize, deckSize } from './rules.js';
import { Rng } from './rng.js';

// A table dealt from the seed: { players: [{ index, kingdom, kings }], deck, opening, current, next,
// unclaimed, opts, lineN }. Lines hold slots of { domino, index, king }, as in the controller;
// `unclaimed` keeps the ids of the dominoes discarded unclaimed.
export function dealTable({ players: n, seed, middleKingdom = false, harmony = false, mightyDuel = false }) {
  const deal = new Rng(seed), size = mightyDuel ? 7 : 5;
  const players = Array.from({ length: n }, (_, index) => ({ index, kingdom: new Kingdom(size), kings: [] }));
  for (const p of players) for (let i = 0; i < kingsPerPlayer(n); i++) p.kings.push({ player: p });
  const deck = deal.shuffle(DOMINOES.slice()).slice(0, deckSize(n, mightyDuel));
  let opening;
  // in a duel the opening picks snake (A, B, B, A)
  if (n === 2) {
    const [a, b] = deal.shuffle(players.slice());
    opening = [a.kings[0], b.kings[0], b.kings[1], a.kings[1]];
  } else opening = deal.shuffle(players.flatMap((p) => p.kings));
  return { players, deck, opening, current: [], next: [], unclaimed: [], opts: { middleKingdom, harmony, size }, lineN: lineSize(n) };
}

// Every decision of the game, in order. The generator yields { kind: 'select', phase: 'open' | 'pick',
// king, player, options } or { kind: 'place', phase: 'place', king, player, slot, valid } and takes the
// move back: a slot index, or a placement { x, y, rot } (null to discard when nothing fits). An illegal
// move throws.
export function* playTurns(t) {
  const draw = () => t.deck.splice(0, t.lineN).sort((a, b) => a.id - b.id).map((domino, index) => ({ domino, index, king: null }));
  function* select(king, phase) {
    const options = t.next.filter((s) => !s.king);
    if (!options.length) return;
    const i = yield { kind: 'select', phase, king, player: king.player, options };
    const slot = options.find((s) => s.index === i);
    if (!slot) throw new Error(`slot ${i} cannot be picked`);
    slot.king = king;
  }
  function* place(slot) {
    const p = slot.king.player, valid = p.kingdom.validPlacements(slot.domino);
    const m = yield { kind: 'place', phase: 'place', king: slot.king, player: p, slot, valid };
    const legal = m ? valid.some((v) => v.x === m.x && v.y === m.y && v.rot === m.rot) : m === null && !valid.length;
    if (!legal) throw new Error(`illegal move for domino ${slot.domino.id}: ${JSON.stringify(m)}`);
    if (m) p.kingdom.place(slot.domino, m.x, m.y, m.rot);
    else p.kingdom.discard(slot.domino);
  }
  t.next = draw();
  for (const king of t.opening) yield* select(king, 'open');
  for (;;) {
    for (const s of t.next) if (!s.king) t.unclaimed.push(s.domino.id);
    t.current = t.next.filter((s) => s.king);
    t.next = t.deck.length ? draw() : [];
    for (const slot of t.current) {
      yield* place(slot);
      if (t.next.length) yield* select(slot.king, 'pick');
    }
    if (!t.next.length) break;
  }
}
