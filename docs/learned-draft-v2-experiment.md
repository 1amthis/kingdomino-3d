# Draft V2 — stronger teacher, diversified states, independent matches

**2026-10-11. Status: inconclusive; do not enable in production.**
This experiment continues [the V1 draft study](./learned-draft-experiment.md)
without changing the browser Expert, search worker, or coach.

## Training and selection

- Training: 240 complete 2-player games, **960 draft positions** and 2,879
  labelled options, game seeds 60000–60239.
- Validation: 60 disjoint complete games, **240 draft positions** and 735
  labelled options, seeds 70000–70059.
- Rules diversified deterministically across no bonus, Middle Kingdom,
  Harmony, and both bonuses. Trajectory types include original MCTS Expert,
  exploratory random legal decisions, and V1-guided Expert.
- Every legal draft choice has **128 complete-game MCTS teacher simulations**,
  four times the V1 teacher's 32, with 48 MCTS simulations per trajectory
  decision when not randomly exploring.
- Labels are expected **terminal score margins** from the same compact engine;
  ridge regression centers the features and labels *within each choice set*.
- Candidate model V2Small uses nine cheap features, optimized to have
  no allocations when called by MCTS.
- Validation regret for V2Small on all phases: **0.857 point**, versus
  **0.955** for V1 and **1.074** for the original heuristic.
- V1 still performed better in middle-game draft on this validation:
  V1 **0.734** versus V2Small **0.790**. The hybrid uses V1 for
  4–7 placed dominoes and V2Small for early/late draft, retaining original
  draft ranking in the opening (zero placements).

Model selection and phase gating were done *after inspecting the validation
data*. That validation set is therefore exploratory and must not be cited
as an independent proof of improvement.

Run reproducible teacher training on GitHub Actions:
[Strong Draft Teacher Training, run #38118840706](https://github.com/1amthis/kingdomino-3d/actions/runs/38118840706).
The full coefficient/validation report and label shards are artifacts.
The model is implemented in `src/core/search/learnedDraftV2.js`.

## Out-of-sample head-to-head

[GitHub Actions benchmark #38118953372](https://github.com/1amthis/kingdomino-3d/actions/runs/38118953372)
completed successfully and produced
[all eight JSON reports](https://github.com/1amthis/kingdomino-3d/actions/runs/38118953372/artifacts/11693858365).

- 2 players, 5×5, 4 scoring-rule combinations
- 2 separate opponents: original Expert, learned draft V1
- 200 independent deals per rule configuration and opponent
- Each deal is played twice with swapped seats
- **800 paired deals / 1,600 games per opponent; 3,200 games total**
- 3,000 MCTS simulations maximum and 1,500 ms maximum per decision;
  no use of the learned model during full-game rollouts (MCTS
  tree draft-action ordering only)
- Match seed ranges are disjoint from model training, model validation and
  from all earlier benchmarks. The comparators also use disjoint ranges.

| Rules | Opponent | V2 wins | Opponent wins | Draws | V2 mean point margin | Approx. paired 95% CI |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| No bonuses | Original | 201 | 185 | 14 | +0.610 | [−0.095, +1.315] |
| Middle Kingdom | Original | 169 | 213 | 18 | **−0.963** | **[−1.684, −0.241]** |
| Harmony | Original | 197 | 184 | 19 | +0.520 | [−0.180, +1.220] |
| Both bonuses | Original | 194 | 186 | 20 | +0.690 | [−0.116, +1.496] |
| No bonuses | V1 | 194 | 186 | 20 | −0.088 | [−0.781, +0.605] |
| Middle Kingdom | V1 | 187 | 190 | 23 | −0.110 | [−0.847, +0.627] |
| Harmony | V1 | 194 | 183 | 23 | +0.435 | [−0.246, +1.116] |
| Both bonuses | V1 | 194 | 194 | 12 | +0.163 | [−0.548, +0.873] |

**Pooled across the four rule configurations, for each opponent separately**:

| Comparison | Deals / games | V2 W / L / D | V2 mean margin | Approx. paired 95% CI |
| --- | --- | --- | ---: | --- |
| V2 vs original | 800 / 1600 | 761 / 768 / 71 | +0.214 | [−0.155, +0.584] |
| V2 vs V1 | 800 / 1600 | 769 / 753 / 78 | +0.100 | [−0.253, +0.453] |

No pooled confidence interval excludes zero. The negative Middle Kingdom
result versus original is concerning; since eight comparisons were inspected,
do not overinterpret one interval without a separate independently seeded
confirmation or multiplicity adjustment.

The per-case mean can differ because match seed ranges are different; the
pooled estimate deliberately gives **equal weight to each of the four
rule configurations**, not to their prevalence in actual player games.

## Interpretation and decision

Making the MCTS teacher stronger and diversifying trajectories improved
agreement with noisy final-margin labels, **but did not establish a strength
improvement**. This challenges using teacher *score margin* as the sole
learning objective for a search policy whose decision reward is mostly
win/loss.

V2 is **optional only**, via
`new Search({draftTreeEval: learnedDraftV2})`. It is *not* imported by the
shipping browser worker, and no default MCTS parameters are changed.

**Do not merge V2 as a stronger Expert.** A useful next experiment should
prioritize an outcome-aligned ranking target (win-rate or the same clipped
win-heavy MCTS terminal reward), or a direct computationally budgeted
policy improvement with an independent win-rate holdout. A rule-specific
teacher/model for Middle Kingdom may be worth testing, but not without
a fresh holdout.
