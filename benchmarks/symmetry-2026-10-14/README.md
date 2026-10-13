# Old versus new Expert: symmetry benchmark

Run on 14 October 2026 (Europe/Paris). Playing strength uses 1,020 prespecified games across 470 deal seeds. Old-versus-old controls, pilot games and exact recovery reruns are excluded from this sample.

## Conclusion

The strongest evidence of a benefit is in Mighty Duel: the new Expert won 64 of 100 games, with a paired-deal bootstrap 95% interval of 55–73% for its match score. The ordinary 5×5 results do not establish a win-rate improvement. Three-player results favor the new Expert but remain inconclusive. Search time rose about 3–7% on this runner.

The symmetry fix gives the coach a correctness benefit regardless of playing strength: equivalent placements share their estimates and grade. These matches support a possible Mighty Duel strength gain, rather than a universal strength upgrade.

## Playing strength

Primary endpoint: official ranking against the other Expert, counting a win as 1, a draw as ½ and a loss as 0. Point lead is a secondary endpoint. In three-player matches, these are pairwise results against the old Expert, not counts of first place at the whole table.

| Mode | Games / deal seeds | New wins / draws / old wins | New match score (95% CI) | New minus old points (95% CI) |
| --- | ---: | ---: | ---: | ---: |
| 5×5, no bonuses | 400 / 200 | 190 / 1 / 209 | 47.6% [43.8%, 51.7%] | -0.29 [-0.94, +0.39] |
| 5×5, Middle Kingdom + Harmony | 400 / 200 | 205 / 2 / 193 | 51.5% [47.0%, 55.9%] | +0.89 [+0.06, +1.70] |
| 7×7 Mighty Duel, both bonuses | 100 / 50 | 64 / 0 / 36 | 64.0% [55.0%, 73.0%] | +2.32 [-1.79, +6.28] |
| 3 players: new + old + Hard, both bonuses | 120 / 20 | 68 / 0 / 52 | 56.7% [49.2%, 64.2%] | +1.66 [-0.43, +4.19] |

Combined 5×5: **395 wins, 3 draws, 402 losses** for the new Expert. Match score 49.6%, 95% CI [46.6%, 52.5%]; mean lead +0.30 points, 95% CI [-0.23, +0.83].

Intervals resample entire deal seeds, retaining both swapped-seat games or all six three-player arrangements together. They use 10,000 deterministic percentile-bootstrap replicates, seed 20261014. Per-mode 95% intervals are not adjusted for multiple comparisons; smaller modes should be treated as exploratory. Seeds are disjoint between modes.

## Search time

Timings cover `Search.choose()` only, measured in Node.js on a shared runner with four workers per mode and two modes running concurrently. They are not phone/browser latency measurements. Recovered records are excluded from timing estimates because those reruns had a different load.

| Mode | Simulations per non-forced decision | Timing games | Old ms/decision | New ms/decision | Change |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5×5, no bonuses | 3,000 | 400 | 56.9 | 60.1 | +5.6% |
| 5×5, Middle Kingdom + Harmony | 3,000 | 400 | 56.3 | 59.8 | +6.3% |
| 7×7 Mighty Duel, both bonuses | 3,000 | 98 | 105.4 | 108.9 | +3.2% |
| 3 players: new + old + Hard, both bonuses | 6,000 | 116 | 215.6 | 229.9 | +6.6% |

Both versions used the live simulation budgets and a 1,500 ms cap. **No recorded decision hit the time cap**, including recovered games. Forced decisions may return with zero simulations.

## Source and method

- Old Expert: [1739bad](https://github.com/1amthis/kingdomino-3d/commit/1739bad152d8b71a5de7664629026cbbaa3c2596).
- New Expert: [ea8b087](https://github.com/1amthis/kingdomino-3d/commit/ea8b0871ac17b4336ea3f1f8425349f90325d274), the symmetry fix.
- Game flow, legality checks, scoring and official tie-breakers use the unchanged repository rules. Each version reconstructs its own search state using its own revision’s `gameFrom()`.
- Each bot has a seeded search per seat. Search seeds are `hashSeed("compare-experts", dealSeed, seat)`; the draw/turn-order seed is shared between swapped-seat games. Hidden chest order is never supplied to the search.
- Two-player conditions test both seat assignments per deal. Three-player conditions test all six ordered new/old seat pairs, with a seeded Hard bot in the remaining seat.
- Sample sizes and seed ranges were fixed before examining the main results. Pilots did not contribute to the sample.
- Old-versus-old controls yielded identical game histories after swapping version labels and exactly zero paired point lead (4 standard games and 6 three-player games).
- Every saved game, including all controls, was replayed through the rules engine; all persisted moves, scores and outcomes verified.
- The append audit found two absent Mighty Duel records and four absent three-player records. Exactly the affected deals were rerun. All 16 overlapping saved histories reproduced exactly, and the six recovered records restored the original aggregate outcomes. Their timing is excluded. The runner now rewrites its complete in-memory record at completion, avoiding dependence on incremental appends. See [audit.json](audit.json).

## Evidence

- [Machine-readable summary](summary.json)
- [Standard games](standard.jsonl), [bonus games](bonuses.jsonl), [Mighty Duel games](duel.jsonl), [three-player games](three.jsonl)
- [Standard control](control-standard.jsonl), [three-player control](control-three.jsonl)
- [Runner](../../scripts/compare-experts.js), [replay verifier](../../scripts/verify-expert-comparison.js), [paired analysis](../../scripts/summarize-expert-comparison.py)

## Reproduce

From this branch, create an old checkout, then use a fresh output directory. A very large `--ms` makes replay outcomes independent of machine speed; the original run used 1,500 ms and never reached it.

```sh
git worktree add --detach ../kingdomino-3d-old 1739bad152d8b71a5de7664629026cbbaa3c2596
node scripts/compare-experts.js --old ../kingdomino-3d-old --mode standard --deals 200 --seed 1000001 --threads 4 --ms 1000000000 --output benchmark-rerun/standard.jsonl
node scripts/compare-experts.js --old ../kingdomino-3d-old --mode bonuses --deals 200 --seed 2000001 --threads 4 --ms 1000000000 --output benchmark-rerun/bonuses.jsonl
node scripts/compare-experts.js --old ../kingdomino-3d-old --mode duel --deals 50 --seed 3000001 --threads 4 --ms 1000000000 --output benchmark-rerun/duel.jsonl
node scripts/compare-experts.js --old ../kingdomino-3d-old --mode three --deals 20 --seed 4000001 --threads 4 --ms 1000000000 --output benchmark-rerun/three.jsonl
node scripts/verify-expert-comparison.js benchmark-rerun/*.jsonl
python scripts/summarize-expert-comparison.py benchmark-rerun
```

The runner refuses to overwrite existing outputs. Reproduction should match moves and scores; wall-clock timings depend on the machine and load.
