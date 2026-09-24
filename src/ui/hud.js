// DOM overlay: menu, player cards, prompts, tooltips, results and modals.
import { TERRAIN_INFO } from '../core/rules.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CROWN_SVG = '<svg class="crown-ico" viewBox="0 0 64 48"><path d="M4 40 L4 12 L18 26 L32 4 L46 26 L60 12 L60 40 Z"/></svg>';

const CHARGES = [
  // crown, tower, star, fleur
  '<path d="M18 40 L18 26 L24 32 L32 22 L40 32 L46 26 L46 40 Z" fill="#fff4c8"/>',
  '<path d="M24 44 L24 26 L22 26 L22 20 L26 20 L26 23 L30 23 L30 20 L34 20 L34 23 L38 23 L38 20 L42 20 L42 26 L40 26 L40 44 Z M30 44 L30 36 Q32 33 34 36 L34 44 Z" fill="#fff4c8" fill-rule="evenodd"/>',
  '<path d="M32 18 L35.5 28 L46 28 L37.5 34 L40.5 44 L32 38 L23.5 44 L26.5 34 L18 28 L28.5 28 Z" fill="#fff4c8"/>',
  '<path d="M32 16 C27 22 27 28 32 32 C37 28 37 22 32 16 Z M32 32 C26 30 20 32 21 38 C24 35 28 35 31 36 Z M32 32 C38 30 44 32 43 38 C40 35 36 35 33 36 Z M26 40 L38 40 L38 43 L26 43 Z M31 32 L33 32 L33 48 L31 48 Z" fill="#fff4c8"/>',
];

const AI_TAGS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const tagFor = (p) => (p.type === 'human' ? (p.remote ? 'Online' : 'Human') : AI_TAGS[p.type]);

export function shieldSVG(color, idx = 0) {
  return `<svg class="shield" viewBox="0 0 64 72"><defs><linearGradient id="sg${idx}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#b8841f"/><stop offset="1" stop-color="#f3cf6a"/></linearGradient></defs>
    <path d="M6 6 H58 V34 C58 52 44 62 32 68 C20 62 6 52 6 34 Z" fill="${color}" stroke="url(#sg${idx})" stroke-width="4"/>
    <path d="M10 10 H54 V20 H10 Z" fill="rgba(255,255,255,0.12)"/>${CHARGES[idx % CHARGES.length]}</svg>`;
}

export class Hud {
  constructor() {
    this.el = {
      hud: $('#hud'), banner: $('#banner'), round: $('#round-label'), prompt: $('#prompt'), sub: $('#subprompt'),
      players: $('#players'), actions: $('#actions'), tooltip: $('#tooltip'), toasts: $('#toasts'), views: $('#views'), realms: $('#view-realms'),
      menu: $('#menu'), results: $('#results'), help: $('#help'), settings: $('#settings'), pass: $('#pass'),
      lobby: $('#lobby'), notice: $('#notice'),
      loading: $('#loading'), loadingFill: $('#loading-fill'), loadingText: $('#loading-text'), showResults: $('#show-results'),
    };
    this.handlers = {};
    this.cards = new Map();
    document.querySelectorAll('[data-action]').forEach((b) => {
      b.addEventListener('click', (e) => { e.stopPropagation(); this.emit(b.dataset.action); });
    });
    document.querySelectorAll('.modal').forEach((m) => {
      m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-close')) m.classList.add('hidden'); });
    });
    $('#menu-help').addEventListener('click', () => this.el.help.classList.remove('hidden'));
    document.querySelectorAll('.seg[data-setting]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        this.setSeg(seg.dataset.setting, b.dataset.v);
        this.emit('setting', { key: seg.dataset.setting, value: b.dataset.v });
      }));
    });
  }

  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, arg) { (this.handlers[name] || []).forEach((f) => f(arg)); }

  setSeg(key, value) {
    const seg = document.querySelector(`.seg[data-setting="${key}"]`);
    if (!seg) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(value)));
  }

  loading(p, text) {
    this.el.loadingFill.style.width = `${Math.round(p * 100)}%`;
    if (text) this.el.loadingText.textContent = text;
  }

  hideLoading() {
    this.el.loading.classList.add('fade');
    setTimeout(() => this.el.loading.classList.add('hidden'), 1000);
  }

  // ---------- menu ----------
  showMenu(seats, onStart) {
    const rows = $('#seat-rows');
    rows.innerHTML = '';
    const kinds = [['human', 'Human'], ['remote', 'Online friend'], ['easy', 'AI · Easy'], ['normal', 'AI · Normal'], ['hard', 'AI · Hard'], ['off', 'Empty seat']];
    seats.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'seat-row';
      row.innerHTML = `${shieldSVG(s.color, i)}<input type="text" maxlength="18" value="${esc(s.name)}" spellcheck="false" />
        <select class="seat-select">${kinds.map(([v, l]) => `<option value="${v}" ${v === s.type ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
      const input = row.querySelector('input'), sel = row.querySelector('select');
      input.addEventListener('input', () => { s.name = input.value; });
      sel.addEventListener('change', () => { s.type = sel.value; refresh(); });
      rows.appendChild(row);
      s._row = row;
    });
    const duelWrap = $('#opt-duel-wrap');
    const refresh = () => {
      const active = seats.filter((s) => s.type !== 'off').length;
      const online = seats.some((s) => s.type === 'remote');
      seats.forEach((s) => {
        s._row.classList.toggle('off', s.type === 'off');
        // a friend brings their own name when they join
        s._row.querySelector('input').disabled = s.type === 'remote';
      });
      duelWrap.classList.toggle('disabled', active !== 2);
      $('#start-btn').disabled = active < 2;
      $('#start-btn').style.opacity = active < 2 ? 0.5 : 1;
      $('#start-btn span').textContent = online ? 'Invite your friends' : 'Start game';
    };
    refresh();
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    const btn = $('#start-btn');
    const handler = () => {
      const active = seats.filter((s) => s.type !== 'off');
      if (active.length < 2) { this.toast('You need at least two players.'); return; }
      btn.removeEventListener('click', handler);
      onStart({
        seats: active.map((s) => ({ name: (s.name || 'Player').trim() || 'Player', type: s.type, color: s.color, crest: seats.indexOf(s) })),
        middleKingdom: $('#opt-middle').checked,
        harmony: $('#opt-harmony').checked,
        mightyDuel: active.length === 2 && $('#opt-duel').checked,
      });
    };
    btn.addEventListener('click', handler);
  }

  hideMenu() { this.el.menu.classList.add('hidden'); }

  // ---------- in game ----------
  showHud() { this.el.hud.classList.remove('hidden'); }
  hideHud() { this.el.hud.classList.add('hidden'); }

  // humans: the players at this screen (with just one, their kingdom reads "your kingdom").
  setPlayers(players, humans = []) {
    this.el.players.innerHTML = '';
    this.el.realms.innerHTML = '';
    this.cards.clear();
    players.forEach((p, i) => {
      const whose = humans.length === 1 && humans[0] === p ? 'your kingdom' : `${p.name}’s kingdom`;
      const tip = `${whose[0].toUpperCase()}${whose.slice(1)} · ${i + 1}`;
      const c = document.createElement('div');
      c.className = 'player-card';
      c.style.setProperty('--pc', p.color);
      c.title = `Look at ${whose} (${i + 1})`;
      c.innerHTML = `${shieldSVG(p.color, p.crest)}<div class="pinfo"><div class="pname">${esc(p.name)}</div>
        <div class="pmeta"><span class="tag">${tagFor(p)}</span><span class="crowns">${CROWN_SVG} <b>0</b></span></div></div><div class="pscore">0</div>`;
      c.addEventListener('click', () => this.emit('view', i));
      this.el.players.appendChild(c);
      this.cards.set(p, c);
      const b = document.createElement('button');
      b.className = 'icon-btn realm-btn';
      b.dataset.view = String(i);
      b.dataset.tip = tip;
      b.setAttribute('aria-label', tip);
      b.innerHTML = shieldSVG(p.color, p.crest);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.emit('view', i); });
      this.el.realms.appendChild(b);
    });
  }

  // state: { follow: auto camera is on, held: the player has taken the camera, view: dock view shown }
  setCamera({ follow, held, view }) {
    const d = this.el.views;
    d.querySelector('[data-action="follow"]').classList.toggle('on', follow);
    d.querySelector('[data-action="follow"]').classList.toggle('nudge', held);
    d.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', view != null && b.dataset.view === String(view)));
  }

  updatePlayer(p, score, crowns) {
    const c = this.cards.get(p);
    if (!c) return;
    const s = c.querySelector('.pscore');
    if (s.textContent !== String(score)) {
      s.textContent = score;
      s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump');
    }
    c.querySelector('.crowns b').textContent = crowns;
  }

  // After a friend leaves and the AI takes over their kingdom.
  updateTag(p) {
    const c = this.cards.get(p);
    if (c) c.querySelector('.tag').textContent = tagFor(p);
  }

  setActive(p) {
    for (const [pp, c] of this.cards) c.classList.toggle('active', pp === p);
  }

  setRound(text) { this.el.round.textContent = text; }

  prompt(html, sub = '') {
    if (this.el.prompt.innerHTML !== html) {
      this.el.banner.classList.remove('flash'); void this.el.banner.offsetWidth; this.el.banner.classList.add('flash');
    }
    this.el.prompt.innerHTML = html;
    this.el.sub.innerHTML = sub;
  }

  who(p) { return `<span class="who" style="color:${p.color}">${esc(p.name)}</span>`; }

  // The menu's default name "You" needs its own grammar: "you win", "your kingdom".
  isYou(p) { return p.name.trim().toLowerCase() === 'you'; }
  whose(p) { return this.isYou(p) ? `<span class="who" style="color:${p.color}">your</span>` : `${this.who(p)}’s`; }
  wins(p) { return `${this.who(p)} ${this.isYou(p) ? 'win' : 'wins'}`; }

  setActions(state) {
    if (!state) { this.el.actions.classList.add('hidden'); return; }
    this.el.actions.classList.remove('hidden');
    const q = (a) => this.el.actions.querySelector(`[data-action="${a}"]`);
    q('rotate').classList.toggle('hidden', !state.rotate);
    q('hint').classList.toggle('hidden', !state.hint);
    q('hint').classList.toggle('on', !!state.hintOn);
    q('discard').classList.toggle('hidden', !state.discard);
  }

  setToggle(action, on) {
    const b = document.querySelector(`#toolbar [data-action="${action}"]`);
    if (b) b.classList.toggle('off', !on);
  }

  tooltip(html, x, y) {
    const t = this.el.tooltip;
    if (!html) { t.classList.add('hidden'); return; }
    t.innerHTML = html;
    t.classList.remove('hidden');
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = `${Math.min(x, window.innerWidth - w - 24)}px`;
    t.style.top = `${Math.min(y, window.innerHeight - h - 24)}px`;
  }

  dominoTooltip(domino, extra = '') {
    const rows = domino.squares.map((s) => {
      const info = TERRAIN_INFO[s.terrain];
      const crowns = s.crowns ? ` · ${CROWN_SVG.repeat(s.crowns)}` : '';
      return `<div class="tt-row"><span class="chip" style="background:${info.color}"></span>${info.name}${crowns}</div>`;
    }).join('');
    return `<div class="tt-title">Domino ${domino.id}</div>${rows}${extra}`;
  }

  toast(text, life = 2.6) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.setProperty('--life', `${life}s`);
    t.innerHTML = text;
    this.el.toasts.appendChild(t);
    setTimeout(() => t.remove(), (life + 0.6) * 1000);
  }

  passDevice(p) {
    return new Promise((resolve) => {
      $('#pass-shield').innerHTML = shieldSVG(p.color, p.crest);
      $('#pass-title').innerHTML = `${esc(p.name)}, your turn`;
      $('#pass-title').style.color = p.color;
      $('#pass-sub').textContent = this.isYou(p) ? 'Hand the device over.' : `Hand the device to ${p.name}.`;
      this.el.pass.classList.remove('hidden');
      const b = $('#pass-go');
      const h = () => { b.removeEventListener('click', h); this.el.pass.classList.add('hidden'); resolve(); };
      b.addEventListener('click', h);
    });
  }

  // While the winner is celebrated, a floating button opens the results early; resolves when pressed.
  offerResults() {
    const b = this.el.showResults;
    b.querySelector('span').textContent = 'Show final scores';
    b.classList.remove('hidden');
    return new Promise((resolve) => { b.onclick = () => { b.onclick = null; b.classList.add('hidden'); resolve(); }; });
  }

  showResults(rows, opts, { onAgain, onMenu, hostDeals = false }) {
    this.el.showResults.classList.add('hidden');
    this.el.showResults.onclick = null;
    const table = $('#results-table');
    const winners = rows.filter((r) => r.place === 1);
    const names = winners.map((w) => this.who(w.player));
    const top = winners[0].s.total;
    $('#winner-line').innerHTML = winners.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} tie for first place.`
      : `${this.wins(winners[0].player)} with ${top} point${top === 1 ? '' : 's'}.`;
    table.innerHTML = rows.map((r, i) => {
      const props = r.s.regions.filter((g) => g.crowns > 0).sort((a, b) => b.score - a.score).map((g) => {
        const info = TERRAIN_INFO[g.terrain];
        return `<span class="prop"><span class="chip" style="background:${info.color}"></span>${g.size}&times;${g.crowns} = <b>${g.score}</b></span>`;
      }).join('');
      const bonus = (r.s.middle ? `<span class="prop bonus">Middle Kingdom +10</span>` : '') + (r.s.harmony ? `<span class="prop bonus">Harmony +5</span>` : '');
      const none = !props && !bonus ? '<span class="prop">No crowned property</span>' : '';
      return `<div class="res-row ${r.place === 1 ? 'first' : ''}" style="animation-delay:${0.15 + i * 0.12}s">
        <div class="res-rank">${['I', 'II', 'III', 'IV'][r.place - 1]}</div>${shieldSVG(r.player.color, r.player.crest)}
        <div><div class="res-name" style="color:${r.player.color}">${esc(r.player.name)}</div><div class="res-props">${props}${bonus}${none}</div></div>
        <div class="res-total">${r.s.total}</div></div>`;
    }).join('');
    this.el.results.classList.remove('hidden');
    const again = $('#res-again'), menu = $('#res-menu'), admire = $('#res-admire');
    // an online guest waits for the host to deal the next game
    again.disabled = hostDeals;
    again.classList.toggle('waiting', hostDeals);
    again.querySelector('span').textContent = hostDeals ? 'Waiting for the host to start again' : 'Play again';
    menu.textContent = hostDeals ? 'Leave game' : 'Main menu';
    const cleanup = () => { again.onclick = menu.onclick = admire.onclick = this.el.showResults.onclick = null; };
    again.onclick = () => { cleanup(); this.el.results.classList.add('hidden'); onAgain(); };
    menu.onclick = () => { cleanup(); this.el.results.classList.add('hidden'); onMenu(); };
    admire.onclick = () => {
      this.el.results.classList.add('hidden');
      this.el.showResults.querySelector('span').textContent = 'Show final scores';
      this.el.showResults.classList.remove('hidden');
      this.el.showResults.onclick = () => { this.el.showResults.classList.add('hidden'); this.el.results.classList.remove('hidden'); };
    };
  }

  hideResults() {
    this.el.results.classList.add('hidden');
    this.el.showResults.classList.add('hidden');
  }

  // ---------- online lobby ----------
  showLobby({ onBack, onBegin, onJoin }) {
    const name = $('#lobby-name');
    const join = () => onJoin && onJoin(name.value);
    $('#lobby-back').onclick = () => onBack();
    $('#lobby-begin').onclick = () => onBegin && onBegin();
    $('#lobby-join-btn').onclick = join;
    name.onkeydown = (e) => { if (e.key === 'Enter') join(); };
    const link = $('#lobby-link'), copy = $('#lobby-copy'), share = $('#lobby-share');
    link.onclick = () => link.select();
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(link.value); } catch { link.select(); document.execCommand('copy'); }
      copy.textContent = 'Copied!';
      clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
    };
    share.classList.toggle('hidden', !navigator.share);
    share.onclick = () => navigator.share({ title: 'Kingdomino', text: 'Join my game of Kingdomino!', url: link.value }).catch(() => {});
    this.el.lobby.classList.remove('hidden');
  }

  // state: { title, sub, link, note, join: { name } | null, seats, you, host, begin: { enabled, label } | null, back }
  setLobby(state) {
    const has = (k) => Object.prototype.hasOwnProperty.call(state, k);
    if (has('title')) $('#lobby-title').textContent = state.title;
    if (has('sub')) $('#lobby-sub').textContent = state.sub;
    if (has('link')) {
      $('#lobby-invite').classList.toggle('hidden', !state.link);
      $('#lobby-link').value = state.link || '';
    }
    if (has('note')) $('#lobby-note').innerHTML = state.note || '';
    if (has('join')) {
      $('#lobby-join').classList.toggle('hidden', !state.join);
      if (state.join) { $('#lobby-name').value = state.join.name; $('#lobby-join-btn').disabled = false; }
    }
    if (has('joining')) $('#lobby-join-btn').disabled = state.joining;
    if (has('seats')) {
      $('#lobby-seats-wrap').classList.toggle('hidden', !state.seats);
      $('#lobby-seats').innerHTML = (state.seats || []).map((s, i) => {
        const me = state.host ? s.kind === 'human' : i === state.you;
        const [label, cls] = me ? ['You', 'me']
          : s.kind === 'open' ? ['Waiting for a friend…', 'open']
            : s.kind === 'guest' ? ['Joined', 'joined']
              : s.kind === 'human' ? ['Host', 'joined'] : [`AI · ${AI_TAGS[s.kind]}`, 'ai'];
        const name = s.kind === 'open' ? 'Open seat' : esc(s.name);
        return `<div class="lobby-seat ${cls}">${shieldSVG(s.color, s.crest)}<span class="lname">${name}</span><span class="lstate">${label}</span></div>`;
      }).join('');
    }
    if (has('begin')) {
      const b = $('#lobby-begin');
      b.classList.toggle('hidden', !state.begin);
      if (state.begin) {
        b.disabled = !state.begin.enabled;
        b.style.opacity = state.begin.enabled ? 1 : 0.5;
        b.querySelector('span').textContent = state.begin.label;
      }
    }
    if (has('back')) $('#lobby-back').textContent = state.back;
  }

  hideLobby() { this.el.lobby.classList.add('hidden'); }

  // A yes/no question in the game's own style. (Native confirm() freezes the table, and some
  // browsers and embeds block it outright, which silently answers "no".) Resolves true for yes.
  ask(title, text, { yes = 'Yes', no = 'Cancel' } = {}) {
    if (this.askDone) this.askDone(false);
    return new Promise((resolve) => {
      const el = $('#ask'), yesB = $('#ask-yes'), noB = $('#ask-no');
      $('#ask-title').textContent = title;
      $('#ask-text').innerHTML = text;
      yesB.querySelector('span').textContent = yes;
      noB.textContent = no;
      // while the question is open, keys belong to it and never reach the game (Escape = no)
      const key = (e) => { e.stopPropagation(); if (e.key === 'Escape') done(false); };
      const done = (v) => {
        this.askDone = null;
        el.classList.add('hidden');
        window.removeEventListener('keydown', key, true);
        el.onclick = yesB.onclick = noB.onclick = null;
        resolve(v);
      };
      this.askDone = done;
      window.addEventListener('keydown', key, true);
      yesB.onclick = () => done(true);
      noB.onclick = () => done(false);
      el.onclick = (e) => { if (e.target === el) done(false); };
      el.classList.remove('hidden');
      noB.focus();
    });
  }

  // A blocking message with a single way out (e.g. the host has left the table).
  notice(title, text, button = 'Main menu') {
    if (this.askDone) this.askDone(false);
    return new Promise((resolve) => {
      $('#notice-title').textContent = title;
      $('#notice-text').innerHTML = text;
      const b = $('#notice-go');
      b.querySelector('span').textContent = button;
      this.el.notice.classList.remove('hidden');
      b.onclick = () => { b.onclick = null; this.el.notice.classList.add('hidden'); resolve(); };
    });
  }

  hideNotice() { this.el.notice.classList.add('hidden'); }
}
