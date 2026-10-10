// The history window: every game finished in this browser, and each person's stats drawn from them; a
// game can be played back move by move, and reviewed by the coach. Everything lives in this browser's
// storage; export and import carry it to another one.
import { TERRAIN_INFO } from '../core/rules.js';
import { decodeMap, profiles, statsFor, parseExport, highlights, dynastyOf } from '../core/history.js';
import { GAMES } from '../core/dynasty.js';
import { replayable, replayRecord } from '../core/replay.js';
import { reviewedSeats, reviewPlan, reviewVerdicts, gradeOf, isPoor } from '../core/review.js';
import { ReplayView } from './replay.js';
import { ReviewRunner } from './review.js';
import { esc, shieldSVG, pips, CROWN_SVG, dynastyTable } from './hud.js';
import { gradeLabel } from '../core/coach.js';
import { t, tn, locale } from '../i18n/index.js';

const $ = (s) => document.querySelector(s);
const LEVELS = { easy: [t('Easy'), 1], normal: [t('Normal'), 2], hard: [t('Hard'), 3], expert: [t('Expert'), 4] };
const KIND_TAG = { here: t('Human'), friend: t('Online'), easy: t('Easy'), normal: t('Normal'), hard: t('Hard'), expert: t('Expert') };
const PAGE = 40;

const ORDINALS = [t('1st'), t('2nd'), t('3rd'), t('4th')];
const ordinal = (n) => ORDINALS[n - 1] || String(n); // places run 1 to 4
const PERCENT = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
const pct = (x) => PERCENT.format(x);
const oneDecimal = (x) => (Math.round(x * 10) / 10).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const listOf = (xs) => (xs.length < 2 ? xs.join('') : t('{list} and {last}', { list: xs.slice(0, -1).join(', '), last: xs[xs.length - 1] }));
// The menu's default name ("You", or its translation) is the person at this screen; a record keeps the
// name as it was typed, and shows it in the player's language.
const isYou = (name) => { const n = String(name).trim().toLowerCase(); return n === 'you' || n === t('You').toLowerCase(); };
const nameOf = (name) => (isYou(name) ? t('You') : name);

// "Today, 14:32", "Yesterday, 09:10", "3 Oct, 14:32", "3 Oct 2025"; long: "Friday 3 October, 14:32"
function when(at, { long = false, time: withTime = true } = {}) {
  const d = new Date(at), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((day(now) - day(d)) / 864e5);
  if (days === 0) return withTime ? t('Today, {time}', { time }) : t('Today');
  if (days === 1) return withTime ? t('Yesterday, {time}', { time }) : t('Yesterday');
  const opts = long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' };
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1); // (a French weekday comes in lower case)
  if (d.getFullYear() !== now.getFullYear()) return cap(d.toLocaleDateString(locale, { ...opts, year: 'numeric' }));
  const date = cap(d.toLocaleDateString(locale, opts));
  return withTime ? t('{date}, {time}', { date, time }) : date;
}

// How the table was laid: online, several people at one screen, one person against the computer...
function modeOf(r) {
  const here = r.players.filter((p) => p.kind === 'here').length;
  const mode = r.online ? t('Online') : here > 1 ? t('Same screen') : here ? t('Against the computer') : t('Computer only');
  return [mode, r.rules.mightyDuel ? t('Mighty Duel') : t('{n} players', { n: r.players.length })];
}

// The seat the history looks at in a game: the person at this screen (or the winner, without one).
const focusOf = (r) => r.players.find((p) => p.kind === 'here') || r.players.find((p) => p.place === 1);

// A kingdom square by square, centred in a frame the size of a full one (5×5, 7×7 in the Mighty Duel).
export function kingdomSVG(map, { cell = 10, size = 5, crowns = true } = {}) {
  const grid = decodeMap(map), rows = grid.length, cols = rows ? grid[0].length : 0;
  const n = Math.max(size, rows, cols), W = n * cell, gap = cell >= 10 ? 1 : 0.6, s = cell - 2 * gap;
  const ox = ((n - cols) / 2) * cell, oy = ((n - rows) / 2) * cell;
  let out = `<rect width="${W}" height="${W}" rx="${cell * 0.35}" fill="rgba(255,255,255,0.05)"/>`;
  grid.forEach((row, y) => row.forEach((c, x) => {
    if (!c) return;
    const px = ox + x * cell + gap, py = oy + y * cell + gap;
    out += c.terrain === 'castle'
      ? `<rect x="${px}" y="${py}" width="${s}" height="${s}" rx="${s * 0.2}" fill="#d9cfb8" stroke="#f0c75e" stroke-width="${Math.max(1, cell / 9)}"/>`
      : `<rect x="${px}" y="${py}" width="${s}" height="${s}" rx="${s * 0.2}" fill="${TERRAIN_INFO[c.terrain].color}"/>`;
    if (crowns && c.crowns) {
      for (let i = 0; i < c.crowns; i++) out += `<circle cx="${px + s * (0.5 + (i - (c.crowns - 1) / 2) * 0.3)}" cy="${py + s * 0.28}" r="${s * 0.12}" fill="#fff3c4" stroke="#3a2604" stroke-width="${s * 0.05}"/>`;
    }
  }));
  return `<svg class="kmap" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" aria-hidden="true">${out}</svg>`;
}

export class HistoryView {
  // hud: for its questions; log: the GameLog (core/history.js)
  constructor(hud, log) {
    this.hud = hud;
    this.log = log;
    this.el = $('#history');
    this.body = $('#history-body');
    this.tab = 'stats';
    this.profile = null;
    this.shown = PAGE;
    this.view = null; // 'replay' while the open game plays back
    this.replay = null; // its ReplayView
    this.replays = new Map(); // game id → replayRecord()'s frames and turns, or null if it cannot be replayed
    this.reviews = new ReviewRunner(log, (r, error) => this.reviewed(r, error));
    $('#menu-history').addEventListener('click', () => this.open());
    this.el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.gameId = null; this.view = null; this.render(); }));
    $('#history-export').addEventListener('click', () => this.exportFile());
    const file = $('#history-file');
    $('#history-import').addEventListener('click', () => file.click());
    file.addEventListener('change', () => { if (file.files[0]) this.importFile(file.files[0]); file.value = ''; });
    $('#history-clear').addEventListener('click', () => this.clear());
    this.body.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => { if (this.replay && !this.el.classList.contains('hidden')) this.replay.key(e); });
    // however the window closes (its button, a click beside it, Escape), the review and the replay stop
    new MutationObserver(() => {
      if (!this.el.classList.contains('hidden')) return;
      if (this.reviews.job) { this.reviews.stop(); this.say(''); }
      if (this.replay) this.replay.pause();
    }).observe(this.el, { attributes: true, attributeFilter: ['class'] });
  }

  // gameId: open straight at that game
  open(tab = this.tab, gameId = null) {
    this.tab = tab;
    this.gameId = gameId;
    this.view = null;
    this.shown = PAGE;
    this.say('');
    this.render();
    this.el.classList.remove('hidden');
  }

  // The game just finished, from the results card: the coach's review is brought into view, under
  // the scores, since that is what the player came for.
  openGame(id) {
    this.open('games', id);
    const sec = this.body.querySelector('#h-review');
    if (sec) sec.scrollIntoView({ block: 'nearest' });
  }

  close() { this.el.classList.add('hidden'); }

  say(text) { $('#history-msg').textContent = text; }

  render() {
    const records = this.log.all();
    this.records = records;
    this.el.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === this.tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === this.tab));
    });
    $('#history-export').disabled = $('#history-clear').disabled = !records.length;
    const game = this.gameId && records.find((r) => r.id === this.gameId);
    if (this.replay) this.replay.pause();
    this.replay = game && this.view === 'replay' && this.replayOf(game) ? new ReplayView(game, this.replayOf(game), this.step) : null;
    this.body.innerHTML = !records.length ? this.empty()
      : this.replay ? this.replayHead(game) + this.replay.html()
        : game ? this.gameView(game)
          : this.tab === 'stats' ? this.statsView(records) : this.listView(records);
    this.body.scrollTop = 0;
    if (this.replay) this.replay.mount(this.body);
    this.wireChart();
  }

  empty() {
    return `<div class="h-empty"><div class="title-crown small"><svg viewBox="0 0 64 48"><path d="M4 40 L4 12 L18 26 L32 4 L46 26 L60 12 L60 40 Z"/></svg></div>
      <p><b>${t('No games yet.')}</b></p><p>${t('Every game you finish is kept here: the scores, each kingdom, and your stats against the computer and your friends.')}</p></div>`;
  }

  onClick(e) {
    const el = e.target.closest('[data-game], [data-profile], [data-more], [data-back], [data-back-game], [data-replay], [data-review], [data-review-stop]');
    if (!el) return;
    const d = el.dataset;
    if (d.game) { this.gameId = d.game; this.view = null; this.render(); }
    else if (d.profile) { this.profile = d.profile; this.render(); }
    else if (d.more != null) { this.shown += PAGE; this.render(); }
    else if (d.back != null) { this.gameId = null; this.render(); }
    else if (d.backGame != null) { this.view = null; this.render(); }
    else if (d.replay != null) { this.view = 'replay'; this.step = Number(d.replay) || 0; this.render(); }
    else if (d.review != null) { this.say(''); this.reviews.run(this.gameId); }
    else if (d.reviewStop != null) { this.reviews.stop(); this.reviewed(this.log.all().find((r) => r.id === this.gameId)); }
  }

  // A game played back: its moves replayed with the rules (cached, they never change), or null.
  replayOf(r) {
    if (!this.replays.has(r.id)) {
      let data = null;
      try { if (replayable(r)) data = replayRecord(r); } catch (e) { console.warn('[replay]', e.message); }
      this.replays.set(r.id, data);
    }
    return this.replays.get(r.id);
  }

  // ---------- stats ----------
  statsView(records) {
    const people = profiles(records);
    if (!people.length) return `<div class="h-empty"><p>${t('Stats follow the people who play at this screen. So far, only the computer has played.')}</p></div>`;
    if (!people.some((p) => p.name === this.profile)) this.profile = people[0].name;
    const s = statsFor(records, this.profile);
    const you = isYou(s.name);
    const picker = people.length > 1
      ? `<div class="h-who"><span>${t('Stats for')}</span><div class="seg">${people.map((p) => `<button data-profile="${esc(p.name)}" class="${p.name === s.name ? 'on' : ''}">${esc(nameOf(p.name))}</button>`).join('')}</div></div>`
      : '';
    const tiles = [
      [s.games, tn(s.games, 'Game', 'Games'), s.games > 1 ? t('since {date}', { date: when(s.first, { time: false }) }) : ''],
      [s.wins, tn(s.wins, 'Win', 'Wins'), t('{pct} of games', { pct: pct(s.winRate) })],
      [Math.round(s.average), t('Average score'), t('{n} crowns a game', { n: oneDecimal(s.averageCrowns) })],
      [s.best.total, t('Best score'), when(s.best.end, { time: false })],
    ].map(([v, label, sub]) => `<div class="h-tile"><b>${v}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`).join('');

    const record = (e) => [tn(e.won, '<b>{n}</b> win', '<b>{n}</b> wins'), tn(e.lost, '{n} loss', '{n} losses'), e.tied && tn(e.tied, '{n} tie', '{n} ties')].filter(Boolean).join(' · ');
    const h2h = (rows) => `<div class="h2h">${rows.map((e) => `<div class="h2h-row"><span class="h2h-who">${e.who}</span>
      <span class="h2h-bar" title="${t('{pct} won', { pct: pct(e.won / e.games) })}"><i style="width:${(e.won / e.games) * 100}%"></i></span>
      <span class="h2h-rec">${record(e)}</span><span class="h2h-pct">${pct(e.won / e.games)}</span></div>`).join('')}</div>`;
    const levels = s.levels.length ? section(t('Against the computer'), h2h(s.levels.map((e) => ({ ...e, who: `${LEVELS[e.level][0]} ${pips(LEVELS[e.level][1])}` })))
      + `<p class="h-hint">${t('Each opponent at the table counts once: won when you finish ahead of them.')}</p>`) : '';
    const people2 = s.people.length ? section(t('Against people'), h2h(s.people.map((e) => ({ ...e, who: `<span class="h2h-name">${esc(nameOf(e.name))}</span>` })))) : '';

    const facts = [];
    if (s.richest) {
      const info = TERRAIN_INFO[s.richest.terrain];
      facts.push([t('Richest property'), `<span class="chip" style="background:${info.color}"></span> ${info.name}, ${s.richest.size} &times; ${s.richest.crowns} = <b>${s.richest.score}</b>`]);
    }
    if (s.mostCrowns) facts.push([t('Most crowns in a game'), `${CROWN_SVG} <b>${s.mostCrowns.crowns}</b>`]);
    facts.push([t('Longest winning run'), `<b>${s.streak.best}</b>${s.streak.current > 1 ? ` · ${t('{n} in a row now', { n: s.streak.current })}` : ''}`]);
    const ofGames = (got, of) => tn(of, '<b>{got}</b> of {n} game', '<b>{got}</b> of {n} games', { got });
    if (s.middle.of) facts.push([t('Middle Kingdom'), ofGames(s.middle.got, s.middle.of)]);
    if (s.harmony.of) facts.push([t('Harmony'), ofGames(s.harmony.got, s.harmony.of)]);
    if (s.dynasties.of) facts.push([t('Dynasties won'), t('<b>{got}</b> of {n}', { got: s.dynasties.won, n: s.dynasties.of })]);
    const records2 = section(t('Records'), `<div class="h-facts">${facts.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('')}</div>`);

    return `${picker}<div class="h-tiles">${tiles}</div>
      ${s.recent.length >= 3 ? section(you ? t('Your last {n} games', { n: s.recent.length }) : t('{name}’s last {n} games', { name: esc(s.name), n: s.recent.length }), this.chart(s)) : ''}
      ${levels}${people2}${records2}${this.coachView(s)}`;
  }

  // One column per game, oldest on the left; a crown over each win, a line at the average.
  chart(s) {
    const games = s.recent, max = Math.max(...games.map((g) => g.total), 1);
    const step = max > 80 ? 40 : max > 40 ? 20 : 10, top = Math.ceil(max / step) * step;
    const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
    const avg = games.reduce((a, g) => a + g.total, 0) / games.length;
    const cols = games.map((g) => {
      const tip = `${tn(g.total, '{n} point', '{n} points')}|${when(g.end)} · ${g.place === 1 ? t('won') : t('{place} of {n}', { place: ordinal(g.place), n: g.players })}`;
      return `<span class="hc-col${g.place === 1 ? ' won' : ''}" tabindex="0" data-tip="${esc(tip)}" data-game="${g.id}">
        <i style="height:${(g.total / top) * 100}%">${g.place === 1 ? CROWN_SVG : ''}</i></span>`;
    }).join('');
    return `<div class="hchart" role="group" aria-label="${t('Scores of the last {n} games, oldest first, average {avg}', { n: games.length, avg: Math.round(avg) })}">
      <div class="hc-plot">
        ${ticks.map((v) => `<div class="hc-tick" style="bottom:${(v / top) * 100}%"><span>${v}</span></div>`).join('')}
        <div class="hc-avg" style="bottom:${(avg / top) * 100}%"><span>${t('average {n}', { n: Math.round(avg) })}</span></div>
        <div class="hc-cols">${cols}</div>
        <div class="hc-tip hidden"><b></b><span></span></div>
      </div></div>
      <p class="h-hint">${t('A crown marks each win and the line the average, <b>{n}</b>. Open a game from its column.', { n: Math.round(avg) })}</p>`;
  }

  // The chart's tooltip: the hovered (or focused) game's score, date and place. A tap opens the game.
  wireChart() {
    const plot = this.body.querySelector('.hc-plot');
    if (!plot) return;
    const tip = plot.querySelector('.hc-tip');
    const show = (col) => {
      const [value, rest] = col.dataset.tip.split('|');
      tip.querySelector('b').textContent = value;
      tip.querySelector('span').textContent = rest;
      tip.classList.remove('hidden');
      const p = plot.getBoundingClientRect(), c = col.getBoundingClientRect(), bar = col.querySelector('i').getBoundingClientRect();
      const x = Math.min(p.width - tip.offsetWidth / 2, Math.max(tip.offsetWidth / 2, c.left + c.width / 2 - p.left));
      tip.style.left = `${x}px`;
      tip.style.bottom = `${Math.min(p.bottom - bar.top + 8, p.height - tip.offsetHeight)}px`;
      plot.querySelectorAll('.hc-col.on').forEach((o) => o.classList.remove('on'));
      col.classList.add('on');
    };
    const hide = () => { tip.classList.add('hidden'); plot.querySelectorAll('.hc-col.on').forEach((o) => o.classList.remove('on')); };
    plot.querySelectorAll('.hc-col').forEach((col) => {
      col.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(col); });
      col.addEventListener('focus', () => show(col));
      col.addEventListener('blur', hide);
      col.addEventListener('keydown', (e) => { if (e.key === 'Enter') col.click(); });
    });
    plot.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  }

  coachView(s) {
    const c = s.coach;
    if (!c) return '';
    let trend = '';
    if (c.recent) {
      const d = c.earlier.loss - c.recent.loss;
      const word = Math.abs(d) < 0.2 ? t('steady') : d > 0 ? t('improving') : t('slipping');
      trend = `<p class="h-hint">${t('Last 5 games: <b>{now}</b> lost per move, against {before} before ({trend}).', { now: oneDecimal(c.recent.loss), before: oneDecimal(c.earlier.loss), trend: word })}</p>`;
    }
    const over = t('Over {games} ({moves}).', { games: tn(c.games, '{n} graded game', '{n} graded games'), moves: tn(c.decisions, '{n} move', '{n} moves') });
    return section(t('The coach'), `${verdict(c)}<p class="h-hint">${over}</p>${trend}`);
  }

  // ---------- games ----------
  listView(records) {
    const games = records.slice().reverse();
    const rows = games.slice(0, this.shown).map((r, i) => {
      const me = focusOf(r), here = me.kind === 'here';
      const [mode, table] = modeOf(r);
      // a dynasty's games run together under a line that sums it up
      const d = r.dynasty, head = d && (i === 0 || !games[i - 1].dynasty || games[i - 1].dynasty.id !== d.id) ? this.dynastyHead(records, d.id) : '';
      const result = !here ? '' : me.place === 1
        ? `<span class="hg-result won">${r.players.filter((p) => p.place === 1).length > 1 ? t('Shared win') : t('Won')}</span>`
        : `<span class="hg-result">${ordinal(me.place)}</span>`;
      const players = r.players.slice().sort((a, b) => a.place - b.place).map((p) => `<span class="hg-p${p === me && here ? ' me' : ''}">
        ${shieldSVG(p.color, p.crest)}<span class="hg-name">${esc(nameOf(p.name))}</span><b>${p.total}</b></span>`).join('');
      return `${head}<button type="button" class="hg-row${d ? ' in-dyn' : ''}" data-game="${r.id}">
        <span class="hg-map">${kingdomSVG(me.map, { cell: 7, size: r.rules.mightyDuel ? 7 : 5, crowns: false })}</span>
        <span class="hg-main"><span class="hg-when">${when(r.end)}<i>${d ? `${t('Game {n} of {total}', { n: d.game, total: GAMES })} · ` : ''}${mode} · ${table}</i></span><span class="hg-players">${players}</span></span>
        ${result}</button>`;
    }).join('');
    const more = games.length > this.shown ? `<button type="button" class="ghost-btn h-more" data-more>${t('Show {n} more', { n: Math.min(PAGE, games.length - this.shown) })}</button>` : '';
    return `<p class="h-count">${tn(games.length, '{n} game kept in this browser', '{n} games kept in this browser')}</p><div class="hg-list">${rows}</div>${more}`;
  }

  // The line over a dynasty's games in the list: who won it, or how far it went. It opens its latest game.
  dynastyHead(records, id) {
    const d = dynastyOf(records, id), latest = d.games.filter(Boolean).pop();
    const winners = d.standings.filter((row) => row.place === 1).map((row) => `<b style="color:${latest.players[row.seat].color}">${esc(nameOf(latest.players[row.seat].name))}</b>`);
    const total = d.standings[0].s.total;
    const what = !d.complete ? tn(d.games.filter(Boolean).length, 'unfinished, {n} game of {total}', 'unfinished, {n} games of {total}', { total: GAMES })
      : winners.length > 1 ? tn(total, 'shared by {names}, {n} point each', 'shared by {names}, {n} points each', { names: listOf(winners) })
        : tn(total, 'won by {who} with {n} point', 'won by {who} with {n} points', { who: winners[0] });
    return `<button type="button" class="hg-dyn" data-game="${latest.id}"><span class="hg-dyn-name">${t('Dynasty')}</span><span>${what}</span></button>`;
  }

  // A dynasty's standings in one of its games, each game a link to it.
  dynastySection(r) {
    const d = dynastyOf(this.records, r.dynasty.id), latest = d.games.filter(Boolean).pop();
    const heads = d.games.map((g, k) => {
      const name = t('<span class="long">Game </span>{n}', { n: k + 1 });
      return !g ? name : g.id === r.id ? `<span class="dyn-here">${name}</span>` : `<button type="button" class="dyn-link" data-game="${g.id}" title="${t('Open game {n}', { n: k + 1 })}">${name}</button>`;
    });
    const rows = d.standings.map((row) => ({
      place: row.place, player: latest.players[row.seat], total: row.s.total,
      scores: d.games.map((g) => (g ? g.players[row.seat].total : null)),
    }));
    const kept = d.games.filter(Boolean).length, last = d.games.findLastIndex(Boolean) + 1;
    const hint = d.complete ? t('The three games’ scores added up; a tie goes as in one game, over the three. Open a game from its column.')
      : kept < last ? tn(kept, 'The history no longer holds every game of this dynasty: the totals count the {n} game here.', 'The history no longer holds every game of this dynasty: the totals count the {n} games here.')
        : tn(kept, 'Unfinished: {n} game of {total} played.', 'Unfinished: {n} games of {total} played.', { total: GAMES });
    return section(t('The dynasty'), `${dynastyTable(rows, heads)}<p class="h-hint">${hint}</p>`);
  }

  gameView(r) {
    const [mode, table] = modeOf(r);
    const minutes = r.start ? Math.max(1, Math.round((r.end - r.start) / 60000)) : 0;
    const rules = [r.dynasty && t('Dynasty, game {n} of {total}', { n: r.dynasty.game, total: GAMES }), r.rules.middleKingdom && t('Middle Kingdom'), r.rules.harmony && t('Harmony'), r.rules.snake && t('Snake opening'), r.coach && t('Coach: {mode}', { mode: r.coach === 'study' ? t('Study') : t('Trainer') })].filter(Boolean);
    const size = r.rules.mightyDuel ? 7 : 5;
    const rows = r.players.slice().sort((a, b) => a.place - b.place).map((p) => {
      const props = p.props.map(([terrain, n, crowns]) => `<span class="prop"><span class="chip" style="background:${TERRAIN_INFO[terrain].color}"></span>${n}&times;${crowns} = <b>${n * crowns}</b></span>`).join('');
      const bonus = (p.middle ? `<span class="prop bonus">${t('Middle Kingdom')} +10</span>` : '') + (p.harmony ? `<span class="prop bonus">${t('Harmony')} +5</span>` : '');
      const tag = p.left ? t('Left · AI finished') : KIND_TAG[p.kind];
      return `<div class="res-row hd-row ${p.place === 1 ? 'first' : ''}">
        <div class="res-rank">${['I', 'II', 'III', 'IV'][p.place - 1]}</div>${shieldSVG(p.color, p.crest)}
        <div><div class="res-name" style="color:${p.color}">${esc(nameOf(p.name))} <span class="tag">${tag}</span></div>
          <div class="res-props">${props}${bonus}${!props && !bonus ? `<span class="prop">${t('No crowned property')}</span>` : ''}</div></div>
        <div class="hd-map">${kingdomSVG(p.map, { cell: size === 7 ? 9 : 12, size })}</div>
        <div class="res-total">${p.total}</div></div>`;
    }).join('');
    const data = this.replayOf(r);
    const review = data ? this.reviewSection(r, data) : '';
    // once the review is complete, its verdicts stand in for the one given during the game
    const coach = r.verdict && !review.includes('data-reviewed') ? section(t('The coach’s verdict'), verdict(r.verdict)) : '';
    const replay = data ? `<button type="button" class="royal-btn hd-replay" data-replay><span>&#9654; ${t('Replay')}</span></button>` : '';
    return `<div class="hd-head"><button type="button" class="ghost-btn small" data-back>&lsaquo; ${t('All games')}</button>
        <div class="hd-titles"><div class="hd-title">${when(r.end, { long: true })}</div><div class="hd-meta">${[mode, table, minutes && t('{n} min', { n: minutes }), ...rules].filter(Boolean).join(' · ')}</div></div>${replay}</div>
      <div class="hd-rows">${rows}</div>${r.dynasty ? this.dynastySection(r) : ''}${coach}${review}`;
  }

  replayHead(r) {
    const [mode, table] = modeOf(r);
    return `<div class="hd-head"><button type="button" class="ghost-btn small" data-back-game>&lsaquo; ${t('Final scores')}</button>
      <div class="hd-titles"><div class="hd-title">${t('Replay')}</div><div class="hd-meta">${[when(r.end), mode, table].join(' · ')}</div></div></div>`;
  }

  // ---------- the coach's review ----------
  // The people's moves graded after the game: an offer to start (or carry on), the progress while it
  // runs, then each person's verdict and the moves that cost the most.
  reviewSection(r, data) {
    const seats = reviewedSeats(r), plan = seats.length ? reviewPlan(r, data.turns) : [];
    if (!plan.length) return '';
    const review = r.review || {}, done = plan.filter((k) => k in review).length;
    const running = this.reviews.progress(r.id);
    let body;
    if (running) {
      body = `<div class="rv-run"><div class="rv-bar"><i style="width:${(running.done / running.total) * 100}%"></i></div>
        <span class="rv-text">${grading(running)}</span>
        <button type="button" class="ghost-btn small" data-review-stop>${t('Stop')}</button></div>
        <p class="h-hint">${t('One move at a time, while this window stays open.')}</p>`;
    } else if (done < plan.length) {
      const people = seats.map((i) => r.players[i].name);
      const minutes = Math.max(1, Math.ceil(((plan.length - done) * 2.5) / 60));
      const upTo = tn(minutes, '{n} minute', '{n} minutes');
      const offer = people.length === 1 && isYou(people[0])
        ? t('Now that the game is over, the coach can grade every move you made, as it does during a game, and show where the game turned. It looks at one move at a time while this window stays open: up to {time}.', { time: upTo })
        : t('Now that the game is over, the coach can grade every move by {names}, as it does during a game, and show where the game turned. It looks at one move at a time while this window stays open: up to {time}.', { names: listOf(people.map((n) => esc(nameOf(n)))), time: upTo });
      body = `<p class="h-hint">${offer}${r.verdict ? ` ${t('Its numbers can differ a little from the ones given during the game.')}` : ''}</p>
        <button type="button" class="ghost-btn small rv-start" data-review>${done ? t('Carry on ({n} of {total} moves graded)', { n: done, total: plan.length }) : t('Review this game')}</button>`;
    } else body = this.reviewResult(r, data, plan, seats);
    return `<div class="h-sec" id="h-review"${running || done < plan.length ? '' : ' data-reviewed'}><h3>${t('The coach’s review')}</h3>${body}</div>`;
  }

  reviewResult(r, data, plan, seats) {
    const verdicts = reviewVerdicts(r, plan, data.turns);
    const many = seats.length > 1;
    const people = seats.filter((i) => verdicts[i]).map((i) => {
      const p = r.players[i];
      return `${many ? `<div class="rv-who">${shieldSVG(p.color, p.crest)}<span style="color:${p.color}">${esc(nameOf(p.name))}</span></div>` : ''}${verdict(verdicts[i])}`;
    }).join('');
    const review = r.review, worst = plan.filter((k) => review[k] && isPoor(review[k][0])).sort((a, b) => review[b][0] - review[a][0]).slice(0, 5);
    const moments = worst.map((k) => {
      const turn = data.turns[k], p = r.players[turn.seat], loss = review[k][0], grade = gradeOf(loss), round = data.frames[k].round;
      const what = momentText(turn, many ? `<b style="color:${p.color}">${esc(nameOf(p.name))}</b>` : null);
      return `<button type="button" class="rv-moment" data-replay="${k + 1}">
        <span class="grade g-${grade.toLowerCase()}">${gradeLabel(grade)}</span>
        <span class="rv-what">${what}<i>${round ? t('Round {n}', { n: round }) : t('Opening draft')}</i></span>
        <span class="rv-loss">&minus;${oneDecimal(loss)}</span><span class="rv-go" aria-hidden="true">&rsaquo;</span></button>`;
    }).join('');
    return `<div class="rv-verdicts">${people}</div>
      <h4 class="rv-head">${t('Turning points')}</h4>
      ${moments ? `<div class="rv-moments">${moments}</div><p class="h-hint">${t('Open one to see it in the replay, with what the Expert would have done.')}</p>`
        : `<p class="h-hint">${t('No move gave up more than 2.5 points against the Expert’s choice.')}</p>`}`;
  }

  // A grade has landed (or the review stopped or ended): the open game shows it.
  reviewed(r, error = null) {
    if (error) this.say(error);
    if (!r || r.id !== this.gameId || this.el.classList.contains('hidden')) return;
    if (this.replay) { this.replay.refresh(r); return; }
    const sec = this.body.querySelector('#h-review'), running = this.reviews.progress(r.id);
    const bar = sec && sec.querySelector('.rv-bar i');
    if (running && bar) {
      // while it runs, only the bar moves, so the Stop button stays put under the pointer
      bar.style.width = `${(running.done / running.total) * 100}%`;
      sec.querySelector('.rv-text').textContent = grading(running);
      return;
    }
    const top = this.body.scrollTop;
    this.render();
    this.body.scrollTop = top;
  }

  // ---------- export, import, clear ----------
  exportFile() {
    const blob = new Blob([this.log.exportText()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kingdomino-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.say(tn(this.records.length, 'Exported {n} game. Import the file in another browser to carry it over.', 'Exported {n} games. Import the file in another browser to carry them over.'));
  }

  async importFile(file) {
    try {
      if (file.size > 20e6) throw new Error(t('This file is too big to be a Kingdomino history.'));
      const games = parseExport(await file.text());
      const { added, known, ok } = this.log.merge(games);
      if (!ok) throw new Error(t('This browser has no room left to keep these games.'));
      this.say(added ? (known ? tn(added, 'Added {n} game ({known} already here).', 'Added {n} games ({known} already here).', { known }) : tn(added, 'Added {n} game.', 'Added {n} games.'))
        : games.length ? t('Every game in this file is already here.') : t('This file holds no games.'));
      this.gameId = null;
      this.render();
    } catch (e) {
      // (parseExport's messages are in English: they are translated here)
      this.say(t(e.message));
    }
  }

  async clear() {
    const n = this.records.length;
    const sure = await this.hud.ask(t('Clear the history?'), tn(n, 'The {n} game kept in this browser will be deleted, with the stats drawn from it. Export it first to keep a copy.', 'The {n} games kept in this browser will be deleted, with the stats drawn from them. Export them first to keep a copy.'), { yes: t('Clear'), no: n === 1 ? t('Keep it') : t('Keep them') });
    if (!sure) return;
    this.reviews.stop();
    this.log.clear();
    this.gameId = null;
    this.say(t('The history is empty.'));
    this.render();
  }

  // ---------- after a game ----------
  // What the results card says about the game just saved: a personal best, a first win over the Expert.
  note(record) {
    const here = record.players.filter((p) => p.kind === 'here').length;
    return highlights(this.log.all(), record).map((h) => {
      const who = here > 1 || !isYou(h.name) ? esc(nameOf(h.name)) : '';
      const vars = { who, n: h.total, before: h.previous };
      return h.type === 'expert'
        ? `<div>${who ? t('{who}’s first win over the Expert!', vars) : t('Your first win over the Expert!')}</div>`
        : `<div>${who ? t('New personal best for {who}: <b>{n}</b> points <i>(before: {before})</i>', vars) : t('New personal best: <b>{n}</b> points <i>(before: {before})</i>', vars)}</div>`;
    }).join('');
  }
}

const section = (title, html) => `<div class="h-sec"><h3>${title}</h3>${html}</div>`;

const grading = (running) => t('Grading move {n} of {total}…', { n: Math.min(running.done + 1, running.total), total: running.total });

// A turning point of the review: what the move did, by whom when several people were graded.
function momentText(turn, who) {
  const id = turn.id;
  if (turn.kind === 'select') return who ? t('{who} picked domino {id}', { who, id }) : t('picked domino {id}', { id });
  if (turn.value) return who ? t('{who} laid domino {id}', { who, id }) : t('laid domino {id}', { id });
  return who ? t('{who} discarded domino {id}', { who, id }) : t('discarded domino {id}', { id });
}

// Points lost per move and how the grades split, as on the results card.
function verdict({ loss, counts }) {
  const grades = ['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'].filter((g) => counts[g]);
  const cls = (g) => `g-${g.toLowerCase()}`;
  return `<div class="verdict"><div class="v-num"><b>${oneDecimal(loss)}</b><span>${t('points lost<br>per move')}</span></div>
    <div class="v-body"><div class="v-bar">${grades.map((g) => `<i class="${cls(g)}" style="flex:${counts[g]}"></i>`).join('')}</div>
    <div class="v-legend">${grades.map((g) => `<span class="${cls(g)}"><b>${counts[g]}</b> ${gradeLabel(g)}</span>`).join('')}</div></div></div>`;
}
