# Neural self-play experiments — outcomes and scaling, 2026-10-11

**Status: opt-in research, not validated as stronger than the existing Expert.**

We moved beyond the previous manually designed 6–9-feature regression
scorers toward a learned raw-board policy/value model and iterative
search-and-training. This is a first step toward more compute-scalable
methods, **not** a full AlphaZero or MuZero implementation.

## System implemented

- Two-player Kingdomino 5x5, all four combinations of Middle Kingdom and
  Harmony scoring.
- Input is 355 normalized floats including both players' raw 9x9
  terrain/crown grids, four visible dominoes, legal draft mask and game
  flags; the learned network does not use handcrafted crown–terrain
  synergy features.
- Small fully connected CPU network (355→64→64→5), roughly 27k
  parameters, with a four-way draft policy head and a value head.
- Data come from complete MCTS-generated self-play games. Supervision
  is the **search visit distribution** for the draft policy and actual
  win/tie/loss terminal result for the value head.
- D4 spatial symmetry augmentation, cross-entropy plus value regression,
  Adam optimizer, disjoint-game validation.
- The policy affects PUCT expansion at actual visible **draft roots**;
  the original placement policy and full-game MCTS rollouts remain in
  place. The value head is **not currently used by MCTS to truncate
  rollouts**.
- Production Expert and coach remain unchanged; all neural capabilities
  are opt-in.

## Iterations

| Experiment | Training games | Training draft observations | Independent validation observations | Self-play draft simulations |
| --- | ---: | ---: | ---: | ---: |
| Iteration 0, initial unguided self-play | 160 | 2,880 | 720 | 256 |
| Iteration 1, replay of generations 0+1 | 320 total | 5,760 | 1,440 | 256 |
| Iteration 2, scaled three-generation replay | 960 total | **17,280** | **4,320** | **1,024 for the new generation** |

The iteration-2 weights were pretrained from iteration 1 and fine-tuned
on all three self-play generations. Training and validation game seeds
are disjoint. Input augmentation applies only to training.

Search-policy top-choice alignment on the respective validation datasets:
**57.9%** for iteration 0, **63.5%** for iteration 1, and
**66.3%** for iteration 2. These are different validation datasets;
the values are not a head-to-head comparison of predictive ability.

## Real-budget head-to-head results

Every random deal was played twice with player seats swapped, against
the **original Expert** using a maximum of 3,000 MCTS simulations and
1,500 milliseconds per decision. Distinct test seed ranges were used
for each independent confirmation. The confidence intervals are normal
approximations based on paired-deal mean score margins, not on games as
independent observations.

| Model / experiment | Independent paired deals | Neural wins | Expert wins | Score draws | Neural mean margin | Approx. 95% CI |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Iteration 0 exploratory | 400 | 389 | 378 | 33 | +0.16 | [−0.33, +0.65] |
| Iteration 1 exploratory, selected afterwards | 400 | 403 | 343 | 54 | +0.52 | [+0.03, +1.00] |
| **Iteration 1, preselected independent confirmation** | **800** | **789** | **731** | **80** | **+0.174** | **[−0.173, +0.521]** |
| **Iteration 2, further scaled independent arena** | **800** | **782** | **736** | **82** | **−0.002** | **[−0.356, +0.353]** |

### Scaled iteration 2 by rule configuration

| Rules | 200 paired deals / 400 games, neural / Expert wins (score ties) | Mean neural margin | Approx. 95% CI |
| --- | --- | ---: | --- |
| No bonuses | 191 / 176 (33) | +0.093 | [−0.55, +0.73] |
| Middle Kingdom | 195 / 183 (22) | +0.148 | [−0.52, +0.82] |
| Harmony | 199 / 185 (16) | −0.028 | [−0.75, +0.69] |
| Both bonuses | 197 / 192 (11) | −0.220 | [−1.02, +0.58] |

The apparent improvement for iteration 1 in the exploratory round did
**not** survive a preselected independent comparison. Iteration 2 trained
on more than three times as many examples and increased training-search
simulations fourfold but showed no measurable score advantage. The
iteration 1 and 2 arenas also use different seed ranges, so their
difference should not be interpreted as a statistically controlled
regression caused by more data.

**Decision:** do not enable a neural scorer in the default Expert.
The absence of statistical proof is not evidence of strict equivalence,
but the confidence intervals do not establish that any of these neural
models is better under production search budgets.

## How to inspect and reproduce

- [Two-generation self-play, model checkpoints and exploratory arena](https://github.com/1amthis/kingdomino-3d/actions/runs/38119620310)
- [Frozen iteration 1 confirmation (1,600 new games)](https://github.com/1amthis/kingdomino-3d/actions/runs/38119852438)
- [Third-generation scaled training and arena (1,600 new games)](https://github.com/1amthis/kingdomino-3d/actions/runs/38120150232)
- [Model training and arena scripts](../scripts/neural/)
- [Neural self-play base workflow](../.github/workflows/neural-selfplay.yml)
- [Scaled self-play and evaluation workflow](../.github/workflows/neural-scale.yml)

All runs save their own model checkpoints, training reports, and
per-paired-deal margins to GitHub Actions artifacts. Artifacts have
finite retention periods, so preserve them if undertaking follow-up
experiments.

## What scaling taught us

The *Bitter Lesson* favors algorithms that can exploit increasing
compute, **not blindly running more simulations with an inappropriate
objective or limited search integration**.

The current system learns a relatively narrow *draft* policy from
noisy MCTS visits. The value head does not substitute for expensive
rollouts, while the 355-value input gives numeric terrain identifiers
to a dense MLP and the full high-branching placement decision is not
learned. Thus adding data to this small model may improve teacher
imitation while leaving true game strength unchanged.

To pursue the full compute-scaling route, the next version should
invest in a **spatial CNN/residual policy-value architecture**, explicit
legal masks for all *placement* and *draft* actions, and an
imperfect-information-aware MCTS that actually **uses learned value
estimates at leaf nodes** when well calibrated. This requires
significantly more training throughput (ideally GPUs), a sustained
replay-buffer/self-play loop, and a strictly frozen arena promotion gate.
No such larger architecture is claimed to have been trained in this PR.
