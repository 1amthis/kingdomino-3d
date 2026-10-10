// The coach's review, run from the history window: one position at a time through the coach's worker
// (the analysis it runs during a game), each grade saved into the game's record as it lands, so a review
// stopped halfway carries on from there.
import { analysePosition } from '../core/search/expert.js';
import { replayRecord } from '../core/replay.js';
import { reviewPlan, markMove, reviewVerdicts } from '../core/review.js';
import { t } from '../i18n/index.js';

export class ReviewRunner {
  // log: the GameLog the records live in; onChange(record, progress): after each grade, and at the end
  constructor(log, onChange) {
    this.log = log;
    this.onChange = onChange;
    this.job = null; // { id, done, total, alive }
  }

  // How far the review of this game has got, if it is running: { done, total }.
  progress(id) { return this.job && this.job.id === id ? { done: this.job.done, total: this.job.total } : null; }

  stop() {
    if (this.job) this.job.alive = false;
    this.job = null;
  }

  async run(id) {
    this.stop();
    const job = this.job = { id, done: 0, total: 0, alive: true };
    const find = () => this.log.all().find((g) => g.id === id);
    let r = find();
    if (!r) { this.finish(job, null); return; }
    let turns, plan;
    try {
      ({ turns } = replayRecord(r, { positions: true }));
      plan = reviewPlan(r, turns);
    } catch (e) {
      console.warn('[review]', e.message);
      this.finish(job, r, t('This game cannot be replayed, so the coach cannot review it.'));
      return;
    }
    const review = { ...(r.review || {}) };
    job.total = plan.length;
    job.done = plan.filter((k) => k in review).length;
    this.onChange(r);
    for (const k of plan) {
      if (k in review) continue;
      let analysis;
      try { analysis = await analysePosition(turns[k].table); } catch (e) {
        console.warn('[review]', e.message || e);
        if (job.alive) this.finish(job, r, t('The coach could not run in this browser.'));
        return;
      }
      if (!job.alive) return;
      review[k] = markMove(analysis, turns[k]);
      job.done++;
      // (read afresh: the record may have changed since, in another tab, or left with a cleared history)
      const now = find();
      if (!now) { this.finish(job, null); return; }
      r = { ...now, review: { ...review } };
      this.log.save(r);
      if (job.done < job.total) this.onChange(r);
    }
    // every move graded: each person's verdict joins their seat, for the stats
    const verdicts = reviewVerdicts(r, plan, turns);
    r = { ...r, players: r.players.map((p, i) => (verdicts[i] ? { ...p, verdict: verdicts[i] } : p)) };
    this.log.save(r);
    this.finish(job, r);
  }

  finish(job, r, error = null) {
    if (this.job === job) this.job = null;
    this.onChange(r, error);
  }
}
