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
