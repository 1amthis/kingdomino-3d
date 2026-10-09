// A game's decisions, in the order they were taken. With the seed, which deals the chest and the
// opening order, they replay the game exactly: AI moves are recorded too, since they cannot be
// re-derived (the heuristics roll dice and the Expert searches against the clock).
// Each move is a short string: '0s2' (seat 0 picks the domino in slot 2), '1p-1,0,3' (seat 1 lays its
// domino with square A on (-1, 0), rotation 3), '2d' (seat 2 discards the domino that fits nowhere).
import { GRADES } from './coach.js';

// The game flow the moves follow (dealing, turn order, the 3-player discard). A change to it makes
// older records unplayable, so it would come with a new number.
export const FLOW = 1;

const MOVE = /^([0-3])(?:s([0-3])|p(-?\d),(-?\d),([0-3])|d)$/;
export const isMove = (s) => typeof s === 'string' && MOVE.test(s);

// kind: 'select' (value: a slot index) or 'place' (value: { x, y, rot }, or null to discard).
export function encodeMove(seat, kind, value) {
  if (kind === 'select') return `${seat}s${value}`;
  return value ? `${seat}p${value.x},${value.y},${value.rot}` : `${seat}d`;
}

// { seat, kind, value } as encodeMove takes them, or null for anything else.
export function decodeMove(s) {
  const m = typeof s === 'string' && MOVE.exec(s);
  if (!m) return null;
  const seat = Number(m[1]);
  if (m[2] !== undefined) return { seat, kind: 'select', value: Number(m[2]) };
  if (m[3] !== undefined) return { seat, kind: 'place', value: { x: Number(m[3]), y: Number(m[4]), rot: Number(m[5]) } };
  return { seat, kind: 'place', value: null };
}

// A list of moves that is sound enough to replay, or null. (Its legality is checked as it replays.)
export const cleanMoves = (moves) => (Array.isArray(moves) && moves.length <= 200 && moves.every(isMove) ? moves.slice() : null);

// ---------- the game in progress ----------
// An offline game is saved after every move, so a reload (or a phone dropping the tab in the
// background) picks it up again. It goes when the game ends or the player quits it.
const SEAT_TYPES = ['human', 'easy', 'normal', 'hard', 'expert'];
const GRADE_NAMES = GRADES.map(([, g]) => g);
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function cleanSeat(s) {
  if (!s || typeof s !== 'object' || !SEAT_TYPES.includes(s.type)) return null;
  return {
    name: String(s.name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18) || 'Player',
    type: s.type,
    color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#999999',
    crest: Math.abs(s.crest | 0) % 4,
  };
}

// The coach's grades so far: { grade, loss, hinted }.
function cleanGrades(log) {
  if (!Array.isArray(log)) return [];
  return log.filter((g) => g && GRADE_NAMES.includes(g.grade) && g.loss >= 0 && g.loss < 1000)
    .map((g) => ({ grade: g.grade, loss: g.loss, hinted: !!g.hinted }));
}

// A saved game that can be picked up again, copied field by field, or null.
// { config (the menu's seats and rules, with the seed), start, moves, coach (its grades so far) }
export function cleanSaved(g) {
  if (!g || typeof g !== 'object' || g.v !== 1 || g.flow !== FLOW) return null;
  const c = g.config;
  if (!c || typeof c !== 'object' || !Array.isArray(c.seats) || c.seats.length < 2 || c.seats.length > 4) return null;
  const seats = c.seats.map(cleanSeat), moves = cleanMoves(g.moves);
  if (seats.some((s) => !s) || !moves || !int(c.seed, 0, 2 ** 32 - 1)) return null;
  return {
    config: {
      seats, seed: c.seed,
      middleKingdom: !!c.middleKingdom, harmony: !!c.harmony, mightyDuel: seats.length === 2 && !!c.mightyDuel,
    },
    start: Number.isFinite(g.start) ? g.start : null,
    moves,
    coach: cleanGrades(g.coach),
  };
}

// storage: localStorage, or anything with getItem / setItem / removeItem (or null when blocked).
export class SavedGame {
  constructor(storage, key = 'kingdomino3d-game') {
    this.storage = storage;
    this.key = key;
  }

  // The game to pick up again, or null.
  load() {
    try { return cleanSaved(JSON.parse(this.storage.getItem(this.key) || 'null')); } catch { return null; }
  }

  // state: { config (with its seed), start, moves, coach }
  save({ config, start, moves, coach }) {
    try {
      this.storage.setItem(this.key, JSON.stringify({ v: 1, flow: FLOW, saved: Date.now(), config, start, moves, coach }));
      return true;
    } catch { return false; }
  }

  clear() { try { this.storage.removeItem(this.key); } catch { /* storage off */ } }
}
