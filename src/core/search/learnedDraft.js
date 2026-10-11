// Experimental middle-game drafting model trained with equal-budget MCTS labels.
// The model is NOT used by the shipped Expert unless passed explicitly to Search.
// Coefficients from scripts/train-draft.js; 160 train games / 40 held-out games.
// Eval outside the middle draft (4 <= placed < 8) deliberately falls back to
// the exact original priority. This phase gate was chosen from stage-wise holdout.
import { DOM, INIT } from './engine.js';

export const DRAFT_WEIGHTS = Object.freeze({
  baseline: 0.6865604702048589,
  slot: -0.2667728592923154,
  ownCrowns: -0.10105954831835284,
  ownTerrain: 0.024102160460703057,
  crownOnOwnTerrain: 0.506893418062891,
  lateSlot: -0.2279330157939041,
});

export function learnedDraftEval(st, slot) {
  const b = st.boards[st.player];
  const line = st.phase === INIT ? st.line : st.nextLine;
  const d = line[slot];
  const baseline = b.pickEval(d) - 0.05 * slot;
  if (b.placed < 4 || b.placed >= 8) return baseline;

  const a = 4 * d, ta = DOM[a], ca = DOM[a+1], tb = DOM[a+2], cb = DOM[a+3];
  const ownCrowns = b.crowns[ta] + b.crowns[tb];
  const ownTerrain = b.terr[ta] + b.terr[tb];
  const crownOnOwnTerrain = ca * b.terr[ta] + cb * b.terr[tb];
  return DRAFT_WEIGHTS.baseline * baseline +
    DRAFT_WEIGHTS.slot * slot +
    DRAFT_WEIGHTS.ownCrowns * ownCrowns +
    DRAFT_WEIGHTS.ownTerrain * ownTerrain +
    DRAFT_WEIGHTS.crownOnOwnTerrain * crownOnOwnTerrain +
    DRAFT_WEIGHTS.lateSlot * slot * (b.placed / 12);
}
