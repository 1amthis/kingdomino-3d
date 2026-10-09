// DOM overlay: menu, player cards, prompts, tooltips, results and modals.
import { TERRAIN_INFO } from '../core/rules.js';
import { Guide } from './guide.js';

const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CROWN_SVG = '<svg class="crown-ico" viewBox="0 0 64 48"><path d="M4 40 L4 12 L18 26 L32 4 L46 26 L60 12 L60 40 Z"/></svg>';

const CHARGES = [
  // crown, tower, star, fleur
  '<path d="M18 40 L18 26 L24 32 L32 22 L40 32 L46 26 L46 40 Z" fill="#fff4c8"/>',
  '<path d="M24 44 L24 26 L22 26 L22 20 L26 20 L26 23 L30 23 L30 20 L34 20 L34 23 L38 23 L38 20 L42 20 L42 26 L40 26 L40 44 Z M30 44 L30 36 Q32 33 34 36 L34 44 Z" fill="#fff4c8" fill-rule="evenodd"/>',
  '<path d="M32 18 L35.5 28 L46 28 L37.5 34 L40.5 44 L32 38 L23.5 44 L26.5 34 L18 28 L28.5 28 Z" fill="#fff4c8"/>',
  '<path d="M32 16 C27 22 27 28 32 32 C37 28 37 22 32 16 Z M32 32 C26 30 20 32 21 38 C24 35 28 35 31 36 Z M32 32 C38 30 44 32 43 38 C40 35 36 35 33 36 Z M26 40 L38 40 L38 43 L26 43 Z M31 32 L33 32 L33 48 L31 48 Z" fill="#fff4c8"/>',
];

const AI_TAGS = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };
const tagFor = (p) => (p.type === 'human' ? (p.remote ? 'Online' : 'Human') : AI_TAGS[p.type]);

// Who sits in a seat, for the menu's seat picker: the computer's levels carry strength pips.
const ICONS = {
  human: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c.8-4 3.6-6 7.2-6s6.4 2 7.2 6"/></svg>',
  remote: '<svg viewBox="0 0 24 24"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
  ai: '<svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 7V4M9 12h.01M15 12h.01M9.5 15h5"/></svg>',
  off: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><path d="M6.8 17.2 17.2 6.8"/></svg>',
};
const SEAT_KINDS = [
  { v: 'human', name: 'Human', icon: 'human' }, { v: 'remote', name: 'Online friend', icon: 'remote' },
  { v: 'easy', name: 'Easy', ai: 1 }, { v: 'normal', name: 'Normal', ai: 2 }, { v: 'hard', name: 'Hard', ai: 3 }, { v: 'expert', name: 'Expert', ai: 4 },
  { v: 'off', name: 'Empty seat', icon: 'off' },
];
export const pips = (n) => `<span class="pips">${[1, 2, 3, 4].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
const seatFace = (k) => `<span class="sp-ico">${ICONS[k.icon || 'ai']}</span><span class="sp-name">${k.name}</span>${k.ai ? pips(k.ai) : ''}`;

// The coach's line under its switch, for each setting and when fair play turns it off.
const COACH_NOTES = {
  off: 'The Expert can grade your moves',
  trainer: 'Grades each move once you make it',
  study: 'Also shows the values while you decide',
  locked: 'Off while several people play, for fair play',
};

export function shieldSVG(color, idx = 0) {
  return `<svg class="shield" viewBox="0 0 64 72"><defs><linearGradient id="sg${idx}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#b8841f"/><stop offset="1" stop-color="#f3cf6a"/></linearGradient></defs>
    <path d="M6 6 H58 V34 C58 52 44 62 32 68 C20 62 6 52 6 34 Z" fill="${color}" stroke="url(#sg${idx})" stroke-width="4"/>
    <path d="M10 10 H54 V20 H10 Z" fill="rgba(255,255,255,0.12)"/>${CHARGES[idx % CHARGES.length]}</svg>`;
}

export class Hud {
  constructor() {
    this.el = {
      hud: $('#hud'), banner: $('#banner'), round: $('#round-label'), prompt: $('#prompt'), sub: $('#subprompt'),
      players: $('#players'), toolbar: $('#toolbar'), actions: $('#actions'), tooltip: $('#tooltip'), toasts: $('#toasts'), views: $('#views'), realms: $('#view-realms'),
      menu: $('#menu'), results: $('#results'), help: $('#help'), settings: $('#settings'), pass: $('#pass'),
      lobby: $('#lobby'), notice: $('#notice'),
      loading: $('#loading'), loadingFill: $('#loading-fill'), loadingText: $('#loading-text'), showResults: $('#show-results'),
    };
    this.handlers = {};
    this.cards = new Map();
    document.querySelectorAll('[data-action]').forEach((b) => {
      b.addEventListener('click', (e) => { e.stopPropagation(); this.emit(b.dataset.action); });
    });
    // Small screens fold the toolbar behind one button. It stays open for the on/off toggles
    // and closes once a button opens something else, or on a tap anywhere outside it.
    const bar = this.el.toolbar;
    this.on('more', () => bar.classList.toggle('open'));
    bar.querySelectorAll('[data-action]').forEach((b) => {
      if (!['more', 'ambience', 'music', 'sound'].includes(b.dataset.action)) b.addEventListener('click', () => bar.classList.remove('open'));
    });
    document.addEventListener('pointerdown', (e) => { if (!bar.contains(e.target)) bar.classList.remove('open'); });
    document.querySelectorAll('.modal').forEach((m) => {
      m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-close')) m.classList.add('hidden'); });
    });
    this.guide = new Guide(this.el.help);
    $('#menu-help').addEventListener('click', () => this.guide.open());
    document.querySelectorAll('.seg[data-setting]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        this.setSeg(seg.dataset.setting, b.dataset.v);
        this.emit('setting', { key: seg.dataset.setting, value: b.dataset.v });
      }));
    });
    this.watchKeyboard();
  }

  // A phone's keyboard covers half the screen, and the menu squeezed into what is left is
  // unreadable. While a name is typed with the keyboard up, the root gets .typing and the open
  // card keeps to the strip above the keyboard (--vv-top, --vv-h), showing only the names.
  watchKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const typing = () => !!document.activeElement?.matches('input[type=text]:not([readonly])');
    // the viewport's height with no keyboard up, and the width it was measured at
    let rest = 0, restW = 0;
    const measure = () => {
      // (turning the phone with the keyboard up: the layout height is the best guess left)
      if (!typing() || window.innerWidth !== restW) { rest = Math.max(vv.height * vv.scale, root.clientHeight); restW = window.innerWidth; }
    };
    const layout = (reveal) => {
      const was = root.classList.contains('typing');
      const up = typing() && rest - vv.height * vv.scale > 120;
      root.classList.toggle('typing', up);
      root.classList.toggle('typing-tight', up && vv.height < 240);
      if (!up) return;
      root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
      root.style.setProperty('--vv-h', `${vv.height}px`);
      // bring the field being edited into view in its card
      const el = document.activeElement, card = el.closest('.menu-card');
      if (!card || (was && !reveal)) return;
      const r = el.getBoundingClientRect(), c = card.getBoundingClientRect();
      if (r.top < c.top || r.bottom > c.bottom) card.scrollTop += (r.top + r.bottom - c.top - c.bottom) / 2;
    };
    measure();
    vv.addEventListener('resize', () => { measure(); layout(false); });
    vv.addEventListener('scroll', () => layout(false));
    document.addEventListener('focusin', () => layout(true));
    // (moving to the next field, its focusin follows at once; the late look is for browsers
    // that still report the old field as focused during focusout)
    document.addEventListener('focusout', () => { layout(false); setTimeout(() => layout(false)); });
    // a tap beside the fields puts the keyboard away (iOS keeps it up otherwise)
    document.addEventListener('pointerdown', (e) => {
      if (root.classList.contains('typing') && !e.target.closest('input, select, button, label')) document.activeElement.blur();
    });
  }

  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, arg) { (this.handlers[name] || []).forEach((f) => f(arg)); }

  setSeg(key, value) {
    if (key === 'coach') { this.setCoach({ value }); return; }
    document.querySelectorAll(`.seg[data-setting="${key}"]`).forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(value)));
    });
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
    seats.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'seat-row';
      row.innerHTML = `${shieldSVG(s.color, i)}<input type="text" maxlength="18" value="${esc(s.name)}" spellcheck="false" enterkeyhint="done" />
        <button type="button" class="seat-pick" aria-haspopup="listbox" aria-label="Who plays this seat"></button>`;
      const input = row.querySelector('input'), pick = row.querySelector('.seat-pick');
      input.addEventListener('input', () => { s.name = input.value; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      pick.addEventListener('click', () => this.pickSeat(pick, s.type, (type) => { s.type = type; face(s); refresh(); }));
      rows.appendChild(row);
      s._row = row;
    });
    const face = (s) => {
      s._row.querySelector('.seat-pick').innerHTML = `${seatFace(SEAT_KINDS.find((k) => k.v === s.type))}<svg class="sp-chev" viewBox="0 0 12 8"><path d="M1 1l5 5 5-5"/></svg>`;
    };
    seats.forEach(face);
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
      // the coach only helps someone playing alone against the computer
      this.setCoach({ locked: seats.filter((s) => s.type === 'human' || s.type === 'remote').length > 1 });
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

  hideMenu() {
    if (this.closeSeatMenu) this.closeSeatMenu();
    this.el.menu.classList.add('hidden');
  }

  // The seat picker: a list in the menu's own style, opened under (or above) the seat's button.
  // Arrow keys move through it, Escape or a tap elsewhere closes it; the same button toggles it.
  pickSeat(button, current, onPick) {
    const again = this.seatMenuFor === button;
    if (this.closeSeatMenu) this.closeSeatMenu();
    if (again) return;
    let menu = $('#seat-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'seat-menu';
      menu.setAttribute('role', 'listbox');
      document.body.appendChild(menu);
    }
    menu.innerHTML = SEAT_KINDS.map((k) => `${k.v === 'easy' ? '<div class="sm-head">Computer</div>' : k.v === 'off' ? '<div class="sm-sep"></div>' : ''}
      <button type="button" role="option" data-v="${k.v}" aria-selected="${k.v === current}" class="${k.v === current ? 'on' : ''}">${seatFace(k)}</button>`).join('');
    menu.className = 'seat-menu';
    const r = button.getBoundingClientRect(), w = Math.max(r.width, 210), h = menu.offsetHeight;
    menu.style.width = `${w}px`;
    menu.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w))}px`;
    menu.style.top = `${r.bottom + 6 + h <= window.innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h)}px`;
    button.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    const opts = [...menu.querySelectorAll('[role=option]')], card = button.closest('.menu-card');
    const close = (focus = false) => {
      menu.classList.add('hidden');
      button.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', keys, true);
      window.removeEventListener('resize', dismiss);
      if (card) card.removeEventListener('scroll', dismiss);
      this.closeSeatMenu = this.seatMenuFor = null;
      if (focus) button.focus();
    };
    const dismiss = () => close();
    const outside = (e) => { if (!menu.contains(e.target) && !button.contains(e.target)) close(); };
    const keys = (e) => {
      const i = opts.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); opts[(i + 1) % opts.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); opts[i <= 0 ? opts.length - 1 : i - 1].focus(); }
      else if (e.key === 'Tab') close();
    };
    opts.forEach((b) => b.addEventListener('click', () => { close(true); onPick(b.dataset.v); }));
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', keys, true);
    window.addEventListener('resize', dismiss);
    if (card) card.addEventListener('scroll', dismiss);
    this.closeSeatMenu = dismiss;
    this.seatMenuFor = button;
    (opts.find((b) => b.dataset.v === current) || opts[0]).focus({ preventScroll: true });
  }

  // The coach's switches, in the menu and in the settings: the player's choice, unless fair play
  // locks it off (more than one person at the table), which leaves the choice for next time.
  setCoach({ value = this.coachValue || 'off', locked = !!this.coachLocked } = {}) {
    this.coachValue = value;
    this.coachLocked = locked;
    document.querySelectorAll('.seg[data-setting="coach"]').forEach((seg) => {
      seg.classList.toggle('locked', locked);
      seg.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', b.dataset.v === (locked ? 'off' : value));
        b.disabled = locked;
      });
    });
    document.querySelectorAll('.coach-note').forEach((n) => {
      n.textContent = COACH_NOTES[locked ? 'locked' : value];
      n.classList.toggle('locked', locked);
    });
  }

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
      c.dataset.view = String(i);
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
    // the score cards stand in for the realm shields on small screens
    for (const el of [d, this.el.players]) {
      el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', view != null && b.dataset.view === String(view)));
    }
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
    q('advice').classList.toggle('hidden', !state.advice);
  }

  // The advice button's light: 'thinking' while the coach analyses, 'ready' once it can answer at
  // once, 'shown' when its advice is on the table.
  setAdvice(state) {
    const b = this.el.actions.querySelector('[data-action="advice"]');
    for (const s of ['thinking', 'ready', 'shown']) b.classList.toggle(s, s === state);
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

  // coach: the coach's verdict for the players at this screen (html), if it was on;
  // note: what stands out against the history (html), such as a new personal best;
  // onReview: opens the game in the history, over this card (none when the history could not keep it)
  showResults(rows, opts, { onAgain, onMenu, onReview = null, hostDeals = false, coach = '', note = '' }) {
    this.el.showResults.classList.add('hidden');
    this.el.showResults.onclick = null;
    const table = $('#results-table');
    const winners = rows.filter((r) => r.place === 1);
    const names = winners.map((w) => this.who(w.player));
    const top = winners[0].s.total;
    $('#winner-line').innerHTML = winners.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} tie for first place.`
      : `${this.wins(winners[0].player)} with ${top} point${top === 1 ? '' : 's'}.`;
    $('#results-note').innerHTML = note;
    $('#results-note').classList.toggle('hidden', !note);
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
    $('#results-coach').innerHTML = coach;
    $('#results-coach').classList.toggle('hidden', !coach);
    this.el.results.classList.remove('hidden');
    const again = $('#res-again'), menu = $('#res-menu'), admire = $('#res-admire'), review = $('#res-review');
    // an online guest waits for the host to deal the next game
    again.disabled = hostDeals;
    again.classList.toggle('waiting', hostDeals);
    again.querySelector('span').textContent = hostDeals ? 'Waiting for the host to start again' : 'Play again';
    menu.textContent = hostDeals ? 'Leave game' : 'Main menu';
    review.classList.toggle('hidden', !onReview);
    const cleanup = () => { again.onclick = menu.onclick = admire.onclick = review.onclick = this.el.showResults.onclick = null; };
    again.onclick = () => { cleanup(); this.el.results.classList.add('hidden'); onAgain(); };
    menu.onclick = () => { cleanup(); this.el.results.classList.add('hidden'); onMenu(); };
    // the history opens over the card, which is still there once it closes
    review.onclick = onReview && (() => onReview());
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
    const join = () => { name.blur(); if (onJoin) onJoin(name.value); };
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
