# Massive spatial MCTS self-play — XL run

This branch is a **research-only** continuation of the full spatial neural
policy/value model in PR #36. The browser Expert is never changed.

## Compute and scope

Actual job: [Massive Full-Neural XL Self-Play and Arena](https://github.com/1amthis/kingdomino-3d/actions/runs/38128329283).
Smoke test: [48-channel inference and PyTorch→JS export](https://github.com/1amthis/kingdomino-3d/actions/runs/38128155386).

- CPU-only GitHub-hosted runners (no CUDA device available in the
  directly accessible execution environment).
- **144 sharded data generators**: 128 training × 32 games = 4,096 games;
  16 independent validation × 32 games = 512 games, across all four
  Middle Kingdom/Harmony configurations.
- Existing training replay: 608 games; validation replay: 128 games.
  Therefore **4,704 training games + 640 validation games = 5,344**
  whole self-play games, if every generator succeeds.
- New data uses **1,024 MCTS simulations per non-forced draft** and
  **512 simulations per non-forced placement** (higher search budget than
  earlier 384/192 generation), and 3/4 neural-guided trajectories
  from the previous checkpoint mixed with 1/4 unguided Expert trajectories.
- Outputs include the legal-action **MCTS visit distribution for every
  placement and draft** and signed terminal outcome for the actor.
  Data are stored as `shard.json.gz` with unique whole-game seeds.
  The PyTorch trainer can mix these with the previous uncompressed shards.
- Network: **48 convolution channels, four residual blocks, 64-wide
  auxiliary context**, full policy heads and tanh outcome value, trained
  from scratch on the expanded replay. A cold full-network root inference
  benchmark was **85.8 ms** on one GitHub Actions CPU runner; actual
  inference cost depends on hardware and warm-up.
- Training uses AdamW, game-separated validation, dihedral rotations
  with matching placement-action transforms, gradient clipping,
  24-epoch maximum, and an explicit **290-minute stop criterion**
  so the best checkpoint is exported even if the full epoch budget
  is not reached. GitHub's per-job cap is 360 minutes.

## Predeclared arena

The checkpoint will be frozen before evaluation. The arena uses
**three prespecified comparisons** across all four rule combinations,
each with **200 independent, seat-swapped paired deals per rule**:

1. Neural policy against the existing production Expert. This determines
   whether the actual deployed baseline is beaten.
2. Neural policy against a no-neural MCTS with equally uncapped legal
   placements. This isolates the benefit of learned priors from the
   effect of expanding the root legal-action set.
3. Neural policy + value on **1 in 512** eligible leaf expansions against
   production Expert. This separately evaluates the value-head tradeoff.

Total if every job completes: 3 × 4 × 200 × 2 = **4,800
completed games**, using disjoint seed ranges from any training or
validation games. The same deal seeds are deliberately reused across
comparison *modes*, so results across modes must never be treated as
independent. Each comparison's confidence interval is calculated on
800 **paired-deal** mean margins.

A positive selection among these three is **exploratory**. Before
promoting a winning variant, a second confirmation must use new
seeds and the checkpoint must remain unchanged. No automatic
deployment or merge into `main` occurs.

## Runtime constraints

The work is limited to GitHub Actions standard CPU runners, whose
actual scheduling concurrency is controlled by GitHub, not assumed
to equal the requested 24. This is a large experiment with finite
quotas and an explicit wall-clock training cap, not an unlimited
GPU training claim. If a training job fails due to resource exhaustion
or timeouts, inspect data and logs and do not report that it completed.

All result artifacts, weights, and game-level source labels are
attached to their GitHub Actions run (retention 45–90 days).


## Final results — 2026-10-11

The workflow [#38128329283](https://github.com/1amthis/kingdomino-3d/actions/runs/38128329283)
**completed successfully on 2026-10-11 at 10:52:36 UTC**.
All **242 jobs succeeded** (144 self-play, 1 training, 96 arena,
1 aggregation). The 144 data shards, model checkpoint and final
reports are retained as artifacts; the self-play archives may
expire sooner than the model.

### Training

| Metric | Actual |
| --- | ---: |
| Total self-play games, across 3 generations | 5,344 |
| Training games / independent validation games | 4,704 / 640 |
| Training decisions | 181,792 |
| Validation decisions | 24,704 |
| XL model parameters | 184,410 |
| Residual CNN | 48 channels, 4 blocks, 64 auxiliary units |
| Completed epochs / selected checkpoint | 24 / 22 |
| CPU training elapsed | 72.17 minutes |
| Held-out policy cross-entropy | 1.5284 |
| Held-out top MCTS-visit agreement | 47.87% |
| Held-out value MSE (signed terminal result) | 0.9399 |

The training finished all 24 epochs before reaching the
290-minute safety limit. These validation figures measure
**teacher imitation**, not win strength; prior generations used
different held-out positions, so validation accuracies across
runs are not directly comparable.

[Trained XL model & training report](https://github.com/1amthis/kingdomino-3d/actions/runs/38128329283/artifacts/11700355339).

### Completed independent arena: 4,800 games

Each of the three prespecified comparisons used 800 distinct
seed-swapped deals / 1,600 games at 3,000 MCTS simulations and
a 1,500 ms time cap. The same deals were reused deliberately
across comparisons, so do not treat all 4,800 games as independent.

| Experimental configuration | Model wins | Baseline wins | Score ties | Mean point margin | Approx. paired 95% CI |
| --- | ---: | ---: | ---: | ---: | --- |
| XL full policy vs production Expert | 786 | 734 | 80 | **+0.3575** | [−0.0077, +0.7227] |
| XL full policy vs uncapped-action Expert | 775 | 744 | 81 | +0.1575 | [−0.2124, +0.5274] |
| XL full policy + neural value in 1/512 leaves vs production Expert | 783 | 747 | 70 | +0.1369 | [−0.2138, +0.4875] |

Against the original Expert, XL performed as follows in each
200-deal / 400-game scoring configuration:

| Rules | XL wins | Expert wins | Ties | XL mean score margin | Approx. paired 95% CI |
| --- | ---: | ---: | ---: | ---: | --- |
| None | 192 | 188 | 20 | +0.42 | [−0.24, +1.08] |
| Middle Kingdom | 194 | 181 | 25 | +0.54 | [−0.13, +1.20] |
| Harmony | 197 | 185 | 18 | +0.06 | [−0.69, +0.81] |
| Both bonuses | 203 | 180 | 17 | +0.42 | [−0.42, +1.25] |

[Full arena tables and aggregate JSON](https://github.com/1amthis/kingdomino-3d/actions/runs/38128329283/artifacts/11700375909).

### Interpretation and decision

The XL experiment is **the strongest-looking neural result so far**
against production Expert on mean score margin (+0.36), but
the paired 95% interval **includes zero** (lower bound −0.008).
Even more importantly, the fairer uncapped-actions ablation
shrinks the observed margin to +0.16 with an interval crossing
zero. We therefore **cannot attribute the apparent gains to the
network** rather than simply exploring more legal placements.
The value-head option is weaker than policy-only on mean score
margin in this arena and does not independently demonstrate
improvement. The confidence intervals above are normal
approximations and do not establish a formal win-probability
advantage. Across three planned comparisons, multiplicity
also matters.

**Do not enable or merge XL as a demonstrably stronger Expert.**
Keep the trained weights and data. A next investigation should
focus on correcting/calibrating the value model and measuring
search strength against a rigorously action-matched baseline.
Any selected candidate must then face another **fully independent
paired-deal confirmation** before production activation.

This branch and both neural PRs remain experimental, with no
change to the player-facing default MCTS behavior.
