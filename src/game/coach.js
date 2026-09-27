// The coach at the table: while a player at this screen decides, the Expert quietly analyses the
// position in its own worker. Trainer mode grades each move once it is made (Best down to Blunder, by
// the points of expected final lead it gives up) and gives advice on request; study mode also shows the
// values while the player decides. The game's grades add up to a summary on the results card.
import { TERRAIN_INFO, footprint } from '../core/rules.js';
import { analysePosition } from '../core/search/expert.js';
import { judge, tally, GRADES } from '../core/coach.js';
import { esc } from '../ui/hud.js';

const pts = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
const chip = (grade) => `<span class="grade g-${grade.toLowerCase()}">${grade}</span>`;
const NOW = '#ffd36a', EXPERT = '#6fe3ff';

// A small map of a kingdom's still-reachable rectangle, with dominoes drawn on it: marks are
// { domino, at: { x, y, rot }, color }.
function miniMap(k, marks) {
  const r = k.allowedRect(), S = 11;
  const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
  const cell = (x, y, fill, extra = '') => `<rect x="${(x - r.x0) * S + 1}" y="${(y - r.y0) * S + 1}" width="${S - 2}" height="${S - 2}" rx="2" fill="${fill}"${extra}/>`;
  let out = '';
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const c = k.get(x, y);
      out += cell(x, y, c ? TERRAIN_INFO[c.terrain].color : 'rgba(255,255,255,0.07)');
    }
  }
  for (const { domino, at, color } of marks) {
    footprint(at.x, at.y, at.rot).forEach(([x, y], i) => {
      out += cell(x, y, TERRAIN_INFO[domino.squares[i].terrain].color, ` stroke="${color}" stroke-width="2"`);
    });
  }
  return `<svg class="tt-map" width="${w * S}" height="${h * S}" viewBox="0 0 ${w * S} ${h * S}">${out}</svg>`;
}

export class Coach {
  constructor(ctl) {
    this.ctl = ctl;
    this.log = new Map(); // player → [{ grade, loss, hinted }] this game
  }

  get on() { return !this.ctl.demo && this.ctl.settings.coach !== 'off'; }
  get study() { return this.on && this.ctl.settings.coach === 'study'; }

  reset() { this.log = new Map(); }

  // A decision by player p begins ('open', 'pick' or 'place' for this king, with `choices` options).
  // Returns the job the move will be judged by, or null when there is nothing to judge.
  begin(p, phase, king, choices, domino = null) {
    if (!this.on || choices < 2) return null;
    const c = this.ctl;
    const job = { p, phase, domino, line: c.next.map((s) => s.domino), flow: c.flow, hinted: false, result: null };
    job.ready = analysePosition(c.tableFor(phase, king)).then((r) => (job.result = r), () => null);
    return job;
  }

  // The move is made (a slot index, or a placement or null): its grade shows once the analysis is in.
  async judge(job, move) {
    if (!job) return;
    const r = await job.ready;
    if (!r || !job.flow.alive || job.flow !== this.ctl.flow) return;
    const v = judge(r, move, job.domino);
    if (!v) return;
    if (!this.log.has(job.p)) this.log.set(job.p, []);
    this.log.get(job.p).push({ grade: v.grade, loss: v.loss, hinted: job.hinted });
    const hud = this.ctl.hud;
    const who = this.ctl.humans.length > 1 ? `${hud.who(job.p)} · ` : '';
    let text = v.grade === 'Best' && v.loss === 0 ? 'The Expert’s choice too' : `${v.loss.toFixed(1)} points behind the Expert’s choice`;
    if (v.grade !== 'Best' && job.phase !== 'place') text += `, domino ${job.line[v.best.move].id}`;
    hud.toast(`${who}${chip(v.grade)} ${text}`, 3);
  }

  // Advice for the decision in progress: the Expert's move, shown on the table.
  async advise() {
    const c = this.ctl, m = c.mode, job = m && m.coach;
    if (!job) {
      if (!this.on && m) c.hud.toast('Turn the coach on in Settings to get advice.');
      return;
    }
    job.hinted = true;
    if (!job.result) c.hud.toast('The coach is thinking…', 1.4);
    const r = await job.ready;
    if (!r || c.mode !== m) return;
    const best = r.moves[0];
    c.showAdvice(m, best.move);
    const what = job.phase === 'place' ? 'The Expert would lay it here' : `The Expert would take domino ${job.line[best.move].id}`;
    c.hud.toast(`${what} · expected lead ${pts(best.ev)}`, 2.6);
  }

  // Extra tooltip lines for a domino hovered in the draft: the most points it could score right now,
  // on a map of the kingdom, and in study mode the Expert's view of the pick and where it would lay it.
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
    if (!top) return '<div class="tt-row tt-coach warn">Fits nowhere in your kingdom right now</div>';
    // (when nothing scores yet, any spot is as good as another: no point outlining one)
    const marks = top.gain > 0 ? [{ domino, at: top.at, color: NOW }] : [];
    let lines = top.gain > 0 ? `<div class="tt-row tt-coach"><span class="dot" style="background:${NOW}"></span>Most points now: +${top.gain}</div>`
      : '<div class="tt-row tt-coach dim">Scores nothing right away</div>';
    if (this.study && m.coach) {
      const r = m.coach.result;
      const v = r && judge(r, slot.index);
      if (!r) lines += '<div class="tt-row tt-coach dim">The coach is thinking…</div>';
      else if (v) {
        lines += `<div class="tt-row tt-coach">${chip(v.grade)} lead ${pts(v.stats.ev)} · wins ${Math.round(v.stats.win * 100)}%</div>`;
        if (v.stats.land) {
          marks.push({ domino, at: v.stats.land, color: EXPERT });
          lines += `<div class="tt-row tt-coach"><span class="dot" style="background:${EXPERT}"></span>Where the Expert would lay it</div>`;
        }
      }
    }
    return lines + miniMap(k, marks);
  }

  // Study mode's note on the ghost domino: what this spot gives up against the Expert's.
  placeNote(m) {
    const r = this.study && m.coach && m.coach.result;
    const v = r && judge(r, { x: m.cell.x, y: m.cell.y, rot: m.rot }, m.domino);
    if (!v) return '';
    return ` <span class="coach-note g-${v.grade.toLowerCase()}">${v.grade === 'Best' ? 'best' : `−${v.loss.toFixed(1)}`}</span>`;
  }

  // The results card's section: each local player's points lost per decision and grade counts.
  summary() {
    const rows = [];
    for (const p of this.ctl.humans) {
      const records = this.log.get(p);
      if (!records || !records.length) continue;
      const t = tally(records);
      const counts = GRADES.map(([, g]) => g).filter((g) => t.counts[g]).map((g) => `<span class="grade g-${g.toLowerCase()}">${t.counts[g]} ${g}</span>`).join('');
      const hints = t.hints ? ` · ${t.hints} piece${t.hints === 1 ? '' : 's'} of advice` : '';
      rows.push(`<div class="coach-row"><div><b style="color:${p.color}">${esc(p.name)}</b> lost <b>${t.loss.toFixed(1)}</b> points per decision
        <span class="dim">over ${t.decisions} decisions${hints}</span></div><div class="coach-grades">${counts}</div></div>`);
    }
    return rows.length ? `<h3>The coach’s verdict</h3>${rows.join('')}` : '';
  }
}
