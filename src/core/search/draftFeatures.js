// Cheap phase-aware features for drafting a domino. Only numeric arrays are needed for training;
// production evaluator will inline exactly the selected features to avoid allocations.
import { DOM, INIT } from './engine.js';
export const DRAFT_FEATURES = Object.freeze([
  'baseline', 'slot', 'crowns', 'number', 'same', 'crownsBoth',
  'ownCrowns', 'ownTerrain', 'crownOnOwnTerrain', 'extendCrowned',
  'lateSlot', 'lateOwnCrowns', 'slotCrowns',
]);
export function draftFeatureVector(st, slot) {
  const b = st.boards[st.player];
  const line = st.phase === INIT ? st.line : st.nextLine;
  const d = line[slot];
  const ta = DOM[4 * d], ca = DOM[4 * d + 1], tb = DOM[4 * d + 2], cb = DOM[4 * d + 3];
  const crowns = ca + cb, stage = b.placed / 12;
  const ownCrowns = b.crowns[ta] + b.crowns[tb];
  return [
    b.pickEval(d) - 0.05 * slot, slot, crowns, d / 47, +(ta === tb), ca * cb,
    ownCrowns, b.terr[ta] + b.terr[tb], ca * b.terr[ta] + cb * b.terr[tb],
    (ca ? 0 : b.crowns[ta]) + (cb ? 0 : b.crowns[tb]),
    slot * stage, ownCrowns * stage, slot * crowns,
  ];
}
