// A table without the 3D, for benchmarks and tests: the game flow of core/table.js with any mix of the
// heuristic levels and the expert search. It records every decision as the controller does, and can
// replay a recorded game instead of playing its own moves.
import { rank } from '../src/core/rules.js';
import { choosePlacement, chooseSlot } from '../src/core/ai.js';
import { Rng } from '../src/core/rng.js';
import { Search } from '../src/core/search/mcts.js';
import { describeTable, gameFrom, moveOut } from '../src/core/search/state.js';
import { encodeMove, decodeMove } from '../src/core/moves.js';
import { dealTable, playTurns } from '../src/core/table.js';

// types: one per seat ('easy' | 'normal' | 'hard' | 'expert'). The same seed deals the same chest and
// opening order, whoever sits where, so swapping seats replays the same game from the other side.
// onDecision(table, move, domino), if given, sees every decision the expert makes (for tests).
// replay: a recorded game's moves (moves.js), played in place of the seats' own; they must be legal.
export function playGame({ types, seed = 1, middleKingdom = false, harmony = false, mightyDuel = false, budget, onDecision, replay = null }) {
  const table = dealTable({ players: types.length, seed, middleKingdom, harmony, mightyDuel });
  const { players, opts, lineN } = table;
  players.forEach((p, i) => { p.type = types[i]; });
  const rng = new Rng(seed ^ 0x5bd1e995);
  const search = new Search({ seed });
  const stats = { moves: 0, sims: 0, ms: 0 };
  const moves = [], script = replay && replay.map(decodeMove);

  const expert = (d) => {
    const t = describeTable({ ...table, deckLeft: table.deck.length }, d.phase, d.king);
    const game = gameFrom(t);
    const t0 = performance.now();
    const { move, sims } = search.choose(game, budget);
    stats.moves++;
    stats.sims += sims;
    stats.ms += performance.now() - t0;
    const out = moveOut(game, move);
    if (onDecision) onDecision(t, out, d.kind === 'place' ? d.slot.domino : null);
    return out;
  };
  const decide = (d) => {
    const p = d.player;
    if (script) {
      const m = script.shift();
      if (!m || m.seat !== p.index || m.kind !== d.kind) throw new Error(`the record is out of step at move ${moves.length}`);
      return m.value;
    }
    if (p.type === 'expert') return expert(d);
    if (d.kind === 'select') return chooseSlot(p, players.filter((o) => o !== p), d.options, lineN, opts, p.type, rng).index;
    return choosePlacement(p.kingdom, d.slot.domino, opts, p.type, rng);
  };

  const turns = playTurns(table);
  for (let step = turns.next(); !step.done;) {
    const d = step.value, move = decide(d);
    moves.push(encodeMove(d.player.index, d.kind, move));
    step = turns.next(move);
  }
  if (script && script.length) throw new Error(`the record has ${script.length} moves left over`);
  return { players, ranking: rank(players, opts), stats, unclaimed: table.unclaimed, moves };
}
