// The coach's review of a finished game: each decision of the people at the table graded as the coach
// grades it during a game (the same analysis of the same position). Once the game is over, fair play no
// longer keeps the coach away, so games with friends get graded too.
// The record keeps the grades as review: { [move index]: [points given up, the Expert's move] }, the
// Expert's move written as moves.js's encodeAction does, or null when the analysis had nothing on it.
// Each person's verdict joins their seat once all their moves are graded.
import { judge, tally, GRADES } from './coach.js';
import { encodeAction } from './moves.js';
import { dominoById } from './rules.js';

// The seats the review grades: the people's (at this screen or online), not the computer's.
export const reviewedSeats = (r) => r.players.flatMap((p, i) => (p.kind === 'here' || p.kind === 'friend' ? [i] : []));

// The moves it grades (indices into the record's moves): those seats' decisions where there was a choice.
// turns: replayRecord()'s.
export function reviewPlan(r, turns) {
  const seats = new Set(reviewedSeats(r));
  return turns.flatMap((t, k) => (seats.has(t.seat) && t.choices > 1 ? [k] : []));
}

// A move's grade from the points it gave up, as judge() gives it.
export const gradeOf = (loss) => GRADES.find(([most]) => loss <= most)[1];

// Inaccuracy or worse: worth showing what the Expert would have done.
export const isPoor = (loss) => loss > GRADES[2][0];

// The grade of turn (replayRecord()'s) from the analysis of its position, as the record keeps it.
export function markMove(analysis, turn) {
  const v = judge(analysis, turn.value, turn.kind === 'place' ? dominoById(turn.id) : undefined);
  return v ? [Math.round(v.loss * 100) / 100, encodeAction(turn.kind, v.best.move)] : null;
}

// Each seat's verdict (tally()'s { decisions, loss, counts, hints }) once all its planned moves are
// graded, else null.
export function reviewVerdicts(r, plan, turns) {
  const review = r.review || {};
  return r.players.map((_, seat) => {
    const mine = plan.filter((k) => turns[k].seat === seat);
    if (!mine.length || mine.some((k) => !(k in review))) return null;
    const grades = mine.map((k) => review[k]).filter(Boolean).map(([loss]) => ({ grade: gradeOf(loss), loss, hinted: false }));
    return grades.length ? tally(grades) : null;
  });
}
