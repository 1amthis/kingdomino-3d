// The Dynasty, an official variant: three games in a row at the same table, each game's score added up,
// and the highest total wins. Each game is dealt, played, saved and kept in the history like any other;
// the dynasty rides along in the game's config as { id, games }, games holding each finished game's
// scores seat by seat: [[{ total, largest, crowns }, ...], ...].
// The rulebook names no tie-breaker for it: ties go as in a single game, over the games added up
// (the largest properties, then the crowns).
import { placeRows } from './rules.js';

export const GAMES = 3;

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export const newDynasty = () => ({ id: `d${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, games: [] });

// The number of the game being played (1 to 3), when d holds the games before it.
export const gameNumber = (d) => d.games.length + 1;

export const isOver = (d) => d.games.length >= GAMES;

// The dynasty with a finished game added. scores: each seat's, as Kingdom.score() or a history record's
// players give them.
export function addGame(d, scores) {
  return { id: d.id, games: [...d.games, scores.map(({ total, largest, crowns }) => ({ total, largest, crowns }))] };
}

// What playing again deals: the dynasty's next game, a new dynasty once this one is over, or (for a
// game outside any dynasty) a game on its own.
export const nextDynasty = (d) => (!d ? null : isOver(d) ? newDynasty() : d);

// The standings over the games played: one row per seat, best first,
// { seat, games: [each game's score], s: { total, largest, crowns } (added up), place }.
export function standings(d) {
  const seats = d.games.length ? d.games[0].length : 0;
  return placeRows(Array.from({ length: seats }, (_, seat) => {
    const scores = d.games.map((g) => g[seat]);
    const sum = (k) => scores.reduce((a, g) => a + g[k], 0);
    return { seat, games: scores.map((g) => g.total), s: { total: sum('total'), largest: sum('largest'), crowns: sum('crowns') } };
  }));
}

// A dynasty with games still to play (from a saved game, or an online host's deal), copied field by
// field, or null. seats: the number of seats at the table.
export function cleanDynasty(d, seats) {
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !/^[\w-]{1,40}$/.test(d.id)) return null;
  if (!Array.isArray(d.games) || d.games.length >= GAMES) return null;
  const sound = (g) => Array.isArray(g) && g.length === seats
    && g.every((s) => s && int(s.total, 0, 999) && int(s.largest, 0, 49) && int(s.crowns, 0, 99));
  if (!d.games.every(sound)) return null;
  return { id: d.id, games: d.games.map((g) => g.map(({ total, largest, crowns }) => ({ total, largest, crowns }))) };
}
