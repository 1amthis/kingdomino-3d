// A recorded game played back with the rules alone: the table after every move, for the history's
// replay, and the position before every decision, for the coach's review.
import { dealTable, playTurns } from './table.js';
import { decodeMove, FLOW } from './moves.js';
import { describeTable } from './search/state.js';

// A history record that can be played back: kept with its seed and moves, in this version's flow.
export const replayable = (r) => !!r && r.flow === FLOW && Number.isInteger(r.seed) && Array.isArray(r.moves) && r.moves.length > 0;

const lineOf = (t, slots) => slots.map((s) => {
  const seat = s.king ? s.king.player.index : -1, k = seat >= 0 && t.players[seat].kingdom;
  return { id: s.domino.id, seat, done: !!k && (k.placements.some((q) => q.id === s.domino.id) || k.discards.includes(s.domino.id)) };
});

// r: a history record (its seed, rules, players and moves). Returns { frames, turns, rounds }:
// - frames[0] is the table as dealt, frames[k] the table after k moves: { round (0 for the opening
//   draft), kingdoms: [{ placements, discards, score }], current, next (slots: { id, seat, done }),
//   left (dominoes in the chest), unclaimed (ids discarded unclaimed so far), mover (the seat about to
//   decide, -1 once the game is over) }.
// - turns[k] is the k-th move, made between frames[k] and frames[k + 1]: { seat, kind, phase, value,
//   id (the domino picked or laid), choices (how many moves were legal), line (picks: the line's
//   domino ids by slot) }, and with `positions`, `table`: the position as the coach analyses it.
// Throws if the moves do not fit the deal.
export function replayRecord(r, { positions = false } = {}) {
  const t = dealTable({ players: r.players.length, seed: r.seed, ...r.rules });
  const frames = [], turns = [], rounds = Math.ceil(t.deck.length / t.lineN);
  let round = 0, line = null;
  const snap = (d) => {
    // a round begins when its line comes down to be placed
    if (d && d.kind === 'place' && t.current !== line) { round++; line = t.current; }
    frames.push({
      round,
      kingdoms: t.players.map((p) => ({ placements: p.kingdom.placements.slice(), discards: p.kingdom.discards.slice(), score: p.kingdom.score(t.opts).total })),
      current: lineOf(t, t.current), next: lineOf(t, t.next),
      left: t.deck.length, unclaimed: t.unclaimed.slice(),
      mover: d ? d.player.index : -1,
    });
  };
  const it = playTurns(t);
  let step = it.next();
  for (let k = 0; !step.done; k++) {
    const d = step.value, m = decodeMove(r.moves[k]);
    snap(d);
    if (!m || m.seat !== d.player.index || m.kind !== d.kind) throw new Error(`move ${k + 1} is out of step`);
    const pick = d.kind === 'select' && d.options.find((s) => s.index === m.value);
    turns.push({
      seat: m.seat, kind: m.kind, phase: d.phase, value: m.value,
      id: d.kind === 'select' ? (pick ? pick.domino.id : -1) : d.slot.domino.id,
      choices: d.kind === 'select' ? d.options.length : d.valid.length,
      ...(d.kind === 'select' ? { line: t.next.map((s) => s.domino.id) } : {}),
      // (copied: the kingdoms it describes keep growing as the replay goes on)
      ...(positions ? { table: structuredClone(describeTable({ ...t, deckLeft: t.deck.length }, d.phase, d.king)) } : {}),
    });
    step = it.next(m.value);
  }
  if (turns.length !== r.moves.length) throw new Error(`the record has ${r.moves.length - turns.length} moves left over`);
  snap(null);
  return { frames, turns, rounds };
}
