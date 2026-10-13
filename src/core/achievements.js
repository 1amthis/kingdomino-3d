// Achievements: feats a person at this screen earns over their games. Nothing of them is stored: they are
// read from the history (core/history.js) every time, so the games already played count from the start,
// an imported history brings its achievements along, and each one knows the game that earned it.
// The names and texts are in English, as the core keeps them; the interface translates them.
import { decodeMap, gamesOf, verdictOf, dynastyResult, profileName, AI_LEVELS } from './history.js';

const won = (me) => me.place === 1;
// won, and ahead of an opponent of this kind (one who stayed to the end)
const beat = (r, me, kind) => won(me) && r.players.some((o) => o !== me && o.kind === kind && !o.left && o.place > me.place);
// the whole kingdom filled: 5×5, or 7×7 in the Mighty Duel
function fullKingdom(r, me) {
  const n = r.rules.mightyDuel ? 7 : 5, grid = decodeMap(me.map);
  return grid.length === n && grid.every((row) => row.length === n && row.every(Boolean));
}
const centred = (r, me) => { const grid = decodeMap(me.map), mid = grid.length >> 1; return !!grid[mid] && !!grid[mid][mid] && grid[mid][mid].terrain === 'castle'; };
// the coach graded the whole game (or nearly: it could be turned on after the first moves)
const graded = (g) => { const v = verdictOf(g); return v && v.decisions >= 20 ? v : null; };

// Ways to earn one, each giving { at: the index of the game that earned it, or -1, have, need }.
// once: the first game that passes; count: the need-th game that passes (have: how many so far).
const once = (test) => (games, records) => {
  const at = games.findIndex((g) => test(g, records));
  return { at, have: at < 0 ? 0 : 1, need: 1 };
};
const count = (need, test = () => true) => (games, records) => {
  let have = 0, at = -1;
  games.forEach((g, i) => { if (test(g, records) && ++have === need) at = i; });
  return { at, have: Math.min(have, need), need };
};
const streak = (need) => (games) => {
  let run = 0, best = 0, at = -1;
  games.forEach((g, i) => { run = won(g.me) ? run + 1 : 0; best = Math.max(best, run); if (run === need && at < 0) at = i; });
  return { at, have: Math.min(best, need), need };
};
// a win against every level of the computer
const ladder = (games) => {
  const beaten = new Set();
  let at = -1;
  games.forEach(({ r, me }, i) => {
    for (const l of AI_LEVELS) if (beat(r, me, l)) beaten.add(l);
    if (beaten.size === AI_LEVELS.length && at < 0) at = i;
  });
  return { at, have: beaten.size, need: AI_LEVELS.length };
};

export const GROUPS = ['victories', 'kingdoms', 'mastery', 'journey'];

// The order here is the order they show in. An id never changes: it is how a game knows what it earned.
export const ACHIEVEMENTS = [
  { id: 'first-win', group: 'victories', name: 'First Crown', text: 'Win a game.', earn: once(({ me }) => won(me)) },
  { id: 'beat-expert', group: 'victories', name: 'Giant Slayer', text: 'Win a game against the Expert.', earn: once(({ r, me }) => beat(r, me, 'expert')) },
  { id: 'all-levels', group: 'victories', name: 'Up the Ladder', text: 'Win against each level of the computer: Easy, Normal, Hard and Expert.', earn: ladder },
  { id: 'four-players', group: 'victories', name: 'King of Kings', text: 'Win a four-player game.', earn: once(({ r, me }) => r.players.length === 4 && won(me)) },
  { id: 'duel', group: 'victories', name: 'Mighty Duellist', text: 'Win a Mighty Duel.', earn: once(({ r, me }) => r.rules.mightyDuel && won(me)) },
  { id: 'dynasty', group: 'victories', name: 'Founder of a Dynasty', text: 'Win a Dynasty.', earn: once(({ r, me }, records) => dynastyResult(records, r, me) === 'won') },
  { id: 'hat-trick', group: 'victories', name: 'Hat Trick', text: 'Win 3 games in a row.', earn: streak(3) },
  {
    id: 'photo-finish', group: 'victories', name: 'Photo Finish', text: 'Win by a single point, or on a tie-breaker.',
    earn: once(({ r, me }) => won(me) && r.players.some((o) => o.place > 1 && o.total >= me.total - 1)),
  },
  { id: 'among-friends', group: 'victories', name: 'Among Friends', text: 'Win an online game against a friend.', earn: once(({ r, me }) => !!r.online && beat(r, me, 'friend')) },

  { id: 'score-60', group: 'kingdoms', name: 'Prosperity', text: 'Score 60 points in a game.', earn: once(({ me }) => me.total >= 60) },
  { id: 'score-80', group: 'kingdoms', name: 'Golden Age', text: 'Score 80 points in a game.', earn: once(({ me }) => me.total >= 80) },
  { id: 'jewel', group: 'kingdoms', name: 'Crown Jewel', text: 'Build a single property worth 30 points.', earn: once(({ me }) => me.props.some(([, size, crowns]) => size * crowns >= 30)) },
  { id: 'crowns-12', group: 'kingdoms', name: 'Crown Collector', text: 'Gather 12 crowns in one kingdom.', earn: once(({ me }) => me.crowns >= 12) },
  { id: 'vast', group: 'kingdoms', name: 'Vast Domain', text: 'Build a property of 10 squares.', earn: once(({ me }) => me.largest >= 10) },
  { id: 'six-terrains', group: 'kingdoms', name: 'Six Realms', text: 'Score with all six terrains in one kingdom.', earn: once(({ me }) => new Set(me.props.map(([terrain]) => terrain)).size === 6) },
  { id: 'full', group: 'kingdoms', name: 'Not a Square to Spare', text: 'Fill every square of your kingdom.', earn: once(({ r, me }) => fullKingdom(r, me)) },
  { id: 'flawless', group: 'kingdoms', name: 'Flawless Realm', text: 'Fill every square of your kingdom, with your castle in the middle.', earn: once(({ r, me }) => fullKingdom(r, me) && centred(r, me)) },

  { id: 'steady', group: 'mastery', name: 'Steady Hand', text: 'Play a game the coach grades without a single Mistake or Blunder.', earn: once((g) => { const v = graded(g); return !!v && !v.counts.Mistake && !v.counts.Blunder; }) },
  { id: 'sharp', group: 'mastery', name: 'The Expert’s Eye', text: 'Play a game the coach grades with under 1 point lost per move.', earn: once((g) => { const v = graded(g); return !!v && v.loss < 1; }) },
  { id: 'student', group: 'mastery', name: 'Eager Student', text: 'Have the coach grade 10 of your games.', earn: count(10, (g) => !!graded(g)) },

  { id: 'games-10', group: 'journey', name: 'Regular', text: 'Play 10 games.', earn: count(10) },
  { id: 'games-50', group: 'journey', name: 'Courtier', text: 'Play 50 games.', earn: count(50) },
  { id: 'games-100', group: 'journey', name: 'Pillar of the Court', text: 'Play 100 games.', earn: count(100) },
  { id: 'wins-25', group: 'journey', name: 'Conqueror', text: 'Win 25 games.', earn: count(25, ({ me }) => won(me)) },
];

// Every achievement for this person, in order: { id, group, name, text, done, have, need, game: the
// record that earned it (or null) }.
export function achievementsFor(records, name) {
  const games = gamesOf(records, name);
  return ACHIEVEMENTS.map(({ earn, ...a }) => {
    const { at, have, need } = earn(games, records);
    return { ...a, done: at >= 0, have, need, game: at >= 0 ? games[at].r : null };
  });
}

// What the game just played earned, for each person at this screen: [{ name, earned: [achievement] }].
// records: the history, with or without the game itself.
export function newAchievements(records, record) {
  const all = [...records.filter((r) => r.id !== record.id), record];
  const out = [];
  for (const name of new Set(record.players.filter((p) => p.kind === 'here').map((p) => profileName(p.name)))) {
    const earned = achievementsFor(all, name).filter((a) => a.game === record);
    if (earned.length) out.push({ name, earned });
  }
  return out;
}
