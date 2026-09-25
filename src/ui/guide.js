// "How to play" as a short illustrated tour: one idea per page, each drawn in the game's own palette.
import { TERRAIN_INFO } from '../core/rules.js';

const GOLD = '#f0c75e';
const WOOD = '#6e4a2b';
const PINK = '#e2558f', YELLOW = '#f2c230';
const CROWN = 'M4 40 L4 12 L18 26 L32 4 L46 26 L60 12 L60 40 Z';

// Terrain motifs, drawn in a 30 x 30 square.
const MOTIFS = {
  wheat: '<path d="M8 24V9M15 25V8M22 24V9" stroke="#a67c14" stroke-width="1.3"/><path d="M5 12l3 2 3-2M5 16l3 2 3-2M12 11l3 2 3-2M12 15l3 2 3-2M19 12l3 2 3-2M19 16l3 2 3-2" stroke="#8f6a0e" stroke-width="1.2" fill="none"/>',
  forest: '<path d="M9 4l7 13H2zM21 8l7 13H14zM12 13l7 13H5z" fill="#173d1e"/><path d="M9 4l3.5 6.5H5.5zM21 8l3.5 6.5h-7zM12 13l3.5 6.5h-7z" fill="#3f8a48"/>',
  lake: '<path d="M5 11q3.5-3 7 0t7 0 7 0M8 19q3.5-3 7 0t7 0" stroke="#a8d6f7" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  grass: '<path d="M6 13l2 5 2-5M18 8l2 5 2-5M12 20l2 5 2-5M21 18l2 5 2-5" stroke="#4f8a22" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  swamp: '<ellipse cx="17" cy="20" rx="9" ry="4.5" fill="#4d5638"/><path d="M7 22V10M10 23V13M24 15V6" stroke="#b8ad6e" stroke-width="1.3"/><rect x="5.8" y="8" width="2.4" height="5" rx="1.2" fill="#5a3d1e"/><rect x="22.8" y="4" width="2.4" height="5" rx="1.2" fill="#5a3d1e"/>',
  mine: '<path d="M2 26l9-16 6 9 4-6 7 13z" fill="#6d6977"/><path d="M11 10l3 5H8z" fill="#a19dab"/><path d="M13 26v-4a3 3 0 0 1 6 0v4z" fill="#1d1b22"/>',
};

const bevel = '<path d="M1.5 26V4A2.5 2.5 0 0 1 4 1.5h22" stroke="rgba(255,255,255,.25)" stroke-width="1.2" fill="none"/><path d="M28.5 4v22a2.5 2.5 0 0 1-2.5 2.5H4" stroke="rgba(0,0,0,.28)" stroke-width="1.2" fill="none"/>';

// One square of land at (x, y), s units wide, with its crowns in the top corner.
function square(x, y, s, terrain, crowns = 0) {
  const crownMarks = Array.from({ length: crowns }, (_, i) =>
    `<path transform="translate(${2.5 + i * 10} 2.5) scale(.15)" d="${CROWN}" fill="${GOLD}" stroke="#4a2c04" stroke-width="7" stroke-linejoin="round"/>`).join('');
  return `<g transform="translate(${x} ${y}) scale(${s / 30})"><rect width="30" height="30" rx="3" fill="${TERRAIN_INFO[terrain].color}"/>${MOTIFS[terrain]}${bevel}${crownMarks}</g>`;
}

function castle(x, y, s, color = PINK) {
  return `<g transform="translate(${x} ${y}) scale(${s / 30})"><rect width="30" height="30" rx="3" fill="${TERRAIN_INFO.castle.color}"/>
    <path d="M6 26V12h3V9h3v3h2V9h3v3h2V9h3v3h3v14z" fill="#8e877b" stroke="#5e584f" stroke-width="1"/>
    <path d="M13 26v-5a2 2 0 0 1 4 0v5z" fill="#3a332c"/><path d="M15 9V2.5" stroke="#5e584f" stroke-width="1.2"/>
    <path d="M15 2.5h7l-2 2 2 2h-7z" fill="${color}"/>${bevel}</g>`;
}

// A domino on the kingdom grid: two squares [col, row, terrain, crowns] on a wooden base.
function domino(ox, oy, s, a, b, cls = '') {
  const [c1, r1] = a, [c2, r2] = b;
  const x = ox + Math.min(c1, c2) * s, y = oy + Math.min(r1, r2) * s;
  const w = (Math.abs(c1 - c2) + 1) * s, h = (Math.abs(r1 - r2) + 1) * s;
  const one = ([c, r, t, k]) => square(ox + c * s + 1.5, oy + r * s + 1.5, s - 3, t, k);
  return `<g class="${cls}"><rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="4" fill="${WOOD}" stroke="#3d2715"/>${one(a)}${one(b)}</g>`;
}

function grid(ox, oy, s, cols, rows) {
  let d = '';
  for (let c = 0; c <= cols; c++) d += `M${ox + c * s} ${oy}v${rows * s}`;
  for (let r = 0; r <= rows; r++) d += `M${ox} ${oy + r * s}h${cols * s}`;
  return `<path d="${d}" stroke="rgba(240,199,94,.13)" stroke-width="1" fill="none"/>`;
}

// The outline of a group of cells, e.g. one property.
function outline(ox, oy, s, cells, attrs = '') {
  const has = new Set(cells.map(([c, r]) => `${c},${r}`));
  let d = '';
  for (const [c, r] of cells) {
    const x = ox + c * s, y = oy + r * s;
    if (!has.has(`${c},${r - 1}`)) d += `M${x} ${y}h${s}`;
    if (!has.has(`${c},${r + 1}`)) d += `M${x} ${y + s}h${s}`;
    if (!has.has(`${c - 1},${r}`)) d += `M${x} ${y}v${s}`;
    if (!has.has(`${c + 1},${r}`)) d += `M${x + s} ${y}v${s}`;
  }
  return `<path d="${d}" fill="none" stroke-linecap="round" ${attrs}/>`;
}

// A king meeple standing at (x, y).
function king(x, y, color) {
  return `<g transform="translate(${x} ${y})"><ellipse rx="10" ry="3.5" fill="rgba(0,0,0,.4)"/>
    <path d="M-8 0l3-15h10l3 15z" fill="${color}" stroke="rgba(0,0,0,.45)" stroke-width="1"/>
    <circle cy="-19" r="5.5" fill="${color}" stroke="rgba(0,0,0,.45)" stroke-width="1"/>
    <path d="M-5 -24v-6l2.5 3 2.5-4 2.5 4 2.5-3v6z" fill="${GOLD}" stroke="#4a2c04" stroke-width=".8" stroke-linejoin="round"/></g>`;
}

const ok = (x, y) => `<g class="a-pop"><g transform="translate(${x} ${y})"><circle r="11" fill="#3d9b4f" stroke="#e9ffe9" stroke-width="1.5"/><path d="M-5 0l3.5 3.5 6.5-7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g></g>`;
const no = (x, y) => `<g class="a-pop"><g transform="translate(${x} ${y})"><circle r="11" fill="#c23a2e" stroke="#ffe6e2" stroke-width="1.5"/><path d="M-4 -4l8 8M4 -4l-8 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></g></g>`;
const text = (x, y, s, cls = '', anchor = 'middle') => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${s}</text>`;
const svg = (body, label) => `<svg viewBox="0 0 400 200" role="img" aria-label="${label}">${body}</svg>`;

const ART = {
  // A kingdom taking shape around its castle, and the next domino on its way in.
  goal() {
    const ox = 190, oy = 30, s = 32;
    const dominoes = [
      [[0, 0, 'forest', 1], [1, 0, 'forest', 0]], [[2, 0, 'wheat', 0], [3, 0, 'wheat', 0]],
      [[0, 1, 'forest', 0], [0, 2, 'lake', 1]], [[1, 1, 'lake', 0], [1, 2, 'lake', 0]],
      [[2, 1, 'wheat', 0], [3, 1, 'grass', 0]], [[3, 2, 'grass', 0], [4, 2, 'grass', 1]],
      [[1, 3, 'mine', 0], [2, 3, 'mine', 2]], [[3, 3, 'swamp', 0], [3, 4, 'swamp', 0]],
    ];
    return svg(`
      <rect x="${ox - 4}" y="${oy - 4}" width="${5 * s + 8}" height="${5 * s + 8}" rx="8" fill="none" stroke="${GOLD}" stroke-opacity=".14" stroke-width="7"/>
      <rect x="${ox - 4}" y="${oy - 4}" width="${5 * s + 8}" height="${5 * s + 8}" rx="8" fill="none" stroke="${GOLD}" stroke-opacity=".6" stroke-width="1.2"/>
      ${grid(ox, oy, s, 5, 5)}
      ${castle(ox + 2 * s + 1.5, oy + 2 * s + 1.5, s - 3)}
      ${dominoes.map(([a, b]) => domino(ox, oy, s, a, b)).join('')}
      <rect class="a-pulse" x="${ox + s + 1.5}" y="${oy + 4 * s + 1.5}" width="${2 * s - 3}" height="${s - 3}" rx="4" fill="rgba(240,199,94,.14)" stroke="${GOLD}" stroke-dasharray="4 3"/>
      <path class="a-flow" d="M122 102C160 102 170 ${oy + 4.5 * s} ${ox + s - 6} ${oy + 4.5 * s}" fill="none" stroke="${GOLD}" stroke-width="1.6"/>
      <path d="M${ox + s - 2} ${oy + 4.5 * s}l-8 -4.5v9z" fill="${GOLD}"/>
      <g class="a-float"><g transform="rotate(-8 84 96)">${domino(52, 80, s, [0, 0, 'mine', 1], [1, 0, 'swamp', 0])}</g></g>
      ${text(84, 142, 'one domino', 'note')}${text(84, 159, 'each round', 'note')}
      ${text(ox + 2.5 * s, oy - 12, '5 × 5', 'cap')}`, 'A kingdom of dominoes growing around its castle');
  },

  // The draft line in number order: kings claim dominoes; a low number means an early pick next round.
  pick() {
    const x = 84, s = 36, rows = [12, 58, 104, 150];
    const line = [
      [6, 'wheat', 0, 'wheat', 0], [17, 'lake', 0, 'grass', 0], [29, 'forest', 1, 'wheat', 0], [43, 'wheat', 0, 'mine', 2],
    ];
    const body = line.map(([n, t1, k1, t2, k2], i) => `
      <circle cx="${x - 22}" cy="${rows[i] + s / 2}" r="12" fill="#f4ead3" stroke="#a8761c" stroke-width="1.5"/>
      ${text(x - 22, rows[i] + s / 2 + 4.5, n, 'num')}
      ${domino(x, rows[i], s, [0, 0, t1, k1], [1, 0, t2, k2], i === 2 ? 'a-claim' : '')}`).join('');
    // the kings stand on the seam, leaving both squares in sight
    return svg(`${body}
      <g>${king(x + s, rows[0] + 30, YELLOW)}</g>
      <g class="a-hop">${king(x + s, rows[2] + 30, PINK)}</g>
      <path d="M186 20V178" stroke="${GOLD}" stroke-opacity=".55" stroke-width="1.5"/><path d="M186 186l-5-9h10z" fill="${GOLD}" fill-opacity=".8"/>
      <circle cx="186" cy="20" r="3" fill="${GOLD}"/>
      ${text(200, 26, 'Low number', 'cap', 'start')}${text(200, 44, 'you pick sooner next round', 'note', 'start')}
      ${text(200, 164, 'High number', 'cap', 'start')}${text(200, 182, 'usually more crowns', 'note', 'start')}`,
    'Four dominoes in number order, two of them claimed by kings');
  },

  // Three new dominoes: next to the castle, matching a terrain, and one that matches nothing.
  place() {
    const s = 28, oy = 20;
    const panel = (cx, scene, badge, caption) => `<g>${grid(cx - 1.5 * s, oy, s, 3, 3)}${scene(cx - 1.5 * s)}${badge(cx, 128)}${text(cx, 162, caption, 'note')}</g>`;
    const edge = (x1, y1, x2, y2, good) => `<path class="a-pulse" d="M${x1} ${y1}L${x2} ${y2}" stroke="${good ? '#8ff0a4' : '#ff7a6b'}" stroke-width="3.5" stroke-linecap="round"/>`;
    const at = (ox, c, r) => [ox + c * s + 1.5, oy + r * s + 1.5, s - 3];
    return svg(`
      ${panel(70, (ox) => `${castle(...at(ox, 0, 1))}${domino(ox, oy, s, [1, 1, 'lake', 0], [2, 1, 'grass', 1], 'a-drop new')}
        ${edge(ox + s, oy + s + 4, ox + s, oy + 2 * s - 4, true)}`, ok, 'next to the castle')}
      ${panel(200, (ox) => `${castle(...at(ox, 0, 0))}${domino(ox, oy, s, [1, 0, 'forest', 0], [2, 0, 'forest', 0])}
        ${domino(ox, oy, s, [2, 1, 'forest', 1], [2, 2, 'wheat', 0], 'a-drop new')}
        ${edge(ox + 2 * s + 4, oy + s, ox + 3 * s - 4, oy + s, true)}`, ok, 'forest meets forest')}
      ${panel(330, (ox) => `${castle(...at(ox, 0, 0))}${domino(ox, oy, s, [1, 0, 'lake', 0], [2, 0, 'lake', 0])}
        ${domino(ox, oy, s, [1, 1, 'wheat', 0], [2, 1, 'grass', 0], 'a-drop new')}
        ${edge(ox + s + 4, oy + s, ox + 3 * s - 4, oy + s, false)}`, no, 'nothing matches')}`,
    'Two legal placements and one illegal one');
  },

  // The 5 x 5 frame: a domino that would stick out is refused; one that fits nowhere is discarded.
  fit() {
    const ox = 56, oy = 38, s = 26;
    const dominoes = [
      [[1, 0, 'wheat', 0], [2, 0, 'wheat', 0]], [[3, 0, 'forest', 0], [3, 1, 'forest', 0]],
      [[0, 1, 'grass', 0], [1, 1, 'grass', 0]], [[2, 1, 'lake', 0], [2, 2, 'lake', 1]],
      [[4, 1, 'forest', 1], [4, 2, 'grass', 0]], [[0, 2, 'grass', 0], [0, 3, 'swamp', 0]],
      [[1, 3, 'swamp', 0], [2, 3, 'mine', 1]],
    ];
    return svg(`
      <rect class="a-glow" x="${ox - 4}" y="${oy - 4}" width="${5 * s + 8}" height="${5 * s + 8}" rx="7" fill="none" stroke="${GOLD}" stroke-opacity=".18" stroke-width="8"/>
      <rect x="${ox - 4}" y="${oy - 4}" width="${5 * s + 8}" height="${5 * s + 8}" rx="7" fill="none" stroke="${GOLD}" stroke-width="1.4"/>
      ${grid(ox, oy, s, 5, 5)}
      ${castle(ox + s + 1.5, oy + 2 * s + 1.5, s - 3)}
      ${dominoes.map(([a, b]) => domino(ox, oy, s, a, b)).join('')}
      ${text(ox + 2.5 * s, oy - 14, '5 × 5', 'cap')}
      <g opacity=".85">${domino(ox, oy, s, [5, 1, 'forest', 0], [6, 1, 'lake', 0], 'a-drop')}</g>
      <rect x="${ox + 5 * s + 1}" y="${oy + s + 1}" width="${2 * s - 2}" height="${s - 2}" rx="4" fill="none" stroke="#ff7a6b" stroke-width="2" stroke-dasharray="4 3"/>
      ${no(ox + 6 * s, oy + s - 12)}
      ${text(ox + 7 * s + 10, oy + 1.5 * s + 5, 'outside the square', 'note', 'start')}
      <g transform="rotate(-9 318 152)"><rect x="292" y="139" width="52" height="26" rx="4" fill="#8a5d33" stroke="#3d2715"/>
        <rect x="295" y="142" width="46" height="20" rx="3" fill="none" stroke="rgba(255,230,190,.25)"/>${text(318, 156.5, '37', 'num back')}</g>
      ${text(318, 188, 'fits nowhere: discarded', 'note')}`,
    'A kingdom filling its 5 by 5 frame, a domino sticking out of it, and a discarded domino');
  },

  // A kingdom's properties and what each one scores.
  score() {
    const ox = 22, oy = 50, s = 34;
    const dominoes = [
      [[0, 0, 'forest', 1], [1, 0, 'forest', 0]], [[0, 1, 'forest', 0], [1, 1, 'forest', 1]],
      [[3, 0, 'lake', 0], [4, 0, 'lake', 1]], [[4, 1, 'lake', 0], [4, 2, 'wheat', 0]],
      [[2, 1, 'wheat', 0], [3, 1, 'wheat', 0]], [[0, 2, 'wheat', 0], [1, 2, 'wheat', 0]], [[2, 2, 'wheat', 0], [3, 2, 'wheat', 0]],
    ];
    const props = [
      ['forest', [[0, 0], [1, 0], [0, 1], [1, 1]], '4 × 2 = 8'],
      ['lake', [[3, 0], [4, 0], [4, 1]], '3 × 1 = 3'],
      ['wheat', [[2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2]], '7 × 0 = 0'],
    ];
    // each property lights up in turn with its line of the tally
    const phase = (i) => `style="animation-delay:${[0, -3, -1.5][i]}s"`;
    const lines = props.map(([t, , sum], i) => `<g class="a-cycle" ${phase(i)}>
      <rect x="228" y="${66 + i * 32}" width="16" height="16" rx="3" fill="${TERRAIN_INFO[t].color}" stroke="rgba(0,0,0,.35)"/>
      ${text(254, 80 + i * 32, sum, 'big', 'start')}</g>`).join('');
    return svg(`
      ${grid(ox, oy, s, 5, 3)}
      ${castle(ox + 2 * s + 1.5, oy + 1.5, s - 3)}
      ${dominoes.map(([a, b]) => domino(ox, oy, s, a, b)).join('')}
      ${props.map(([, cells], i) => `<g class="a-cycle" ${phase(i)}>${outline(ox, oy, s, cells, 'stroke="#fff0b8" stroke-width="3.5"')}</g>`).join('')}
      ${text(254, 52, 'squares × crowns', 'cap', 'start')}
      ${lines}
      <path d="M228 170H372" stroke="${GOLD}" stroke-opacity=".45"/>
      ${text(228, 192, 'Total', 'cap', 'start')}${text(372, 193, '11', 'big gold', 'end')}`,
    'A kingdom whose forest scores 8, lake scores 3 and crownless fields score nothing');
  },
};

export class Guide {
  constructor(el) {
    this.el = el;
    this.pages = [...el.querySelectorAll('.guide-page')];
    this.tabs = el.querySelector('.guide-tabs');
    this.prev = el.querySelector('[data-guide="prev"]');
    this.next = el.querySelector('[data-guide="next"]');
    this.count = el.querySelector('.guide-count');
    this.at = 0;
    this.seen = new Set([0]);
    el.querySelectorAll('[data-art]').forEach((a) => { a.innerHTML = ART[a.dataset.art](); });
    this.tabs.innerHTML = this.pages.map((p, i) =>
      `<button class="guide-tab" role="tab" data-i="${i}" aria-controls="guide-${i}">${p.dataset.tab}</button>`).join('');
    this.pages.forEach((p, i) => { p.id = `guide-${i}`; p.setAttribute('role', 'tabpanel'); });
    this.tabs.addEventListener('click', (e) => { const b = e.target.closest('.guide-tab'); if (b) this.go(Number(b.dataset.i)); });
    this.prev.addEventListener('click', () => this.go(this.at - 1));
    this.next.addEventListener('click', () => (this.at === this.pages.length - 1 ? this.close() : this.go(this.at + 1)));
    // While the guide is open the arrow keys turn its pages rather than steer a domino.
    window.addEventListener('keydown', (e) => {
      if (this.el.classList.contains('hidden') || !/^Arrow(Left|Right)$/.test(e.key)) return;
      e.stopPropagation();
      e.preventDefault();
      this.go(this.at + (e.key === 'ArrowRight' ? 1 : -1));
    }, true);
    // a swipe turns the page on touch screens
    const area = el.querySelector('.guide-pages');
    let start = null;
    area.addEventListener('pointerdown', (e) => { start = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY }; });
    area.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) this.go(this.at + (dx < 0 ? 1 : -1));
    });
    area.addEventListener('pointercancel', () => { start = null; });
    this.go(0);
  }

  go(i) {
    if (i < 0 || i >= this.pages.length) return;
    this.at = i;
    this.seen.add(i);
    this.pages.forEach((p, k) => { p.classList.toggle('on', k === i); p.classList.toggle('before', k < i); p.setAttribute('aria-hidden', String(k !== i)); });
    this.tabs.querySelectorAll('.guide-tab').forEach((b, k) => {
      b.classList.toggle('on', k === i);
      b.classList.toggle('seen', this.seen.has(k));
      b.setAttribute('aria-selected', String(k === i));
    });
    const last = i === this.pages.length - 1;
    this.prev.style.visibility = i ? '' : 'hidden';
    this.next.querySelector('span').textContent = last ? 'Got it' : 'Next';
    this.count.textContent = `${i + 1} / ${this.pages.length}`;
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  open() {
    this.el.classList.remove('hidden');
    // replay the pictures' little animations
    const page = this.pages[this.at];
    page.classList.remove('on');
    void page.offsetWidth;
    page.classList.add('on');
  }

  close() { this.el.classList.add('hidden'); }

  toggle() { if (this.isOpen) this.close(); else this.open(); }
}
