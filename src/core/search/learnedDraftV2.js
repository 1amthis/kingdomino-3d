// Draft V2: stronger 128-sample MCTS teacher across mixed Expert trajectories and bonus rules.
// Exploratory phase selection based on 60 validation games; not production-enabled.
// Opening: original scorer. Middle (placed 4–7): retain V1 to avoid validation regression.
// Early & late draft: compact model trained on 960 states / 2879 draft choices.
// Train labels and full coefficient report: scripts/train-draft-v2.js (GitHub Actions artifact).
import { DOM, INIT } from './engine.js';
import { learnedDraftEval } from './learnedDraft.js';

export const V2_DRAFT_WEIGHTS = Object.freeze({
  baseline: 0.4488233298729819,
  slot: -0.36732619905372244,
  crowns: 0.8265761755856618,
  ownCrowns: 0.061034576084028104,
  ownTerrain: 0.061299887100270185,
  crownOnOwnTerrain: 0.507185824151664,
  lateSlot: 0.028480284322588558,
  ownCrownSynergy: -0.17405869035051147,
  unownedTerrains: 0.1438957090718555,
});

// Function signature consumed by new Search({draftTreeEval:learnedDraftV2}).
// No temporary arrays / allocations inside MCTS expansion.
export function learnedDraftV2(st, slot) {
  const b = st.boards[st.player], stage = b.placed;
  if (stage >= 4 && stage < 8) return learnedDraftEval(st, slot);
  const line = st.phase === INIT ? st.line : st.nextLine;
  const d = line[slot];
  const baseline = b.pickEval(d) - 0.05 * slot;
  if (st.phase === INIT || stage === 0) return baseline;
  const i = 4 * d, ta = DOM[i], tb = DOM[i + 2],
    ca = DOM[i + 1], cb = DOM[i + 3];
  const w = V2_DRAFT_WEIGHTS;
  return w.baseline * baseline + w.slot * slot + w.crowns * (ca + cb) +
    w.ownCrowns * (b.crowns[ta] + b.crowns[tb]) +
    w.ownTerrain * (b.terr[ta] + b.terr[tb]) +
    w.crownOnOwnTerrain * (ca * b.terr[ta] + cb * b.terr[tb]) +
    w.lateSlot * slot * (stage / 12) +
    w.ownCrownSynergy * (ca * b.crowns[ta] + cb * b.crowns[tb]) +
    w.unownedTerrains * ((b.terr[ta] === 0 ? 1 : 0) +
      (ta !== tb && b.terr[tb] === 0 ? 1 : 0));
}
