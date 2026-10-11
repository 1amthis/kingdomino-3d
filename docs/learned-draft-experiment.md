# Learning draft selection (experimental)

The previous learned *placement* evaluator did not beat the current Expert
on 300 paired deals. This is a separate experiment trained to select **which
domino to draft**, not where to place it. The existing browser Expert and
coach remain unchanged.

## Approach

- Use existing determinized MCTS as a noisy teacher.
- Generate genuine **opening, early, middle and late draft positions** from
  complete Expert-vs-Expert games, sampling one position per phase per game.
- Evaluate every legal draft slot with the same Monte-Carlo budget, using
  the expected final score margin as the label.
- Regress **within-position centered** label differences on simple local
  features (regularized least squares), so the regression learns ranking
  rather than absolute state value.
- Split by complete game seed (never split moves from the same game).
- Keep the actual production-compatible scorer allocation free.
- Compare the learnt scorer in MCTS **tree expansion** and **playout**
  independently, at the same wall-clock budget, using paired identical deals
  and swapping the seats.

## Training

```sh
node scripts/train-draft.js --seed 1000 --train-games 160 --valid-games 40 --teacher-sims 32 --trajectory-sims 24
```

Trained on 160 games / **640 draft positions**; validation on distinct
40 games / **160 draft positions** (deals 1160–1199).
Evaluated four ridge regression configurations; the simplest 'minimal'
model was selected for the experiment. Its six features are the existing
draft score, slot, same-terrain crowns already owned, same-terrain tile
count, crowned-terrain synergy, and stage-by-slot interaction.

| Phase (40 held-out positions each) | Original ranking regret | Learned minimal-model regret |
|---|---:|---:|
| Opening | 1.379 | 1.379 |
| Early | 1.199 | 1.234 |
| Middle | 1.167 | 0.408 |
| Late | 1.514 | 1.495 |
| All phases | 1.315 | 1.129 |

The learned model showed the largest improvement **in the middle of the
game only**. Therefore `learnedDraftEval` uses the original draft heuristic
except for 4–7 already placed dominoes. This phase gate was selected after
inspecting the same validation set; therefore the validation metrics
**overestimate confidence** and must not be treated as independent
confirmation. The separate head-to-head benchmark seeds are disjoint.

The MCTS teacher is noisy (32 simulations per legal slot) and self-play
positions can underrepresent states produced by other policies.
Actual playing-strength matches are the deciding test.

## A/B benchmark

```sh
npm test
node scripts/bench-draft.js --mode tree --deals 300 --sims 2000 --ms 55 --threads 4 --seed 30000
node scripts/bench-draft.js --mode rollout --deals 300 --sims 2000 --ms 55 --threads 4 --seed 30000
node scripts/bench-draft.js --mode both --deals 300 --sims 2000 --ms 55 --threads 4 --seed 30000
```

Each of the 300 deals is played twice with seats swapped (600 complete
games per configuration); no optional 2-player bonuses, 5×5 boards. The
three variants use the same deal seed range. The original policy is
the opponent in every match. Scores are compared with paired-deal
standard errors and approximate 95% confidence intervals.

- `tree`: learned policy used to order unexplored **draft** actions in
  MCTS; original rollout policy.
- `rollout`: original MCTS draft ordering, learned policy used for
  simulation-time draft choices.
- `both`: learned policy in both components.

**All are opt-in:** `new Search({ draftTreeEval: learnedDraftEval, draftRolloutEval: null })`,
and similarly for the others. A plain `new Search()` retains the original
behavior. The worker and game's browser UI do not load the model.

A CI workflow performs each mode as 6 shards of 50 paired deals and
aggregates them with duplicate/missing-seed checks and artifact reports.
Avoid concluding strength from teacher regret alone. No learned code
should be enabled in production without a verified head-to-head win.


## Completed A/B results (GitHub Actions)

The original 3-arm comparison used seeds 30000–30299, 300 paired deals
(600 games) **per mode**:

| Mode | Wins learned / baseline (draws) | Mean learned margin | Approximate 95% CI |
| --- | ---: | ---: | ---: |
| Tree-only | 298 / 281 (21) | +0.768 | [+0.228, +1.309] |
| Rollouts only | 266 / 304 (30) | -0.100 | [-0.66, +0.46] |
| Both | 290 / 276 (34) | +0.090 | [-0.49, +0.67] |

The tree-only variant was **chosen after inspecting these results**, so the
original tree-only confidence interval is exploratory, not a fully
pre-specified confirmation.

Two **independent seed ranges** were then tested using tree-only:

| Held-out seed range | Budget | Wins learned / baseline (draws) | Mean margin | Approximate 95% CI |
| --- | --- | ---: | ---: | ---: |
| 31000–31299 | 2,000 sims / 55 ms | 298 / 266 (36) | +0.318 | [-0.304, +0.941] |
| 32000–32299 | 2,000 sims / 1,500 ms | 305 / 268 (27) | +0.252 | [-0.361, +0.865] |

The wider time limit in the last test lets search reach the requested
simulation cap on non-forced turns; forced moves need zero simulations.

**Pooled exploratory + confirmation**: 900 paired deals (1,800 games),
901 wins / 815 losses / 84 score draws, +0.446 points/game, paired
95% CI **[+0.104, +0.789]**. Bootstrap 95% CI is about
[+0.112, +0.791]. This *looks positive*, but incorporates the
exploratory series used to select the winning variant.

**Confirmation-only**: 600 paired deals (1,200 games), +0.285 points/game,
paired 95% CI **[-0.151, +0.721]**. That interval **includes zero**.
Thus a reliable strength improvement has **not** been independently
demonstrated. The real win probability also requires a more targeted
statistical analysis, especially given tied scores and pair dependence.

Source workflows with full per-seed records (Actions artifacts):

- Initial 3-arm test: https://github.com/1amthis/kingdomino-3d/actions/runs/38089773926
- Independent timed confirmation: https://github.com/1amthis/kingdomino-3d/actions/runs/38089902345
- Independent simulation-cap confirmation: https://github.com/1amthis/kingdomino-3d/actions/runs/38090038976

**Decision:** keep this implementation opt-in on the draft PR. Do **not**
replace the default Expert until there is a consistent result on a
larger fully independent confirmation, at the browser's actual budget,
and ideally across game options.


## Production-budget validation, 2026-10-11

The best previous configuration was the learned draft score **only when ordering
untried draft actions in the MCTS tree**. Production Expert for two players
uses 3,000 simulations and a 1,500 ms decision cap; this test uses that
budget rather than the earlier 2,000 simulations / 55 ms.

A sharded Node 22 GitHub Actions run
[38118400746](https://github.com/1amthis/kingdomino-3d/actions/runs/38118400746)
completed successfully, with a [combined report artifact](https://github.com/1amthis/kingdomino-3d/actions/runs/38118400746/artifacts/11693663069).

Each case has **200 distinct random deals**, each played twice with seats
swapped (400 games). Different ranges are used for the four rule sets,
altogether **800 paired deals / 1,600 complete games**. The original
MCTS search and scoring logic is unchanged.

| Bonus configuration | Learned wins | Baseline wins | Score draws | Learned avg. margin | Approx. paired 95% CI |
| --- | ---: | ---: | ---: | ---: | ---: |
| None (seeds 41000–41199) | 185 | 191 | 24 | −0.135 | [−0.839, +0.569] |
| Middle Kingdom (42000–42199) | 188 | 197 | 15 | −0.160 | [−0.891, +0.571] |
| Harmony (43000–43199) | 187 | 182 | 31 | +0.198 | [−0.483, +0.878] |
| Both bonuses (44000–44199) | 197 | 190 | 13 | +0.268 | [−0.420, +0.955] |
| **Pooled, equal weighting across rule cases** | **757** | **760** | **83** | **+0.043** | **[−0.308, +0.393]** |

The pooled confidence interval is computed on the 800 individual
within-deal mean margins, not on the four group means. None of the
case intervals or the pooled interval excludes zero. With three or
four possible rule variants, even an isolated positive result would
require an appropriate multiple-comparisons correction.

There was one additional run on the **same deal ranges** using an
earlier workflow commit; its results differed slightly under the
wall-clock budget. These are repeats, **not new independent deals**;
they are deliberately **not** included in the 800-deal pooled estimate.
The latest successful run shown above is the canonical report.

**Decision:** do not switch on the learned draft ranking in the browser
Expert by default. The previously promising low-budget advantage is
not demonstrated at the true 3,000-simulation Expert budget or across
the tested optional scoring rules. Keep this draft PR experimental,
and if further work is pursued, prioritize improving the MCTS teacher,
collecting more diverse expert draft states, or training a policy
directly for the 3,000-simulation target. Multiseat play and Mighty
Duel remain untested for this learned model.
