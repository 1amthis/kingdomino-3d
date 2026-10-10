// Experimental, allocation-free evaluation learned from MCTS-labelled placements.
// NOT enabled in the shipped Expert; opt into it when constructing Search.
// 300 training positions / 3,077 actions; 60 independent validation positions.
import { DOM } from './engine.js';

// Regression coefficients fitted to the expected final score margin of each move
// (demeaned within each decision). Model selection used the held-out positions.
export const LEARNED_WEIGHTS = Object.freeze({
  quick: 0.7976857156446254,
  match: 0.4702991273355566,
  lone: -1.7885195497993351,
  grow: 0.41046381821440536,
  touch: 0.13814316191203257,
  growlate: -0.6339335679558872,
});

// Called with `this` set to a Board, for example:
//   new Search({ placementEval: fastLearnedEval })
// Fuses two passes over the original quickEval's 8 neighbours into one
// feature-extraction pass. No Sets, clones, or temporary arrays in rollouts.
export function fastLearnedEval(move, d) {
  const { t, c, g } = this;
  const { step, col, row } = g;
  const a = move >> 8, b = move & 255;
  const ta = DOM[4 * d], tb = DOM[4 * d + 2];
  const ca = DOM[4 * d + 1], cb = DOM[4 * d + 3];

  let quick = 0, match = 0, touch = 0, lone = 0;
  let same = 0, near = 0, occ = 0;
  for (let k = 0; k < 4; k++) {
    const n = a + step[k], terrain = t[n];
    if (!terrain || terrain === 8) continue;
    occ++;
    if (terrain === ta) { same++; near += c[n]; }
  }
  quick += ca * (1 + same) + near + 0.15 * occ;
  match += same;
  touch += occ;
  if (ca && !same) lone++;

  same = 0; near = 0; occ = 0;
  for (let k = 0; k < 4; k++) {
    const n = b + step[k], terrain = t[n];
    if (!terrain || terrain === 8) continue;
    occ++;
    if (terrain === tb) { same++; near += c[n]; }
  }
  quick += cb * (1 + same) + near + 0.15 * occ;
  match += same;
  touch += occ;
  if (cb && !same) lone++;

  if (row[a] < this.y0 || row[b] < this.y0 || row[a] > this.y1 || row[b] > this.y1) quick -= 0.25;
  if (col[a] < this.x0 || col[b] < this.x0 || col[a] > this.x1 || col[b] > this.x1) quick -= 0.25;
  const grow =
    Math.max(this.x1, col[a], col[b]) - Math.min(this.x0, col[a], col[b]) +
    Math.max(this.y1, row[a], row[b]) - Math.min(this.y0, row[a], row[b]) -
    (this.x1 - this.x0 + this.y1 - this.y0);

  return LEARNED_WEIGHTS.quick * quick + LEARNED_WEIGHTS.match * match +
    LEARNED_WEIGHTS.lone * lone + LEARNED_WEIGHTS.grow * grow +
    LEARNED_WEIGHTS.touch * touch + LEARNED_WEIGHTS.growlate * grow * (this.placed / 12);
}
