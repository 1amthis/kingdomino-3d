// The history window: every game finished in this browser, and each person's stats drawn from them; a
// game can be played back move by move, and reviewed by the coach. Everything lives in this browser's
// storage; export and import carry it to another one.
import { TERRAIN_INFO } from '../core/rules.js';
import { decodeMap, profiles, statsFor, parseExport, highlights } from '../core/history.js';
import { replayable, replayRecord } from '../core/replay.js';
import { reviewedSeats, reviewPlan, reviewVerdicts, gradeOf, isPoor } from '../core/review.js';
import { ReplayView } from './replay.js';
import { ReviewRunner } from './review.js';
import { esc, shieldSVG, pips, CROWN_SVG } from './hud.js';

const $ = (s) => document.querySelector(s);
const LEVELS = { easy: ['Easy', 1], normal: ['Normal', 2], hard: ['Hard', 3], expert: ['Expert', 4] };
const KIND_TAG = { here: 'Human', friend: 'Online', easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };
const PAGE = 40;

const ordinal = (n) => `${n}${['st', 'nd', 'rd'][n - 1] || 'th'}`; // places run 1 to 4
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const oneDecimal = (x) => (Math.round(x * 10) / 10).toFixed(1);
const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// "Today, 14:32", "Yesterday, 09:10", "3 Oct, 14:32", "3 Oct 2025"; long: "Friday 3 October, 14:32"
function when(t, { long = false, time: withTime = true } = {}) {
  const d = new Date(t), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((day(now) - day(d)) / 864e5);
  const at = withTime ? `, ${time}` : '';
  if (days === 0) return `Today${at}`;
  if (days === 1) return `Yesterday${at}`;
  const opts = long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) return d.toLocaleDateString('en-GB', { ...opts, year: 'numeric' });
  return `${d.toLocaleDateString('en-GB', opts)}${at}`;
}

// How the table was laid: online, several people at one screen, one person against the computer...
function modeOf(r) {
  const here = r.players.filter((p) => p.kind === 'here').length;
  const mode = r.online ? 'Online' : here > 1 ? 'Same screen' : here ? 'Against the computer' : 'Computer only';
  return [mode, r.rules.mightyDuel ? 'Mighty Duel' : `${r.players.length} players`];
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
      <p><b>No games yet.</b></p><p>Every game you finish is kept here: the scores, each kingdom, and your stats against the computer and your friends.</p></div>`;
  }

  onClick(e) {
    const t = e.target.closest('[data-game], [data-profile], [data-more], [data-back], [data-back-game], [data-replay], [data-review], [data-review-stop]');
    if (!t) return;
    const d = t.dataset;
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
    if (!people.length) return '<div class="h-empty"><p>Stats follow the people who play at this screen. So far, only the computer has played.</p></div>';
    if (!people.some((p) => p.name === this.profile)) this.profile = people[0].name;
    const s = statsFor(records, this.profile);
    const you = s.name === 'You';
    const picker = people.length > 1
      ? `<div class="h-who"><span>Stats for</span><div class="seg">${people.map((p) => `<button data-profile="${esc(p.name)}" class="${p.name === s.name ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div></div>`
      : '';
    const tiles = [
      [s.games, s.games === 1 ? 'Game' : 'Games', s.games > 1 ? `since ${when(s.first, { time: false })}` : ''],
      [s.wins, s.wins === 1 ? 'Win' : 'Wins', `${pct(s.winRate)} of games`],
      [Math.round(s.average), 'Average score', `${oneDecimal(s.averageCrowns)} crowns a game`],
      [s.best.total, 'Best score', when(s.best.end, { time: false })],
    ].map(([v, label, sub]) => `<div class="h-tile"><b>${v}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`).join('');

    const record = (e) => `<b>${e.won}</b> won · ${e.lost} lost${e.tied ? ` · ${e.tied} tied` : ''}`;
    const h2h = (rows) => `<div class="h2h">${rows.map((e) => `<div class="h2h-row"><span class="h2h-who">${e.who}</span>
      <span class="h2h-bar" title="${pct(e.won / e.games)} won"><i style="width:${(e.won / e.games) * 100}%"></i></span>
      <span class="h2h-rec">${record(e)}</span><span class="h2h-pct">${pct(e.won / e.games)}</span></div>`).join('')}</div>`;
    const levels = s.levels.length ? section('Against the computer', h2h(s.levels.map((e) => ({ ...e, who: `${LEVELS[e.level][0]} ${pips(LEVELS[e.level][1])}` })))
      + '<p class="h-hint">Each opponent at the table counts once: won when you finish ahead of them.</p>') : '';
    const people2 = s.people.length ? section('Against people', h2h(s.people.map((e) => ({ ...e, who: `<span class="h2h-name">${esc(e.name)}</span>` })))) : '';

    const facts = [];
    if (s.richest) {
      const info = TERRAIN_INFO[s.richest.terrain];
      facts.push(['Richest property', `<span class="chip" style="background:${info.color}"></span> ${info.name}, ${s.richest.size} &times; ${s.richest.crowns} = <b>${s.richest.score}</b>`]);
    }
    if (s.mostCrowns) facts.push(['Most crowns in a game', `${CROWN_SVG} <b>${s.mostCrowns.crowns}</b>`]);
    facts.push(['Longest winning run', `<b>${s.streak.best}</b>${s.streak.current > 1 ? ` · ${s.streak.current} in a row now` : ''}`]);
    if (s.middle.of) facts.push(['Middle Kingdom', `<b>${s.middle.got}</b> of ${plural(s.middle.of, 'game')}`]);
    if (s.harmony.of) facts.push(['Harmony', `<b>${s.harmony.got}</b> of ${plural(s.harmony.of, 'game')}`]);
    const records2 = section('Records', `<div class="h-facts">${facts.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('')}</div>`);

    return `${picker}<div class="h-tiles">${tiles}</div>
      ${s.recent.length >= 3 ? section(`${you ? 'Your' : `${esc(s.name)}’s`} last ${s.recent.length} games`, this.chart(s)) : ''}
      ${levels}${people2}${records2}${this.coachView(s)}`;
  }

  // One column per game, oldest on the left; a crown over each win, a line at the average.
  chart(s) {
    const games = s.recent, max = Math.max(...games.map((g) => g.total), 1);
    const step = max > 80 ? 40 : max > 40 ? 20 : 10, top = Math.ceil(max / step) * step;
    const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
    const avg = games.reduce((a, g) => a + g.total, 0) / games.length;
    const cols = games.map((g) => {
      const tip = `${g.total} points|${when(g.end)} · ${g.place === 1 ? 'won' : `${ordinal(g.place)} of ${g.players}`}`;
      return `<span class="hc-col${g.place === 1 ? ' won' : ''}" tabindex="0" data-tip="${esc(tip)}" data-game="${g.id}">
        <i style="height:${(g.total / top) * 100}%">${g.place === 1 ? CROWN_SVG : ''}</i></span>`;
    }).join('');
    return `<div class="hchart" role="group" aria-label="Scores of the last ${games.length} games, oldest first, average ${Math.round(avg)}">
      <div class="hc-plot">
        ${ticks.map((t) => `<div class="hc-tick" style="bottom:${(t / top) * 100}%"><span>${t}</span></div>`).join('')}
        <div class="hc-avg" style="bottom:${(avg / top) * 100}%"><span>average ${Math.round(avg)}</span></div>
        <div class="hc-cols">${cols}</div>
        <div class="hc-tip hidden"><b></b><span></span></div>
      </div></div>
      <p class="h-hint">A crown marks each win and the line the average, <b>${Math.round(avg)}</b>. Open a game from its column.</p>`;
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
      const word = Math.abs(d) < 0.2 ? 'steady' : d > 0 ? 'improving' : 'slipping';
      trend = `<p class="h-hint">Last 5 games: <b>${oneDecimal(c.recent.loss)}</b> lost per move, against ${oneDecimal(c.earlier.loss)} before (${word}).</p>`;
    }
    return section('The coach', `${verdict(c)}<p class="h-hint">Over ${plural(c.games, 'graded game')} (${plural(c.decisions, 'move')}).</p>${trend}`);
  }

  // ---------- games ----------
  listView(records) {
    const games = records.slice().reverse();
    const rows = games.slice(0, this.shown).map((r) => {
      const me = focusOf(r), here = me.kind === 'here';
      const [mode, table] = modeOf(r);
      const result = !here ? '' : me.place === 1
        ? `<span class="hg-result won">${r.players.filter((p) => p.place === 1).length > 1 ? 'Shared win' : 'Won'}</span>`
        : `<span class="hg-result">${ordinal(me.place)}</span>`;
      const players = r.players.slice().sort((a, b) => a.place - b.place).map((p) => `<span class="hg-p${p === me && here ? ' me' : ''}">
        ${shieldSVG(p.color, p.crest)}<span class="hg-name">${esc(p.name)}</span><b>${p.total}</b></span>`).join('');
      return `<button type="button" class="hg-row" data-game="${r.id}">
        <span class="hg-map">${kingdomSVG(me.map, { cell: 7, size: r.rules.mightyDuel ? 7 : 5, crowns: false })}</span>
        <span class="hg-main"><span class="hg-when">${when(r.end)}<i>${mode} · ${table}</i></span><span class="hg-players">${players}</span></span>
        ${result}</button>`;
    }).join('');
    const more = games.length > this.shown ? `<button type="button" class="ghost-btn h-more" data-more>Show ${Math.min(PAGE, games.length - this.shown)} more</button>` : '';
    return `<p class="h-count">${plural(games.length, 'game')} kept in this browser</p><div class="hg-list">${rows}</div>${more}`;
  }

  gameView(r) {
    const [mode, table] = modeOf(r);
    const minutes = r.start ? Math.max(1, Math.round((r.end - r.start) / 60000)) : 0;
    const rules = [r.rules.middleKingdom && 'Middle Kingdom', r.rules.harmony && 'Harmony', r.coach && `Coach: ${r.coach === 'study' ? 'Study' : 'Trainer'}`].filter(Boolean);
    const size = r.rules.mightyDuel ? 7 : 5;
    const rows = r.players.slice().sort((a, b) => a.place - b.place).map((p) => {
      const props = p.props.map(([terrain, n, crowns]) => `<span class="prop"><span class="chip" style="background:${TERRAIN_INFO[terrain].color}"></span>${n}&times;${crowns} = <b>${n * crowns}</b></span>`).join('');
      const bonus = (p.middle ? '<span class="prop bonus">Middle Kingdom +10</span>' : '') + (p.harmony ? '<span class="prop bonus">Harmony +5</span>' : '');
      const tag = p.left ? 'Left · AI finished' : KIND_TAG[p.kind];
      return `<div class="res-row hd-row ${p.place === 1 ? 'first' : ''}">
        <div class="res-rank">${['I', 'II', 'III', 'IV'][p.place - 1]}</div>${shieldSVG(p.color, p.crest)}
        <div><div class="res-name" style="color:${p.color}">${esc(p.name)} <span class="tag">${tag}</span></div>
          <div class="res-props">${props}${bonus}${!props && !bonus ? '<span class="prop">No crowned property</span>' : ''}</div></div>
        <div class="hd-map">${kingdomSVG(p.map, { cell: size === 7 ? 9 : 12, size })}</div>
        <div class="res-total">${p.total}</div></div>`;
    }).join('');
    const data = this.replayOf(r);
    const review = data ? this.reviewSection(r, data) : '';
    // once the review is complete, its verdicts stand in for the one given during the game
    const coach = r.verdict && !review.includes('data-reviewed') ? section('The coach’s verdict', verdict(r.verdict)) : '';
    const replay = data ? '<button type="button" class="royal-btn hd-replay" data-replay><span>&#9654; Replay</span></button>' : '';
    return `<div class="hd-head"><button type="button" class="ghost-btn small" data-back>&lsaquo; All games</button>
        <div class="hd-titles"><div class="hd-title">${when(r.end, { long: true })}</div><div class="hd-meta">${[mode, table, minutes && `${minutes} min`, ...rules].filter(Boolean).join(' · ')}</div></div>${replay}</div>
      <div class="hd-rows">${rows}</div>${coach}${review}`;
  }

  replayHead(r) {
    const [mode, table] = modeOf(r);
    return `<div class="hd-head"><button type="button" class="ghost-btn small" data-back-game>&lsaquo; Final scores</button>
      <div class="hd-titles"><div class="hd-title">Replay</div><div class="hd-meta">${[when(r.end), mode, table].join(' · ')}</div></div></div>`;
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
        <span class="rv-text">Grading move ${Math.min(running.done + 1, running.total)} of ${running.total}…</span>
        <button type="button" class="ghost-btn small" data-review-stop>Stop</button></div>
        <p class="h-hint">One move at a time, while this window stays open.</p>`;
    } else if (done < plan.length) {
      const people = seats.map((i) => r.players[i].name);
      const whose = people.length === 1 && /^you$/i.test(people[0].trim()) ? 'every move you made' : `every move by ${listOf(people.map(esc))}`;
      const minutes = Math.max(1, Math.ceil(((plan.length - done) * 2.5) / 60));
      body = `<p class="h-hint">Now that the game is over, the coach can grade ${whose}, as it does during a game, and show where the
        game turned. It looks at one move at a time while this window stays open: up to ${plural(minutes, 'minute')}.${r.verdict ? ' Its numbers can differ a little from the ones given during the game.' : ''}</p>
        <button type="button" class="ghost-btn small rv-start" data-review>${done ? `Carry on (${done} of ${plan.length} moves graded)` : 'Review this game'}</button>`;
    } else body = this.reviewResult(r, data, plan, seats);
    return `<div class="h-sec" id="h-review"${running || done < plan.length ? '' : ' data-reviewed'}><h3>The coach’s review</h3>${body}</div>`;
  }

  reviewResult(r, data, plan, seats) {
    const verdicts = reviewVerdicts(r, plan, data.turns);
    const many = seats.length > 1;
    const people = seats.filter((i) => verdicts[i]).map((i) => {
      const p = r.players[i];
      return `${many ? `<div class="rv-who">${shieldSVG(p.color, p.crest)}<span style="color:${p.color}">${esc(p.name)}</span></div>` : ''}${verdict(verdicts[i])}`;
    }).join('');
    const review = r.review, worst = plan.filter((k) => review[k] && isPoor(review[k][0])).sort((a, b) => review[b][0] - review[a][0]).slice(0, 5);
    const moments = worst.map((k) => {
      const t = data.turns[k], p = r.players[t.seat], loss = review[k][0], grade = gradeOf(loss), round = data.frames[k].round;
      const what = t.kind === 'select' ? `picked domino ${t.id}` : t.value ? `laid domino ${t.id}` : `discarded domino ${t.id}`;
      return `<button type="button" class="rv-moment" data-replay="${k + 1}">
        <span class="grade g-${grade.toLowerCase()}">${grade}</span>
        <span class="rv-what">${many ? `<b style="color:${p.color}">${esc(p.name)}</b> ` : ''}${what}<i>${round ? `Round ${round}` : 'Opening draft'}</i></span>
        <span class="rv-loss">&minus;${oneDecimal(loss)}</span><span class="rv-go" aria-hidden="true">&rsaquo;</span></button>`;
    }).join('');
    return `<div class="rv-verdicts">${people}</div>
      <h4 class="rv-head">Turning points</h4>
      ${moments ? `<div class="rv-moments">${moments}</div><p class="h-hint">Open one to see it in the replay, with what the Expert would have done.</p>`
        : '<p class="h-hint">No move gave up more than 2.5 points against the Expert’s choice.</p>'}`;
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
      sec.querySelector('.rv-text').textContent = `Grading move ${Math.min(running.done + 1, running.total)} of ${running.total}…`;
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
    this.say(`Exported ${plural(this.records.length, 'game')}. Import the file in another browser to carry them over.`);
  }

  async importFile(file) {
    try {
      if (file.size > 20e6) throw new Error('This file is too big to be a Kingdomino history.');
      const games = parseExport(await file.text());
      const { added, known, ok } = this.log.merge(games);
      if (!ok) throw new Error('This browser has no room left to keep these games.');
      this.say(added ? `Added ${plural(added, 'game')}${known ? ` (${known} already here)` : ''}.` : games.length ? 'Every game in this file is already here.' : 'This file holds no games.');
      this.gameId = null;
      this.render();
    } catch (e) {
      this.say(e.message);
    }
  }

  async clear() {
    const n = this.records.length;
    const sure = await this.hud.ask('Clear the history?', `The ${plural(n, 'game')} kept in this browser will be deleted, with the stats drawn from them. Export them first to keep a copy.`, { yes: 'Clear', no: 'Keep them' });
    if (!sure) return;
    this.reviews.stop();
    this.log.clear();
    this.gameId = null;
    this.say('The history is empty.');
    this.render();
  }

  // ---------- after a game ----------
  // What the results card says about the game just saved: a personal best, a first win over the Expert.
  note(record) {
    const here = record.players.filter((p) => p.kind === 'here').length;
    return highlights(this.log.all(), record).map((h) => {
      const who = here > 1 || h.name !== 'You' ? h.name : '';
      return h.type === 'expert'
        ? `<div>${who ? `${esc(who)}’s first` : 'Your first'} win over the Expert!</div>`
        : `<div>New personal best${who ? ` for ${esc(who)}` : ''}: <b>${h.total}</b> points <i>(before: ${h.previous})</i></div>`;
    }).join('');
  }
}

const section = (title, html) => `<div class="h-sec"><h3>${title}</h3>${html}</div>`;

// Points lost per move and how the grades split, as on the results card.
function verdict({ loss, counts }) {
  const grades = ['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'].filter((g) => counts[g]);
  const cls = (g) => `g-${g.toLowerCase()}`;
  return `<div class="verdict"><div class="v-num"><b>${oneDecimal(loss)}</b><span>points lost<br>per move</span></div>
    <div class="v-body"><div class="v-bar">${grades.map((g) => `<i class="${cls(g)}" style="flex:${counts[g]}"></i>`).join('')}</div>
    <div class="v-legend">${grades.map((g) => `<span class="${cls(g)}"><b>${counts[g]}</b> ${g}</span>`).join('')}</div></div></div>`;
}
