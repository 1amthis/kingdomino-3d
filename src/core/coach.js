// The coach's judgement, from an analysis of the position (analysePosition): the move the Expert
// prefers, and what any other move gives up, in points of expected final lead over the best opponent.
import { footprint } from './rules.js';

// Points given up → grade, as in the Python trainer. Only the Expert's own choice is "Best" outright;
// a move within 0.3 points of it counts as best too.
export const GRADES = [[0.3, 'Best'], [1, 'Excellent'], [2.5, 'Good'], [5, 'Inaccuracy'], [9, 'Mistake'], [Infinity, 'Blunder']];

// What a placement leaves on the table, so the two ways of laying a domino with identical halves match.
export function placementKey(domino, { x, y, rot }) {
  return footprint(x, y, rot).map(([cx, cy], i) => `${cx},${cy}:${domino.squares[i].terrain}${domino.squares[i].crowns}`).sort().join(' ');
}

// The analysed move matching a slot index (drafting), or a placement or null (placing this domino).
export function findMove(analysis, move, domino) {
  if (move === null || typeof move === 'number') return analysis.moves.find((m) => m.move === move) || null;
  const k = placementKey(domino, move);
  return analysis.moves.find((m) => m.move && placementKey(domino, m.move) === k) || null;
}

// { grade, loss, stats, best } for playing `move`, or null if the analysis has nothing on it.
export function judge(analysis, move, domino) {
  const best = analysis.moves[0], stats = findMove(analysis, move, domino);
  if (!stats || !stats.visits) return null;
  const loss = stats === best ? 0 : Math.max(0, best.ev - stats.ev);
  const grade = stats === best ? 'Best' : GRADES.find(([most]) => loss <= most)[1];
  return { grade, loss, stats, best };
}

// A game's worth of judgements ({ grade, loss, hinted }): how many, points lost per decision, grade counts.
export function tally(records) {
  const counts = Object.fromEntries(GRADES.map(([, g]) => [g, 0]));
  let loss = 0, hints = 0;
  for (const r of records) {
    counts[r.grade]++;
    loss += r.loss;
    if (r.hinted) hints++;
  }
  return { decisions: records.length, loss: records.length ? loss / records.length : 0, counts, hints };
}
