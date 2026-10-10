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
