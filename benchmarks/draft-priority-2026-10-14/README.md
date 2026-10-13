# Identical-domino draft preference: validation

The candidate chooses the earliest free copy of its selected domino when terrain and crowns match on both squares. This is an explicit initiative preference, rather than treating the two draft positions as equivalent. The Expert and coach use the same preference; their simulation estimates remain separate. Snake opening drafts are exempt because first-round king order overrides domino numbers.

## Outcome

Across **560 prespecified games**, the candidate passed up an available earlier identical copy **0/266** times; the merged baseline did so **102/271** times. These counts concern cases where a bot selected a domino while at least one identical copy was also free. All 560 saved games replay with legal moves and matching final scores. No records required recovery.

The candidate won 288, drew 0 and lost 272 pairwise matches against the merged Expert. The edge is inconclusive; the benchmark supports the targeted behavior change and does not establish an overall strength upgrade. Decision times differed by about 1% or less on this runner, and no decision reached the 1,500 ms search cap.

## Playing strength

| Mode | Games / deal seeds | Candidate wins / draws / baseline wins | Candidate match score (95% CI) | Mean point lead |
| --- | ---: | ---: | ---: | ---: |
| 5×5, no bonuses | 200 / 100 | 102 / 0 / 98 | 51.0% [48.5%, 54.0%] | +0.07 |
| 5×5, both bonuses | 200 / 100 | 102 / 0 / 98 | 51.0% [49.0%, 53.0%] | -0.10 |
| Mighty Duel, both bonuses | 40 / 20 | 23 / 0 / 17 | 57.5% [50.0%, 65.0%] | +2.23 |
| 3 players, both bonuses, Hard in third seat | 120 / 20 | 61 / 0 / 59 | 50.8% [48.3%, 53.3%] | +0.29 |

Combined 5×5 match score: 51.0%, 95% interval [49.2%, 52.8%]. Three-player match results compare candidate versus baseline within the table, rather than counting whole-table first places.

Intervals use 10,000 percentile-bootstrap replicates, seed 20261014, resampling entire deals within modes. Both swapped-seat games, or all six three-player seat arrangements, remain together. The smaller modes are exploratory; per-mode intervals are not adjusted for multiple comparisons. Four-player strength was not benchmarked; existing legality tests cover that setup.

## Draft policy and timing

| Mode | Baseline later-copy picks / duplicate choices | Candidate later-copy picks / duplicate choices | Baseline ms/decision | Candidate ms/decision | Change |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5×5, no bonuses | 29 / 85 | 0 / 85 | 61.0 | 61.6 | +1.1% |
| 5×5, both bonuses | 29 / 82 | 0 / 78 | 60.3 | 60.7 | +0.5% |
| Mighty Duel, both bonuses | 13 / 38 | 0 / 38 | 113.7 | 113.7 | -0.0% |
| 3 players, both bonuses, Hard in third seat | 31 / 66 | 0 / 65 | 243.0 | 244.9 | +0.8% |

Timing covers `Search.choose()` only in Node.js on a shared runner. The two 5×5 modes ran concurrently with four workers each. Mighty Duel used two workers while three-player games used six. These are comparative runner timings, not phone/browser latency measurements. The candidate adds no simulations.

## Revisions and checks

- Baseline: [bec03c8](https://github.com/1amthis/kingdomino-3d/commit/bec03c8f4e1dc9b834f139611bcfaf7fd7f414e7), the merged symmetry fix.
- Candidate engine: [b288230](https://github.com/1amthis/kingdomino-3d/commit/b288230cffb2c38efcbc2a9a392c2e90e5d4d9f7).
- All 54 rules/AI tests and the production build passed.
- The synthetic draft regression chooses a later copy on the baseline for seed 7, and chooses the earlier copy on the candidate. Tests protect claimed slots, per-terrain crowns, distinct tiles, snake opening order, and independent draft statistics.
- Search budgets match the live game: 3,000 simulations with two players, 6,000 with three players, at most 1,500 ms per decision. Forced decisions can return without search. No decisions hit the cap.
- Seed ranges and sample sizes were fixed before examining main outcomes. Each deal is played from both Expert seats; the three-player mode tries all six ordered seat pairs with a seeded Hard bot in the remaining seat.
- The unchanged table rules and official tie-breakers determine legal actions and outcomes. Each Expert uses its own revision of the search engine; hidden chest order is never supplied.
- Draft policy checks reconstruct every offered legal option from the public rules, matching both terrain and crown assignment independently of the search helper.

## Reproduce

Use a fresh output directory from this branch. Raising the time cap makes outcomes independent of machine speed; original runs completed the normal budgets within 1,500 ms.

```sh
git worktree add --detach ../kingdomino-3d-symmetry bec03c8f4e1dc9b834f139611bcfaf7fd7f414e7
node scripts/compare-experts.js --old ../kingdomino-3d-symmetry --mode standard --deals 100 --seed 5000001 --threads 4 --ms 1000000000 --output draft-rerun/standard.jsonl
node scripts/compare-experts.js --old ../kingdomino-3d-symmetry --mode bonuses --deals 100 --seed 6000001 --threads 4 --ms 1000000000 --output draft-rerun/bonuses.jsonl
node scripts/compare-experts.js --old ../kingdomino-3d-symmetry --mode duel --deals 20 --seed 7000001 --threads 2 --ms 1000000000 --output draft-rerun/duel.jsonl
node scripts/compare-experts.js --old ../kingdomino-3d-symmetry --mode three --deals 20 --seed 8000001 --threads 6 --ms 1000000000 --output draft-rerun/three.jsonl
node scripts/verify-expert-comparison.js draft-rerun/*.jsonl
node scripts/check-draft-priority.js draft-rerun
python scripts/summarize-expert-comparison.py draft-rerun
```

The runner refuses to overwrite existing results. Moves and scores should reproduce; timing depends on hardware and concurrent load.

## Evidence

- [Summary with paired intervals](summary.json) and [draft policy audit](draft-policy-audit.json)
- [Standard](standard.jsonl), [bonuses](bonuses.jsonl), [Mighty Duel](duel.jsonl), [three-player](three.jsonl) per-game evidence
- [Runner](../../scripts/compare-experts.js), [replay verifier](../../scripts/verify-expert-comparison.js), [draft policy checker](../../scripts/check-draft-priority.js), [analysis](../../scripts/summarize-expert-comparison.py)
