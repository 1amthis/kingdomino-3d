// Between the controller's table and the search engine: describeTable() turns the table into plain data
// a worker can receive, gameFrom() rebuilds a search Game from it, and moveOut() turns the search's
// answer back into the controller's terms.
import { DIRS } from '../rules.js';
import { Game, grid, INIT, PLACE, PICK, DISCARD } from './engine.js';

// table: the controller's players, lines (slots of { domino, index, king }), chest count, opening order
// and options. phase: 'open' (the opening draft), 'place' or 'pick'; king: whose turn it is.
// Only what a player at the table can see goes in: the chest's count, never its order.
export function describeTable({ players, current, next, deckLeft, opening, opts }, phase, king) {
  const ids = (slots) => slots.map((s) => s.domino.id);
  const owners = (slots) => slots.map((s) => (s.king ? s.king.player.index : -1));
  const seen = new Set([...ids(current), ...ids(next)]);
  for (const p of players) {
    for (const pl of p.kingdom.placements) seen.add(pl.id);
    for (const id of p.kingdom.discards) seen.add(id);
  }
  const t = {
    size: opts.size, middle: !!opts.middleKingdom, harmony: !!opts.harmony,
    kingdoms: players.map((p) => ({ placements: p.kingdom.placements, discards: p.kingdom.discards.length })),
    seen: [...seen], left: deckLeft, phase,
  };
  if (phase === 'open') {
    Object.assign(t, { line: ids(next), own: owners(next), nextLine: null, nextOwn: null });
    Object.assign(t, { order: opening.map((k) => k.player.index), idx: opening.indexOf(king) });
  } else {
    Object.assign(t, { line: ids(current), own: owners(current), idx: current.findIndex((s) => s.king === king) });
    Object.assign(t, next.length ? { nextLine: ids(next), nextOwn: owners(next) } : { nextLine: null, nextOwn: null });
  }
  return t;
}

const cell = (g, x, y) => (y + g.size) * g.W + x + g.size;

export function gameFrom(t) {
  const game = new Game(t.kingdoms.length, t.size, t.middle, t.harmony);
  const g = grid(t.size);
  t.kingdoms.forEach((k, i) => {
    const b = game.boards[i];
    for (const { id, x, y, rot } of k.placements) {
      const [dx, dy] = DIRS[rot];
      b.place(cell(g, x, y) << 8 | cell(g, x + dx, y + dy), id - 1);
    }
    b.discards = k.discards;
  });
  for (const id of t.seen) game.seen[id - 1] = 1;
  game.left = t.left;
  game.line = Int8Array.from(t.line, (id) => id - 1);
  game.own = Int8Array.from(t.own);
  if (t.nextLine) {
    game.nextLine = Int8Array.from(t.nextLine, (id) => id - 1);
    game.nextOwn = Int8Array.from(t.nextOwn);
  }
  game.order = t.order ? Int8Array.from(t.order) : null;
  game.phase = { open: INIT, place: PLACE, pick: PICK }[t.phase];
  game.idx = t.idx;
  return game;
}

// A search placement as rules.js takes it: { x, y, rot } with square A on (x, y).
export function placementOut(size, m) {
  const { col, row } = grid(size), a = m >> 8, b = m & 255;
  const dx = col[b] - col[a], dy = row[b] - row[a];
  return { x: col[a] - size, y: row[a] - size, rot: DIRS.findIndex(([ex, ey]) => ex === dx && ey === dy) };
}

// A slot index when drafting; when placing, a placement, or null to discard.
export function moveOut(game, m) {
  if (game.phase !== PLACE) return m;
  return m === DISCARD ? null : placementOut(game.boards[0].g.size, m);
}

// Search.analyse()'s report with its moves and landing spots in the controller's terms.
export function analysisOut(game, a) {
  const size = game.boards[0].g.size;
  return { ...a, moves: a.moves.map((m) => ({ ...m, move: moveOut(game, m.move), land: m.land === null ? null : placementOut(size, m.land) })) };
}
