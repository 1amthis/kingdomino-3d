# Learned placement evaluation: experimental branch

This is a reversible experiment for the **2-player 5×5 Expert**. It does **not**
change the default Expert or the coach. The existing MCTS may optionally receive
`fastLearnedEval` as a placement evaluator, via
`new Search({ placementEval: fastLearnedEval })`.

## Why this design

An early nine-feature evaluator selected slightly better placements on held-out
teacher labels, but made simulations much slower. The replacement reduces the
model to **six cheap features**, fuses evaluation with the original 8-neighbour
walk, and allocates **no temporary objects or collections per placement**.
The pick heuristic remains unchanged. MCTS expansion and placement pruning can
use the evaluator via `placementEval`. Its use in rollouts is controlled
**independently** by `playoutEval`. The latter defaults to `placementEval`
for compatibility; explicitly pass `playoutEval: null` to keep the original
simulation policy (tree-only experiment).

The teacher still completes each simulation to a final score. This is a
**learned action-ranking heuristic**, not a neural value network or an
AlphaZero implementation.

## Reproduce

```sh
npm test
node scripts/train-learned.js --train-games 100 --valid-games 20 --teacher-sims 24
node scripts/bench-learned.js --mode tree --deals 100 --sims 2000 --ms 55 --threads 4 --seed 24000
node scripts/bench-learned.js --mode all --deals 100 --sims 2000 --ms 55 --threads 4 --seed 26000
node scripts/bench-learned.js --mode tree --deals 100 --sims 200 --ms 1500 --threads 4 --seed 28000
```

The trainer uses independent deal seeds for 100 training games (500–599)
and 20 validation games (600–619). It samples one placement from each third of
each Expert-vs-Expert game, labels *every legal placement* with 24 full-game
Monte-Carlo simulations, then fits ridge regression to **within-position
deviations in expected final lead**. All work uses the existing engine.
Validation games are excluded from fitting. No external ML dependencies.
A lower regret is better.

| Teacher agreement metric | Baseline | Learned |
| --- | ---: | ---: |
| Mean decision regret on 60 held-out positions | 2.0403 pts | 1.8278 pts |
| Training positions / legal actions | 300 / 3077 | 300 / 3077 |

These are **teacher-estimate** scores, not actual game outcomes. The teacher
shares some of the original heuristic's weaknesses, and uses only 24 rollouts
per action. The 60 positions are grouped into only 20 independent games, so
this result alone is not evidence of a true playing-strength gain.

## Early A/B results, not statistically decisive

The following are pilot measurements in a standalone execution of the same
JavaScript engine *before the branch was wired up*, using the numerically
equivalent fused evaluator. Each random deal was played twice with swapped
seats, all other conditions held constant. Results for *learner vs original*:

| Budget | Paired deals | Win / tie / loss | Mean point margin | Approx. 95% CI |
| --- | ---: | ---: | ---: | ---: |
| 200 simulations, 1.5 s cap | 16 | 15 / 1 / 16 | +1.875 | [−3.29, +7.04] |
| 2,000 simulations, 55 ms cap | 16 | 18 / 3 / 11 | +1.219 | [−1.14, +3.58] |

The baseline/learned mean simulation counts in the 55ms pilot were
302 / 281 per decision. The learned evaluator is still moderately more
expensive than the baseline (about 7% fewer simulations), even after
removing dynamic allocations.

On another independent 14-deal pilot, tree-only guided expansion with
original rollouts led by **+1.18 points** (16–0–12, CI ~[−2.36, +4.72]),
while guided expansion **and** learned rollouts trailed by **−2.43 points**
(11–0–17, CI ~[−5.76, +0.91]). Neither experiment establishes superiority;
these small batches illustrate substantial variance between deal ranges.

**None of the intervals excludes zero. No strength improvement is established.**
Do not merge this as a default Expert upgrade on the basis of these pilots.
Benchmarks should be rerun with the actual branch scripts, several hundred
paired deals, independent seed ranges, and a realistic device/browser budget.
For the timed test the wall clock should be controlled/recorded carefully.
Current pilot results are only a directional sanity check.

## Safety and limitations

- Existing `new Search()` and the browser worker continue using the exact
  previous heuristic. No change to the production playing strength or coach.
- The learned score affects MCTS placement pruning and expansion **only on
  explicitly opted-in Search instances**. Simulation playouts use it only if
  `playoutEval` is set (by default it follows `placementEval`); `null`
  retains the original rollout heuristic.
- Experimental weights trained on 2-player 5×5 without bonuses. They have **not**
  been validated for 3–4 players, 7×7 Mighty Duel, Harmony or Middle Kingdom.
- The current trainer samples positions from a single expert policy, rather
  than diverse adversaries; more accurate teacher labels and broader state
  coverage would be needed before production use.
- The benchmark uses **score ties**; official final tournament tie-breakers
  remain a separate improvement opportunity in the MCTS terminal reward.

## Suggested follow-up

A larger holdout head-to-head is the next gating test, at equal *elapsed
time* (not only equal simulations). If the mean advantage becomes robust,
explore a trained **drafting** heuristic separately and measure its effect
without inflating rollout cost. Keep the current default and coach unchanged
until the experiment meets that bar.
