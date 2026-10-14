# Mighty Duel: independent draft-preference confirmation

The larger test does **not establish a Mighty Duel strength advantage**. The normal-budget result is 205 wins and 195 losses (51.25%, paired 95% interval 48.75–53.75%). Completing every search at the full simulation count gives 204 wins and 196 losses (51.0%, interval 48.5–53.5%). Both intervals include an even match.

The initiative policy works: the candidate never passed up an available earlier identical copy. The original exploratory Mighty Duel result was 23–17 (57.5%) on only 20 deals; its apparent edge is not confirmed by these fresh deals. Keep this confirmation sample separate from the exploratory sample, since Mighty Duel was selected for follow-up after examining those results.

## Design

- 200 fresh deal seeds, **9000001–9000200**, with both seat assignments: **400 primary games**.
- Mighty Duel (7×7, two kings per player), Middle Kingdom and Harmony enabled.
- Baseline: [bec03c8](https://github.com/1amthis/kingdomino-3d/commit/bec03c8f4e1dc9b834f139611bcfaf7fd7f414e7), the merged Expert with the symmetry fix.
- Candidate: [d82e50d](https://github.com/1amthis/kingdomino-3d/commit/d82e50dd3715fe0c4eb6bba412dc80f0e6dc34e1), containing the identical-draft preference; engine implementation is b288230.
- Normal live budget for both versions: 3,000 simulations, 1,500 ms cap. Eight workers on the same shared runner, Node v24.19.0. Forced moves return without search.
- Deal count, seed range, primary outcome and stopping rule were recorded in [plan.json](plan.json) before launching. All 200 deals ran regardless of intermediate outcomes.
- Primary outcome: match score (win = 1, draw = 0.5), with 10,000 percentile-bootstrap replicates, seed 20261014. Whole deal pairs are resampled together. Mean point lead is secondary.

## Results

| Analysis | Candidate wins / draws / baseline wins | Match score [paired 95% interval] | Mean point lead [paired 95% interval] |
| --- | ---: | ---: | ---: |
| Primary: normal 1,500 ms cap | 205 / 0 / 195 | 51.25% [48.75%, 53.75%] | +0.31 [-0.67, +1.27] |
| Sensitivity: full 3,000 simulations | 204 / 0 / 196 | 51.00% [48.50%, 53.50%] | +0.50 [-0.42, +1.42] |

The sensitivity analysis uses the **same 200 deals**, not another independent sample. In the primary run, 21 of 38,400 decisions reached the time cap: 10 baseline, 11 candidate. These occurred in 16 games across 15 deals. Every affected deal was rerun in both seat assignments with an effectively disabled time cap, still at 3,000 simulations. The other 370 games had already completed every simulation and were retained unchanged. Selection for rerun used cap hits only, irrespective of results. This rule was added to the plan when caps were observed, before the main run finished.

There were **30 additional games executed**, not 400 additional games. Five game outcomes changed after completing capped searches. Original primary records are preserved. The sensitivity metadata records the source SHA-256, exact replaced deal seeds and rerun policy; replaced games carry `timingExcluded: true`.

## Draft behavior and timing

| Analysis | Baseline later-copy picks / duplicate choices | Candidate later-copy picks / duplicate choices |
| --- | ---: | ---: |
| Primary | 117 / 351 | 0 / 359 |
| Full-simulation sensitivity | 118 / 357 | 0 / 353 |

These counts refer to selections made while an identical free copy was also available. Each version made 9,600 drafts in each analysis. The independent auditor matches both terrain and crowns from the public domino definitions and actual legal options. Draft slots retain separate search estimates; this is a deliberate initiative preference, not a proof that earlier initiative dominates in every future position.

Primary mean decision time was 198.4 ms for baseline and 199.6 ms for candidate (+0.62%). The primary run took 964 seconds. These are shared-runner measurements with eight workers, not phone/browser latency estimates. Sensitivity reruns used two concurrent deals and two workers per deal; rerun timings are excluded from comparative timing. The candidate adds no simulations.

## Validation and reproduction

Every saved primary and sensitivity game was replayed through the table rules: legal moves, final scores, ranks and results match. Both files contain exactly 400 records with both seat assignments for all 200 seeds. Replacement checks confirm all and only affected pairs were rerun, all other records are unchanged, and no sensitivity decision is budget-limited. The auditor was also checked against the previous four-mode benchmark. Product AI source is unchanged by this follow-up.

Use a fresh output directory from this branch (the runner refuses overwrites):

```sh
git worktree add --detach ../kingdomino-3d-symmetry bec03c8f4e1dc9b834f139611bcfaf7fd7f414e7
node scripts/compare-experts.js --old ../kingdomino-3d-symmetry --mode duel --deals 200 --seed 9000001 --threads 8 --output mighty-rerun/duel.jsonl
python scripts/rerun-capped-comparison.py mighty-rerun/duel.jsonl --old ../kingdomino-3d-symmetry --output mighty-rerun/fixed-simulations/duel.jsonl --parts ../mighty-rerun-parts
node scripts/verify-expert-comparison.js mighty-rerun/duel.jsonl mighty-rerun/fixed-simulations/duel.jsonl
node scripts/check-draft-priority.js mighty-rerun
node scripts/check-draft-priority.js mighty-rerun/fixed-simulations
python scripts/summarize-expert-comparison.py mighty-rerun
python scripts/summarize-expert-comparison.py mighty-rerun/fixed-simulations
```

Cap hits and normal-cap outcomes depend on machine load. The fixed-simulation sensitivity should reproduce the moves and scores independently of machine speed. The source revision in a rerun will reflect the checked-out evidence commit, whose AI implementation is unchanged.

## Evidence

- Primary: [games](duel.jsonl), [summary](summary.json), [policy audit](draft-policy-audit.json)
- Fixed-simulation sensitivity: [games](fixed-simulations/duel.jsonl), [summary](fixed-simulations/summary.json), [policy audit](fixed-simulations/draft-policy-audit.json)
- [Original exploratory comparison](../draft-priority-2026-10-14/README.md)
- [Match runner](../../scripts/compare-experts.js), [cap sensitivity runner](../../scripts/rerun-capped-comparison.py), [replay verifier](../../scripts/verify-expert-comparison.js), [policy auditor](../../scripts/check-draft-priority.js), [paired analysis](../../scripts/summarize-expert-comparison.py)
