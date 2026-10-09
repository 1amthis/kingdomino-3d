// The coach at the table: while the player decides, the Expert quietly analyses the position in its
// own worker. Trainer mode grades each move once it is made (a badge from Best down to Blunder, by the
// points of expected final lead it gives up) and gives advice on request; study mode also shows the
// values while the player decides. The game's grades add up to a verdict on the results card.
// Fair play: the coach stays off (locked) whenever more than one person is at the table.
import { TERRAIN_INFO, footprint } from '../core/rules.js';
import { analysePosition } from '../core/search/expert.js';
import { judge, tally, GRADES } from '../core/coach.js';

const NOW = '#ffd36a', EXPERT = '#6fe3ff';
const cls = (grade) => `g-${grade.toLowerCase()}`;
const loss = (v) => (v.grade === 'Best' ? 'Best' : `−${v.loss.toFixed(1)}`);
// Inaccuracy or worse: worth showing what the Expert would have done
const poor = (grade) => GRADES.findIndex(([, g]) => g === grade) >= 3;

// A small map of the part of a kingdom that matters: its squares and the marked dominoes, one square
// of margin around them. marks: [{ domino, at: { x, y, rot }, color }]
function miniMap(k, marks) {
  const cells = [...k.cells.keys()].map((key) => key.split(',').map(Number));
  for (const { at } of marks) cells.push(...footprint(at.x, at.y, at.rot));
  const r = k.allowedRect();
  const x0 = Math.max(r.x0, Math.min(...cells.map((c) => c[0])) - 1), x1 = Math.min(r.x1, Math.max(...cells.map((c) => c[0])) + 1);
  const y0 = Math.max(r.y0, Math.min(...cells.map((c) => c[1])) - 1), y1 = Math.min(r.y1, Math.max(...cells.map((c) => c[1])) + 1);
  const S = 14, w = (x1 - x0 + 1) * S, h = (y1 - y0 + 1) * S;
  const sq = (x, y, fill, extra = '') => `<rect x="${(x - x0) * S + 1}" y="${(y - y0) * S + 1}" width="${S - 2}" height="${S - 2}" rx="2.5" fill="${fill}"${extra}/>`;
  let out = '';
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = k.get(x, y);
      out += !c ? sq(x, y, 'rgba(255,255,255,0.06)')
        : c.terrain === 'castle' ? sq(x, y, '#d9cfb8', ' stroke="#f0c75e" stroke-width="1.5"') : sq(x, y, TERRAIN_INFO[c.terrain].color);
    }
  }
  for (const { domino, at, color } of marks) {
    footprint(at.x, at.y, at.rot).forEach(([x, y], i) => { out += sq(x, y, TERRAIN_INFO[domino.squares[i].terrain].color, ` stroke="${color}" stroke-width="2.5"`); });
  }
  return `<svg class="tt-map" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${out}</svg>`;
}

export class Coach {
  constructor(ctl) {
    this.ctl = ctl;
    this.log = []; // this game's grades: { grade, loss, hinted }
    this.pending = new Set(); // grades still waiting for their analysis
    this.locked = false;
  }

  get on() { return !this.ctl.demo && !this.locked && this.ctl.settings.coach !== 'off'; }
  get study() { return this.on && this.ctl.settings.coach === 'study'; }

  reset() { this.log = []; this.pending.clear(); }

  // A decision by player p begins ('open', 'pick' or 'place' for this king, with `choices` options).
  // Returns the job the move will be judged by, or null when there is nothing to judge.
  begin(p, phase, king, choices, domino = null) {
    if (!this.on || choices < 2) return null;
    const c = this.ctl;
    const job = { p, phase, domino, slots: c.next.slice(), flow: c.flow, hinted: false, result: null };
    job.ready = analysePosition(c.tableFor(phase, king)).then((r) => (job.result = r), () => null);
    job.ready.then(() => { if (c.mode && c.mode.coach === job) c.coachReady(c.mode); });
    c.hud.setAdvice('thinking');
    return job;
  }

  // The move is made (a slot index, or a placement or null). Once the analysis is in (and after
  // `delay` ms, for the domino to land), its grade pops up at `anchor`; after a poor move the table
  // shows what the Expert would have done.
  judge(job, move, anchor, delay = 0) {
    if (!job) return;
    const p = this.grade(job, move, anchor, delay).catch((e) => console.warn('[coach]', e));
    this.pending.add(p);
    p.then(() => this.pending.delete(p));
  }

  // Resolves once every move made so far has its grade (or never will).
  settled() { return Promise.all([...this.pending]); }

  async grade(job, move, anchor, delay) {
    const c = this.ctl, t0 = performance.now();
    const r = await job.ready;
    if (delay) await c.tw.wait(delay);
    if (!r || !job.flow.alive || job.flow !== c.flow) return;
    const v = judge(r, move, job.domino);
    if (!v) return;
    this.log.push({ grade: v.grade, loss: v.loss, hinted: job.hinted });
    c.saveProgress();
    if (performance.now() - t0 < 1500 + delay) {
      c.popup(anchor, `<div class="grade-badge ${cls(v.grade)}"><b>${v.grade}</b>${v.grade === 'Best' ? '' : `<span>${loss(v)}</span>`}</div>`, 'popup grade-pop', 2600);
    } else {
      // a late verdict: the camera has moved on, so it comes as a small note instead
      c.hud.toast(`<span class="grade ${cls(v.grade)}">${v.grade}</span>${v.grade === 'Best' ? '' : ` ${loss(v)}`}`, 2.2);
    }
    if (!poor(v.grade)) return;
    if (job.phase === 'place') { if (v.best.move) c.flashSpot(job.p, v.best.move); } else c.flashSlot(job.slots[v.best.move]);
  }

  // Advice for the decision in progress: the Expert's move, shown on the table.
  async advise() {
    const c = this.ctl, m = c.mode, job = m && m.coach;
    if (!job) {
      if (m && this.locked) c.hud.toast('The coach is off while several people play');
      else if (m && !this.on) c.hud.toast('Turn the coach on in Settings');
      return;
    }
    job.hinted = true;
    const r = await job.ready;
    if (r && c.mode === m) c.showAdvice(m, r.moves[0].move);
  }

  // The label beside a draft domino: "Expert" once advised, its value in study mode, else nothing.
  slotLabel(m, slot) {
    if (m.advised === slot) return '<span class="cv expert">Expert</span>';
    const r = this.study && m.coach && m.coach.result;
    const v = r && judge(r, slot.index);
    return v ? `<span class="cv ${cls(v.grade)}">${loss(v)}</span>` : '';
  }

  // The ghost domino's pill: "Expert" on the advised spot, the spot's value in study mode.
  placeNote(m) {
    if (m.advisedKey === `${m.cell.x},${m.cell.y},${m.rot}`) return ' <span class="cv expert">Expert</span>';
    const r = this.study && m.coach && m.coach.result;
    const v = r && judge(r, { x: m.cell.x, y: m.cell.y, rot: m.rot }, m.domino);
    return v ? ` <span class="cv ${cls(v.grade)}">${loss(v)}</span>` : '';
  }

  // How good each legal spot is, for study mode's tinted hint squares: the grade of the best
  // placement (in the current rotation) covering each square. Null until the analysis is in.
  spotGrades(m) {
    const r = this.study && m.coach && m.coach.result;
    if (!r) return null;
    const best = new Map();
    for (const v of m.valid) {
      if (v.rot !== m.rot) continue;
      const j = judge(r, v, m.domino);
      if (!j) continue;
      for (const [x, y] of footprint(v.x, v.y, v.rot)) {
        const k = `${x},${y}`, was = best.get(k);
        if (!was || j.loss < was.loss) best.set(k, j);
      }
    }
    return new Map([...best].map(([k, j]) => [k, j.grade]));
  }

  // The hovered draft domino's tooltip extras: a map of the kingdom with the most points it could
  // score right now and, in study mode, where the Expert would lay it.
  slotNote(m, slot) {
    if (!this.on) return '';
    const c = this.ctl, k = m.player.kingdom, domino = slot.domino;
    m.nowCache ||= new Map();
    if (!m.nowCache.has(domino.id)) {
      const before = k.score(c.opts).total;
      let top = null;
      for (const v of k.validPlacements(domino)) {
        const t = k.clone();
        t.place(domino, v.x, v.y, v.rot);
        const gain = t.score(c.opts).total - before;
        if (!top || gain > top.gain) top = { at: v, gain };
      }
      m.nowCache.set(domino.id, top);
    }
    const top = m.nowCache.get(domino.id);
    if (!top) return '<div class="tt-coach warn">Fits nowhere in your kingdom</div>';
    const marks = [], legend = [];
    if (top.gain > 0) {
      marks.push({ domino, at: top.at, color: NOW });
      legend.push(`<span><i style="background:${NOW}"></i>+${top.gain} now</span>`);
    }
    const r = this.study && m.coach && m.coach.result;
    const v = r && judge(r, slot.index);
    if (v && v.stats.land) {
      marks.push({ domino, at: v.stats.land, color: EXPERT });
      legend.push(`<span><i style="background:${EXPERT}"></i>Expert</span>`);
    }
    if (!marks.length) return '';
    return `<div class="tt-coach">${miniMap(k, marks)}<div class="tt-legend">${legend.join('')}</div></div>`;
  }

  // The results card's verdict: points lost per move, and how the grades split.
  summary() {
    if (!this.log.length) return '';
    const t = tally(this.log);
    const grades = GRADES.map(([, g]) => g).filter((g) => t.counts[g]);
    const bar = grades.map((g) => `<i class="${cls(g)}" style="flex:${t.counts[g]}"></i>`).join('');
    const legend = grades.map((g) => `<span class="${cls(g)}"><b>${t.counts[g]}</b> ${g}</span>`).join('');
    const hints = t.hints ? `<span class="v-hints">${t.hints} hint${t.hints === 1 ? '' : 's'}</span>` : '';
    return `<h3>The coach’s verdict</h3><div class="verdict">
      <div class="v-num"><b>${t.loss.toFixed(1)}</b><span>points lost<br>per move</span></div>
      <div class="v-body"><div class="v-bar">${bar}</div><div class="v-legend">${legend}${hints}</div></div></div>`;
  }
}
