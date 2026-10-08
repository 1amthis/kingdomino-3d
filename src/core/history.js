// The games played in this browser: a record of each finished game, and the stats drawn from them.
// Plain data in and out (the storage is handed in), so a record could later go to a server unchanged.

export const VERSION = 1;
export const KEEP = 1000; // beyond this, the oldest games make way
export const AI_LEVELS = ['easy', 'normal', 'hard', 'expert'];
// who sat in a seat: 'here' (a person at this screen), 'friend' (a person online) or an AI level
const KINDS = ['here', 'friend', ...AI_LEVELS];

// A kingdom as rows of two-character cells (terrain letter, crowns), '..' for an empty square.
const LETTER = { wheat: 'W', forest: 'F', lake: 'L', grass: 'G', swamp: 'S', mine: 'M', castle: 'C' };
const TERRAIN_OF = Object.fromEntries(Object.entries(LETTER).map(([t, l]) => [l, t]));
const MAP_ROW = /^(?:[WFLGSMC][0-3]|\.\.){1,7}$/;

export function encodeMap(k) {
  const rows = [];
  for (let y = k.minY; y <= k.maxY; y++) {
    let row = '';
    for (let x = k.minX; x <= k.maxX; x++) {
      const c = k.get(x, y);
      row += c ? LETTER[c.terrain] + c.crowns : '..';
    }
    rows.push(row);
  }
  return rows;
}

// [[{ terrain, crowns } | null, ...], ...], top row first, as the kingdom's owner sees it
export function decodeMap(rows) {
  return rows.map((row) => Array.from({ length: row.length / 2 }, (_, i) => (row[2 * i] === '.' ? null : { terrain: TERRAIN_OF[row[2 * i]], crowns: Number(row[2 * i + 1]) })));
}

// The game just finished, as it goes into the history. players: the controller's players (with their
// kingdoms), rows: rank()'s final ranking, config: the game's config (its seats as they were dealt).
export function makeRecord({ players, rows, config, seed = null, online = null, coach = null, verdict = null, start = null, end = Date.now() }) {
  const rowOf = new Map(rows.map((r) => [r.player, r]));
  return {
    v: VERSION,
    id: `${end.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    start, end,
    online, // 'host' or 'guest' for a game played online
    rules: { middleKingdom: !!config.middleKingdom, harmony: !!config.harmony, mightyDuel: !!config.mightyDuel },
    seed,
    coach, // 'trainer' or 'study' when the coach graded the game
    players: players.map((p, i) => {
      const { place, s } = rowOf.get(p), seat = config.seats[i];
      const kind = seat.type === 'human' ? (seat.remote ? 'friend' : 'here') : seat.type;
      return {
        name: p.name, color: p.color, crest: p.crest, kind,
        // a friend who left: the AI finished their kingdom
        ...(kind === 'friend' && p.type !== 'human' ? { left: true } : {}),
        place, total: s.total, middle: s.middle, harmony: s.harmony, largest: s.largest, crowns: s.crowns,
        discards: p.kingdom.discards.length,
        props: s.regions.filter((g) => g.crowns).sort((a, b) => b.score - a.score).map((g) => [g.terrain, g.size, g.crowns]),
        map: encodeMap(p.kingdom),
      };
    }),
    verdict, // the coach's tally for the player at this screen: { decisions, loss, counts, hints }
  };
}

// ---------- reading records back (from storage or an imported file) ----------
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18) || 'Player';

function cleanPlayer(p) {
  if (!p || typeof p !== 'object' || !KINDS.includes(p.kind)) return null;
  if (!int(p.place, 1, 4) || !int(p.total, 0, 999)) return null;
  const props = Array.isArray(p.props) ? p.props.filter((g) => Array.isArray(g) && LETTER[g[0]] && g[0] !== 'castle' && int(g[1], 1, 48) && int(g[2], 1, 30)) : [];
  const map = Array.isArray(p.map) && p.map.length <= 7 && p.map.every((r) => typeof r === 'string' && MAP_ROW.test(r) && r.length === p.map[0].length) ? p.map : [];
  return {
    name: cleanName(p.name),
    color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#999999',
    crest: Math.abs(p.crest | 0) % 4,
    kind: p.kind,
    ...(p.left ? { left: true } : {}),
    place: p.place, total: p.total,
    middle: p.middle === 10 ? 10 : 0, harmony: p.harmony === 5 ? 5 : 0,
    largest: int(p.largest, 0, 48) ? p.largest : 0,
    crowns: int(p.crowns, 0, 99) ? p.crowns : 0,
    discards: int(p.discards, 0, 48) ? p.discards : 0,
    props: props.map((g) => [g[0], g[1], g[2]]),
    map: map.slice(),
  };
}

function cleanVerdict(v) {
  if (!v || typeof v !== 'object' || !int(v.decisions, 1, 999) || !(v.loss >= 0 && v.loss < 1000)) return null;
  const counts = {};
  for (const [g, n] of Object.entries(v.counts || {})) if (/^[A-Z][a-z]{2,10}$/.test(g) && int(n, 0, 999)) counts[g] = n;
  return { decisions: v.decisions, loss: v.loss, counts, hints: int(v.hints, 0, 999) ? v.hints : 0 };
}

// A record that is sound enough to show and count, copied field by field, or null.
export function cleanRecord(r) {
  if (!r || typeof r !== 'object' || r.v !== VERSION || typeof r.id !== 'string' || !/^[\w-]{1,40}$/.test(r.id)) return null;
  if (!Number.isFinite(r.end) || !Array.isArray(r.players) || r.players.length < 2 || r.players.length > 4) return null;
  const players = r.players.map(cleanPlayer);
  if (players.some((p) => !p)) return null;
  const rules = r.rules || {};
  return {
    v: VERSION, id: r.id,
    start: Number.isFinite(r.start) && r.start <= r.end ? r.start : null, end: r.end,
    online: r.online === 'host' || r.online === 'guest' ? r.online : null,
    rules: { middleKingdom: !!rules.middleKingdom, harmony: !!rules.harmony, mightyDuel: !!rules.mightyDuel },
    seed: int(r.seed, 0, 2 ** 32 - 1) ? r.seed : null,
    coach: r.coach === 'trainer' || r.coach === 'study' ? r.coach : null,
    players,
    verdict: cleanVerdict(r.verdict),
  };
}

// The games in an exported file. Throws an Error that can be shown as it is.
export function parseExport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not a Kingdomino history.'); }
  const games = Array.isArray(data) ? data : data && Array.isArray(data.games) ? data.games : null;
  if (!games) throw new Error('This file is not a Kingdomino history.');
  const clean = games.map(cleanRecord).filter(Boolean);
  if (games.length && !clean.length) throw new Error('No game in this file could be read.');
  return clean;
}

// ---------- the history in this browser ----------
// storage: localStorage, or anything with getItem / setItem / removeItem. Every call reads it afresh,
// so two open tabs never write over each other's games.
export class GameLog {
  constructor(storage, key = 'kingdomino3d-history') {
    this.storage = storage;
    this.key = key;
  }

  // Oldest first.
  all() {
    try {
      const data = JSON.parse(this.storage.getItem(this.key) || 'null');
      return data && Array.isArray(data.games) ? data.games.map(cleanRecord).filter(Boolean).sort((a, b) => a.end - b.end) : [];
    } catch { return []; }
  }

  // Oldest first. When the browser refuses the space, the oldest games go a quarter at a time.
  write(games) {
    games.sort((a, b) => a.end - b.end);
    if (games.length > KEEP) games.splice(0, games.length - KEEP);
    for (;;) {
      try {
        this.storage.setItem(this.key, JSON.stringify({ v: VERSION, games }));
        return true;
      } catch {
        if (games.length < 8) return false;
        games.splice(0, Math.ceil(games.length / 4));
      }
    }
  }

  // A new game, or a newer copy of one already kept (the same id).
  save(record) { return this.write([...this.all().filter((g) => g.id !== record.id), record]); }

  // Imported games join the history; the ones already in it are left as they are.
  merge(records) {
    const games = this.all(), ids = new Set(games.map((g) => g.id));
    const fresh = records.filter((r) => !ids.has(r.id) && ids.add(r.id));
    const ok = !fresh.length || this.write([...games, ...fresh]);
    return { added: ok ? fresh.length : 0, known: records.length - fresh.length, ok };
  }

  clear() { try { this.storage.removeItem(this.key); } catch { /* storage off */ } }

  exportText() {
    return JSON.stringify({ app: 'kingdomino-3d', type: 'history', v: VERSION, exported: new Date().toISOString(), games: this.all() });
  }
}

// ---------- stats ----------
// The menu calls the player "You", and a host's "You" becomes "Host": both are the same person.
export const profileName = (name) => (/^(you|host)$/i.test(String(name).trim()) ? 'You' : String(name).trim());
const profileKey = (name) => profileName(name).toLowerCase();

// The people who played at this screen, most games first.
export function profiles(records) {
  const out = new Map();
  for (const r of records) {
    for (const k of new Set(r.players.filter((p) => p.kind === 'here').map((p) => profileKey(p.name)))) {
      const p = r.players.find((q) => q.kind === 'here' && profileKey(q.name) === k);
      const e = out.get(k) || { name: profileName(p.name), games: 0, last: 0 };
      e.games++;
      if (r.end > e.last) { e.last = r.end; e.name = profileName(p.name); }
      out.set(k, e);
    }
  }
  return [...out.values()].sort((a, b) => b.games - a.games || b.last - a.last);
}

// This person's games, oldest first: [{ r: record, me: their seat in it }]
function gamesOf(records, name) {
  const key = profileKey(name);
  return records
    .map((r) => ({ r, me: r.players.find((p) => p.kind === 'here' && profileKey(p.name) === key) }))
    .filter((g) => g.me)
    .sort((a, b) => a.r.end - b.r.end);
}

// Ahead of, behind or level with an opponent at the end.
const versus = (me, o) => (me.place < o.place ? 'won' : me.place > o.place ? 'lost' : 'tied');
const tallyEntry = () => ({ games: 0, won: 0, lost: 0, tied: 0 });
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// Points lost per move over some coached games, each move counting once.
function coachLoss(games) {
  const decisions = games.reduce((a, g) => a + g.r.verdict.decisions, 0);
  return { games: games.length, decisions, loss: decisions ? games.reduce((a, g) => a + g.r.verdict.loss * g.r.verdict.decisions, 0) / decisions : 0 };
}

export function statsFor(records, name) {
  const games = gamesOf(records, name);
  const wins = games.filter((g) => g.me.place === 1).length;
  let streak = 0, bestStreak = 0;
  for (const g of games) { streak = g.me.place === 1 ? streak + 1 : 0; bestStreak = Math.max(bestStreak, streak); }

  // head to head: every opponent at the table, by AI level or by person (friends who left don't count)
  const levels = Object.fromEntries(AI_LEVELS.map((l) => [l, tallyEntry()]));
  const people = new Map();
  for (const { r, me } of games) {
    for (const o of r.players) {
      if (o === me || o.left) continue;
      let e;
      if (AI_LEVELS.includes(o.kind)) e = levels[o.kind];
      else {
        const k = profileKey(o.name);
        if (!people.has(k)) people.set(k, { name: profileName(o.name), ...tallyEntry() });
        e = people.get(k);
        e.name = profileName(o.name);
      }
      e.games++;
      e[versus(me, o)]++;
    }
  }

  let best = null, richest = null, mostCrowns = null;
  for (const { r, me } of games) {
    if (!best || me.total > best.total) best = { total: me.total, end: r.end, id: r.id };
    if (!mostCrowns || me.crowns > mostCrowns.crowns) mostCrowns = { crowns: me.crowns, end: r.end, id: r.id };
    for (const [terrain, size, crowns] of me.props) {
      if (!richest || size * crowns > richest.score) richest = { terrain, size, crowns, score: size * crowns, end: r.end, id: r.id };
    }
  }
  const bonus = (rule, field) => {
    const on = games.filter((g) => g.r.rules[rule]);
    return { got: on.filter((g) => g.me[field] > 0).length, of: on.length };
  };

  // the coach: all graded games, and the last five against the ones before
  const coached = games.filter((g) => g.r.verdict);
  const counts = {};
  for (const g of coached) for (const [grade, n] of Object.entries(g.r.verdict.counts)) counts[grade] = (counts[grade] || 0) + n;

  return {
    name: games.length ? profileName(games[games.length - 1].me.name) : profileName(name),
    games: games.length,
    first: games.length ? games[0].r.end : null,
    wins,
    winRate: games.length ? wins / games.length : 0,
    average: avg(games.map((g) => g.me.total)),
    averageCrowns: avg(games.map((g) => g.me.crowns)),
    best, richest, mostCrowns,
    streak: { current: streak, best: bestStreak },
    levels: AI_LEVELS.filter((l) => levels[l].games).map((l) => ({ level: l, ...levels[l] })),
    people: [...people.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)),
    middle: bonus('middleKingdom', 'middle'),
    harmony: bonus('harmony', 'harmony'),
    recent: games.slice(-20).map(({ r, me }) => ({ id: r.id, end: r.end, total: me.total, place: me.place, players: r.players.length })),
    coach: coached.length ? {
      ...coachLoss(coached),
      counts,
      recent: coached.length >= 6 ? coachLoss(coached.slice(-5)) : null,
      earlier: coached.length >= 6 ? coachLoss(coached.slice(0, -5)) : null,
    } : null,
  };
}

// What stands out about a game just played, for the people at this screen, against the games before it:
// [{ type: 'best', name, total, previous }] for a new personal best, [{ type: 'expert', name }] for a
// first win over the Expert.
export function highlights(records, record) {
  const out = [];
  const before = records.filter((r) => r.id !== record.id);
  for (const me of record.players.filter((p) => p.kind === 'here')) {
    const past = gamesOf(before, me.name);
    const experts = record.players.filter((o) => o.kind === 'expert');
    const beatExpert = (g, them) => them.some((o) => g.place < o.place);
    if (experts.length && beatExpert(me, experts) && !past.some((g) => beatExpert(g.me, g.r.players.filter((o) => o.kind === 'expert')))) {
      out.push({ type: 'expert', name: profileName(me.name) });
    }
    const previous = Math.max(...past.map((g) => g.me.total));
    if (past.length && me.total > previous) out.push({ type: 'best', name: profileName(me.name), total: me.total, previous });
  }
  return out;
}
