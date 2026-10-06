// A table without the 3D, for benchmarks and tests: the controller's game flow (opening draft, then
// place-and-pick in slot order, a 3-player line's unclaimed domino discarded) with any mix of the
// heuristic levels and the expert search.
import { DOMINOES, Kingdom, kingsPerPlayer, lineSize, deckSize, rank } from '../src/core/rules.js';
import { choosePlacement, chooseSlot } from '../src/core/ai.js';
import { Rng } from '../src/core/rng.js';
import { Search } from '../src/core/search/mcts.js';
import { describeTable, gameFrom, moveOut } from '../src/core/search/state.js';

// types: one per seat ('easy' | 'normal' | 'hard' | 'expert'). The same seed deals the same chest and
// opening order, whoever sits where, so swapping seats replays the same game from the other side.
// onDecision(table, move, domino), if given, sees every decision the expert makes (for tests).
export function playGame({ types, seed = 1, middleKingdom = false, harmony = false, mightyDuel = false, budget, onDecision }) {
  const n = types.length, size = mightyDuel ? 7 : 5, L = lineSize(n);
  const opts = { middleKingdom, harmony, size };
  const deal = new Rng(seed), rng = new Rng(seed ^ 0x5bd1e995);
  const players = types.map((type, index) => ({ index, type, kingdom: new Kingdom(size), kings: [] }));
  for (const p of players) for (let i = 0; i < kingsPerPlayer(n); i++) p.kings.push({ player: p });
  const deck = deal.shuffle(DOMINOES.slice()).slice(0, deckSize(n, mightyDuel));
  let opening;
  if (n === 2) {
    const [a, b] = deal.shuffle(players.slice());
    opening = [a.kings[0], b.kings[0], b.kings[1], a.kings[1]];
  } else opening = deal.shuffle(players.flatMap((p) => p.kings));
  const search = new Search({ seed });
  const stats = { moves: 0, sims: 0, ms: 0 };
  let current = [], next = [];
  const unclaimed = []; // ids of the dominoes nobody took (3 players)

  const draw = () => deck.splice(0, L).sort((a, b) => a.id - b.id).map((domino, index) => ({ domino, index, king: null }));
  const expert = (phase, king) => {
    const table = describeTable({ players, current, next, deckLeft: deck.length, opening, opts, unclaimed }, phase, king);
    const game = gameFrom(table);
    const t0 = performance.now();
    const { move, sims } = search.choose(game, budget);
    stats.moves++;
    stats.sims += sims;
    stats.ms += performance.now() - t0;
    const out = moveOut(game, move);
    if (onDecision) onDecision(table, out, phase === 'place' ? current.find((s) => s.king === king).domino : null);
    return out;
  };
  const select = (king, phase) => {
    const p = king.player, options = next.filter((s) => !s.king);
    let slot;
    if (p.type === 'expert') {
      const i = expert(phase, king);
      slot = options.find((s) => s.index === i);
      if (!slot) throw new Error(`the expert picked slot ${i}, which is taken`);
    } else slot = chooseSlot(p, players.filter((o) => o !== p), options, L, opts, p.type, rng);
    slot.king = king;
  };
  const place = (slot) => {
    const p = slot.king.player, valid = p.kingdom.validPlacements(slot.domino);
    const choice = p.type === 'expert' ? expert('place', slot.king) : choosePlacement(p.kingdom, slot.domino, opts, p.type, rng);
    const legal = choice ? valid.some((v) => v.x === choice.x && v.y === choice.y && v.rot === choice.rot) : !valid.length;
    if (!legal) throw new Error(`illegal move for domino ${slot.domino.id}: ${JSON.stringify(choice)}`);
    if (choice) p.kingdom.place(slot.domino, choice.x, choice.y, choice.rot);
    else p.kingdom.discard(slot.domino);
  };

  next = draw();
  for (const king of opening) select(king, 'open');
  for (;;) {
    for (const s of next) if (!s.king) unclaimed.push(s.domino.id);
    current = next.filter((s) => s.king);
    next = deck.length ? draw() : [];
    for (const slot of current) {
      place(slot);
      if (next.length) select(slot.king, 'pick');
    }
    if (!next.length) break;
  }
  return { players, ranking: rank(players, opts), stats, unclaimed };
}
