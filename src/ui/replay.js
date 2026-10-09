// A finished game played back in the history window, move by move: every kingdom growing on its own
// frame, the drafting board's two lines, what each move did and, once the coach has reviewed the game,
// its grade and what the Expert would have done instead.
import { TERRAIN_INFO, dominoById, footprint } from '../core/rules.js';
import { decodeAction } from '../core/moves.js';
import { gradeOf, isPoor } from '../core/review.js';
import { esc, shieldSVG } from './hud.js';

const EXPERT = '#6fe3ff', LAST = '#ffe08a';
const cls = (grade) => `g-${grade.toLowerCase()}`;

// Every square of a kingdom from its placements: 'x,y' → { terrain, crowns, id }, the castle included.
function cellsOf(placements) {
  const cells = new Map([['0,0', { terrain: 'castle', crowns: 0, id: 0 }]]);
  for (const { id, x, y, rot } of placements) {
    const d = dominoById(id);
    footprint(x, y, rot).forEach(([cx, cy], i) => cells.set(`${cx},${cy}`, { ...d.squares[i], id }));
  }
  return cells;
}

// The square frame a kingdom is drawn on: at least size × size, around every square it will hold.
function frameOf(points, size) {
  const xs = [0, ...points.map((p) => p[0])], ys = [0, ...points.map((p) => p[1])];
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const n = Math.max(size, x1 - x0 + 1, y1 - y0 + 1);
  return { x0: x0 - Math.floor((n - (x1 - x0 + 1)) / 2), y0: y0 - Math.floor((n - (y1 - y0 + 1)) / 2), n };
}
const squaresOf = (placements) => placements.flatMap(({ x, y, rot }) => footprint(x, y, rot));

// A kingdom square by square on `frame`. marks: { id, color } outlines a domino already laid; { domino,
// at: { x, y, rot }, color, dashed } lays one over the kingdom (filled unless dashed).
function realmSVG(placements, frame, { cell = 20, marks = [] } = {}) {
  const { x0, y0, n } = frame, W = n * cell, gap = 1, s = cell - 2 * gap;
  const px = (x) => (x - x0) * cell + gap, py = (y) => (y - y0) * cell + gap;
  const square = (x, y, c, extra = '') => (c.terrain === 'castle'
    ? `<rect x="${px(x)}" y="${py(y)}" width="${s}" height="${s}" rx="${s * 0.2}" fill="#d9cfb8" stroke="rgba(150,120,60,0.8)" stroke-width="${cell / 14}"${extra}/>`
    : `<rect x="${px(x)}" y="${py(y)}" width="${s}" height="${s}" rx="${s * 0.2}" fill="${TERRAIN_INFO[c.terrain].color}"${extra}/>`)
    + Array.from({ length: c.crowns }, (_, i) => `<circle cx="${px(x) + s * (0.5 + (i - (c.crowns - 1) / 2) * 0.3)}" cy="${py(y) + s * 0.28}" r="${s * 0.12}" fill="#fff3c4" stroke="#3a2604" stroke-width="${s * 0.05}"/>`).join('');
  const outline = (sq, color, dashed) => sq.map(([x, y]) => `<rect x="${px(x) - 0.5}" y="${py(y) - 0.5}" width="${s + 1}" height="${s + 1}" rx="${s * 0.2}" fill="none" stroke="${color}" stroke-width="2.2"${dashed ? ' stroke-dasharray="3 2.5"' : ''}/>`).join('');
  let out = '';
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) out += `<rect x="${px(x)}" y="${py(y)}" width="${s}" height="${s}" rx="${s * 0.2}" fill="rgba(255,255,255,0.045)"/>`;
  const cells = cellsOf(placements);
  for (const [key, c] of cells) { const [x, y] = key.split(',').map(Number); out += square(x, y, c); }
  for (const m of marks) {
    if (m.at) {
      const sq = footprint(m.at.x, m.at.y, m.at.rot);
      if (!m.dashed) sq.forEach(([x, y], i) => { out += square(x, y, m.domino.squares[i], ' opacity="0.9"'); });
      out += outline(sq, m.color, m.dashed);
    } else out += outline([...cells].filter(([, c]) => c.id === m.id).map(([key]) => key.split(',').map(Number)), m.color);
  }
  return `<svg class="rp-map" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" aria-hidden="true">${out}</svg>`;
}

// A domino as it lies on the drafting board: its two squares and its number, ringed in its owner's colour.
function dominoChip(id, { color = null, done = false, glow = null } = {}) {
  const d = dominoById(id), s = 15;
  const sq = d.squares.map((q, i) => `<rect x="${i * (s + 1)}" y="0" width="${s}" height="${s}" rx="3" fill="${TERRAIN_INFO[q.terrain].color}"/>`
    + Array.from({ length: q.crowns }, (_, j) => `<circle cx="${i * (s + 1) + s * (0.5 + (j - (q.crowns - 1) / 2) * 0.3)}" cy="${s * 0.3}" r="${s * 0.12}" fill="#fff3c4" stroke="#3a2604" stroke-width="0.7"/>`).join('')).join('');
  const style = [color && `--pc:${color}`, glow && `--glow:${glow}`].filter(Boolean).join(';');
  return `<span class="rp-dom${color ? ' owned' : ''}${done ? ' done' : ''}${glow ? ' glow' : ''}"${style ? ` style="${style}"` : ''}><svg width="${2 * s + 1}" height="${s}" viewBox="0 0 ${2 * s + 1} ${s}" aria-hidden="true">${sq}</svg><b>${id}</b></span>`;
}

const ICONS = {
  first: '<path d="M6 5v14M19 5l-9 7 9 7z"/>',
  prev: '<path d="M16 5l-9 7 9 7z"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  next: '<path d="M8 5l9 7-9 7z"/>',
  last: '<path d="M18 5v14M5 5l9 7-9 7z"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

export class ReplayView {
  // record: a history record; data: replayRecord(record)'s frames, turns and rounds; step: the move to
  // open on (0: the table as dealt, k: after the k-th move).
  constructor(record, data, step = 0) {
    this.r = record;
    Object.assign(this, data);
    this.k = Math.max(0, Math.min(step, this.turns.length));
    this.size = record.rules.mightyDuel ? 7 : 5;
    // each kingdom keeps one frame from start to end, so it grows in place
    const last = this.frames[this.frames.length - 1];
    this.boxes = last.kingdoms.map((k) => frameOf(squaresOf(k.placements), this.size));
    this.timer = null;
  }

  html() {
    const total = this.turns.length;
    const button = (name, label) => `<button type="button" class="rp-btn" data-rp="${name}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
    return `<div class="rp">
      <div class="rp-bar">
        ${button('first', 'Start')}${button('prev', 'Previous move (←)')}
        <button type="button" class="rp-btn rp-play" data-rp="play" aria-label="Play (space)" title="Play (space)">${icon('play')}</button>
        ${button('next', 'Next move (→)')}${button('last', 'End')}
        <input type="range" class="rp-range" min="0" max="${total}" value="${this.k}" aria-label="Move" />
        <span class="rp-count"></span>
      </div>
      <div class="rp-say" aria-live="polite"></div>
      <div class="rp-coach"></div>
      <div class="rp-board"></div>
      <div class="rp-realms"></div>
    </div>`;
  }

  mount(root) {
    this.root = root.querySelector('.rp');
    const q = (s) => this.root.querySelector(s);
    this.el = { range: q('.rp-range'), count: q('.rp-count'), say: q('.rp-say'), coach: q('.rp-coach'), board: q('.rp-board'), realms: q('.rp-realms'), play: q('.rp-play') };
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rp]');
      if (!b) return;
      const a = b.dataset.rp;
      if (a === 'play') { this.toggle(); return; }
      this.pause();
      this.go(a === 'first' ? 0 : a === 'last' ? this.turns.length : this.k + (a === 'next' ? 1 : -1));
    });
    this.el.range.addEventListener('input', () => { this.pause(); this.go(Number(this.el.range.value)); });
    this.go(this.k);
  }

  // Keys while the replay shows: arrows step, Home and End jump, space plays and pauses.
  key(e) {
    const tag = e.target.tagName;
    if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); this.toggle(); }
    else if (tag === 'INPUT') return;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.pause(); this.go(this.k + (e.key === 'ArrowRight' ? 1 : -1)); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); this.pause(); this.go(e.key === 'Home' ? 0 : this.turns.length); }
  }

  toggle() { if (this.timer) this.pause(); else this.play(); }

  play() {
    if (this.k >= this.turns.length) this.go(0);
    this.timer = setInterval(() => { if (this.k >= this.turns.length) this.pause(); else this.go(this.k + 1); }, 1100);
    this.el.play.innerHTML = icon('pause');
    this.el.play.setAttribute('aria-label', 'Pause (space)');
  }

  pause() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    if (this.el) { this.el.play.innerHTML = icon('play'); this.el.play.setAttribute('aria-label', 'Play (space)'); }
  }

  // The record again, with the coach's grades that have landed since.
  refresh(record) { this.r = record; this.go(this.k); }

  who(seat) {
    const p = this.r.players[seat];
    return `<b class="rp-who" style="color:${p.color}">${esc(p.name)}</b>`;
  }

  // "picks" or, for the menu's default "You", "pick"
  verb(seat, word) { return /^you$/i.test(this.r.players[seat].name.trim()) ? word : `${word}s`; }

  go(k) {
    this.k = k = Math.max(0, Math.min(k, this.turns.length));
    const frame = this.frames[k], before = k ? this.frames[k - 1] : null, turn = k ? this.turns[k - 1] : null;
    this.el.range.value = k;
    const label = k === this.turns.length ? 'Game over' : frame.round ? `Round ${frame.round} of ${this.rounds}` : 'Opening draft';
    this.el.count.innerHTML = `<b>${k}</b>/${this.turns.length}<span>${label}</span>`;
    this.el.say.innerHTML = this.caption(k, frame, before, turn);
    this.el.coach.innerHTML = turn ? this.coachNote(k - 1, turn, before) : '';
    this.el.board.innerHTML = this.board(frame, turn);
    this.el.realms.innerHTML = this.realms(frame, turn);
  }

  caption(k, frame, before, turn) {
    if (!turn) return `The dominoes are dealt. ${this.who(frame.mover)} ${this.verb(frame.mover, 'open')} the draft.`;
    const { seat } = turn;
    let say;
    if (turn.kind === 'select') say = `${this.who(seat)} ${this.verb(seat, 'pick')} domino ${turn.id}${turn.phase === 'open' ? ' in the opening draft' : ''}.`;
    else if (!turn.value) say = `${this.who(seat)} cannot place domino ${turn.id}: it fits nowhere and is discarded.`;
    else {
      const gain = frame.kingdoms[seat].score - before.kingdoms[seat].score;
      say = `${this.who(seat)} ${this.verb(seat, 'lay')} domino ${turn.id}${gain > 0 ? ` <span class="rp-gain">+${gain}</span>` : ''}.`;
    }
    for (const id of frame.unclaimed.slice(before.unclaimed.length)) say += ` Nobody took domino ${id}: it is discarded.`;
    if (k === this.turns.length) {
      const first = this.r.players.filter((p) => p.place === 1);
      say += first.length > 1 ? ` <span class="rp-end">A tie at ${first[0].total} points.</span>`
        : ` <span class="rp-end">${esc(first[0].name)} ${this.verb(this.r.players.indexOf(first[0]), 'win')} with ${first[0].total} points.</span>`;
    }
    return say;
  }

  // The coach's grade for this move, once the game has been reviewed, and after a poor one what the
  // Expert would have done.
  coachNote(i, turn, before) {
    const mark = this.r.review && this.r.review[i];
    if (!mark) return '';
    const [loss, best] = mark, grade = gradeOf(loss);
    const badge = `<span class="grade-badge ${cls(grade)}"><b>${grade}</b>${grade === 'Best' ? '' : `<span>−${loss.toFixed(1)}</span>`}</span>`;
    if (!isPoor(loss)) {
      const text = grade === 'Best' ? (loss ? 'As good as the Expert’s choice.' : 'The Expert’s choice too.') : `${loss.toFixed(1)} points of final lead given up against the Expert’s choice.`;
      return `<div class="rp-grade">${badge}<span>${text}</span></div>`;
    }
    const alt = decodeAction(best);
    if (turn.kind === 'select') {
      const id = turn.line[alt.value];
      return `<div class="rp-grade">${badge}<span>The Expert would have picked domino ${id}</span>${dominoChip(id, { glow: EXPERT })}</div>`;
    }
    if (!alt.value) return `<div class="rp-grade">${badge}<span>The Expert would have discarded it.</span></div>`;
    const placements = before.kingdoms[turn.seat].placements, domino = dominoById(turn.id);
    const marks = [{ domino, at: alt.value, color: EXPERT }, ...(turn.value ? [{ domino, at: turn.value, color: LAST, dashed: true }] : [])];
    const frame = frameOf([...squaresOf(placements), ...marks.flatMap((m) => footprint(m.at.x, m.at.y, m.at.rot))], this.size);
    return `<div class="rp-grade">${badge}<span>The Expert would have laid it <i class="rp-key" style="--c:${EXPERT}"></i>here, not <i class="rp-key dashed" style="--c:${LAST}"></i>there.</span>
      <div class="rp-alt">${realmSVG(placements, frame, { cell: 20, marks })}</div></div>`;
  }

  // The drafting board: the line being placed, the line being picked from, and the chest.
  board(frame, turn) {
    const color = (seat) => (seat >= 0 ? this.r.players[seat].color : null);
    const line = (slots) => (slots.length ? slots.map((s) => dominoChip(s.id, { color: color(s.seat), done: s.done, glow: turn && turn.kind === 'select' && s.id === turn.id ? LAST : null })).join('')
      : '<span class="rp-none">—</span>');
    return `<div class="rp-line"><span>This round</span><div>${line(frame.current)}</div></div>
      <div class="rp-line"><span>Next round</span><div>${line(frame.next)}</div></div>
      <div class="rp-chest">${frame.left ? `${frame.left} in the chest` : 'Chest empty'}</div>`;
  }

  realms(frame, turn) {
    return this.r.players.map((p, seat) => {
      const k = frame.kingdoms[seat], moved = turn && turn.seat === seat;
      const marks = moved && turn.kind === 'place' && turn.value ? [{ id: turn.id, color: LAST }] : [];
      const discards = k.discards.length ? `<small>${k.discards.length} discarded</small>` : '';
      return `<div class="rp-realm${moved ? ' on' : ''}${frame.mover === seat ? ' next' : ''}" style="--pc:${p.color}">
        <div class="rp-realm-head">${shieldSVG(p.color, p.crest)}<span>${esc(p.name)}</span><b>${k.score}</b></div>
        ${realmSVG(k.placements, this.boxes[seat], { cell: this.size === 7 ? 15 : 20, marks })}${discards}</div>`;
    }).join('');
  }
}
