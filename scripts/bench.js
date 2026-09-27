// Head-to-head benchmark: the expert search against a heuristic level, on paired deals (every deal is
// played once from each seat, so the luck of the draw cancels out).
//   node scripts/bench.js --games 40 --vs hard --sims 2000 --players 2 --middle --harmony --duel
import { playGame } from './headless.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const games = +arg('games', 20), players = +arg('players', 2), vs = arg('vs', 'hard');
const budget = { sims: +arg('sims', 2000), ms: +arg('ms', 10000) };
const rules = { middleKingdom: !!arg('middle', false), harmony: !!arg('harmony', false), mightyDuel: !!arg('duel', false) };

let wins = 0, ties = 0, losses = 0, margin = 0, sims = 0, ms = 0, moves = 0;
const t0 = performance.now();
for (let g = 0; g < games; g++) {
  // the expert takes each seat in turn; every other seat is the heuristic
  const seat = g % players, seed = 1000 + Math.floor(g / players);
  const types = Array.from({ length: players }, (_, i) => (i === seat ? 'expert' : vs));
  const { ranking, stats } = playGame({ types, seed, ...rules, budget });
  const me = ranking.find((r) => r.player.type === 'expert');
  const best = Math.max(...ranking.filter((r) => r !== me).map((r) => r.s.total));
  const shared = ranking.filter((r) => r.place === 1).length > 1;
  if (me.place === 1 && !shared) wins++;
  else if (me.place === 1) ties++;
  else losses++;
  margin += me.s.total - best;
  sims += stats.sims; ms += stats.ms; moves += stats.moves;
  console.log(`game ${g + 1} (deal ${seed}, seat ${seat}): expert ${me.s.total} vs best ${vs} ${best}  running ${wins}-${ties}-${losses}`);
}
console.log(`\nexpert vs ${vs}, ${players} players${rules.middleKingdom ? ', Middle Kingdom' : ''}${rules.harmony ? ', Harmony' : ''}${rules.mightyDuel ? ', Mighty Duel' : ''}`);
console.log(`${wins} wins, ${ties} ties, ${losses} losses over ${games} games; average margin ${(margin / games).toFixed(1)} points`);
console.log(`${Math.round(sims / moves)} simulations and ${Math.round(ms / moves)} ms per move; ${((performance.now() - t0) / 1000).toFixed(0)} s in all`);
