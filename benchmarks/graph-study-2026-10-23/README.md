# Placement as a graph problem

Run on 23 October 2026 (UTC) with the scripts in [`scripts/graph/`](../../scripts/graph), on 4 cores under Node.js 22. The
question: can the best way to lay dominoes be modelled and solved as a graph problem?

## Conclusion

Yes. The score is a function of the connected components of the grid graph, a full kingdom is a perfect matching of
it, and with the sequence of dominoes known, the best placements are a longest path in a 12-level graph of positions.
That last problem is NP-complete in general, but on the 5×5 board an exact branch and bound solves 198 sequences in
200 within 180 s (median 1.4 s). With hindsight the optimum nearly always reaches the trivial bound where each
terrain is in one piece: the geometry constrains little. Online, the best policy tried keeps 80% of that optimum, so
most of what is lost comes from not knowing the chest.

For the app, the useful piece is the exact count of squares that can never be covered (free squares minus twice a
maximum matching, over the 5×5 windows still possible). Grafted onto the Hard AI in place of `deadCells`, it gains half
a point to a point per two-player game.

## Results

**Complete kingdoms.** The grid is bipartite and every domino covers one square of each colour, so the castle must end
on an even square of the final frame (13 of 25) for a full 5×5: the 12 odd squares allow no complete kingdom and cost
at least one domino. Domino tilings of the frame without the castle's square ([tilings.json](tilings.json)): 196 with
the castle in the centre, 192 in a corner or the middle of an edge, 112 on the four diagonal neighbours of the centre,
0 on the odd squares. The 7×7 Mighty Duel frame with a central castle has 75,272.

**Size of the graph** ([branching.json](branching.json)). Along 400 greedy solo games: about 18 legal placements a turn
for the first five turns (3.5 distinct up to symmetry on turn 1, 10.6 on turn 2), falling to 0.6 on turn 12. Counted
exhaustively for three sequences: 0.26 to 1.2 million positions at depth 5 and 2.5 million at depth 6 for one of
them. Symmetry divides that by 8; transpositions merge only 0–18% of paths, so the graph is nearly a tree and what
makes it tractable is pruning, not merging.

**Solo game** ([solo.jsonl](solo.jsonl)): 12 dominoes drawn from the 48, each seen only when it must be laid,
placement compulsory when possible, base score without bonuses. Every policy plays the same 200 sequences; the
clairvoyant optimum knows the whole sequence.

| Policy | Mean score (SE) | Share of the optimum | Complete 5×5 | Discards per game | ms per game |
| --- | ---: | ---: | ---: | ---: | ---: |
| Clairvoyant optimum (exact solver) | 41.85 | 100% | | | 1,351 (median) |
| Flat Monte Carlo, 200 playouts per placement | 33.4 (0.62) | 79.8% | 47% | 0.60 | 187 |
| Flat Monte Carlo, 50 playouts | 32.3 (0.63) | 77.2% | 41% | 0.72 | 57 |
| Graph evaluation (points + open crowned components − 4.5 × wasted squares) | 31.7 (0.58) | 75.8% | 41% | 0.70 | 2 |
| Greedy (immediate points) | 29.6 (0.61) | 70.8% | 18% | 0.96 | 1 |
| Hard placement + matching count | 29.6 (0.59) | 70.6% | 40% | 0.73 | 16 |
| Hard placement (`src/core/ai.js`) | 28.9 (0.55) | 69.0% | 28% | 0.86 | 11 |
| Playout heuristic (`quickEval`) | 28.1 (0.59) | 67.2% | 14% | 0.99 | 0 |
| Random | 20.4 (0.50) | 48.8% | 6% | 1.34 | 0 |

Paired differences on the same sequences (± standard error): graph evaluation − greedy +2.06 ± 0.41, graph evaluation
− Hard +2.85 ± 0.38, Hard with matching − Hard +0.70 ± 0.28, Monte Carlo 200 − graph evaluation +1.68 ± 0.40.

The exact solver proved 198 optima, median 1.4 s, 90th percentile 41 s, at most 18.5 million positions visited; the
other two are bracketed within a point. The optimum equals the bound "each terrain in one piece" in 171 sequences and
comes within a point of it in 192. Beam search alone finds it in 87.

**Two-player games** ([duel-standard.jsonl](duel-standard.jsonl), [duel-bonuses.jsonl](duel-bonuses.jsonl)): the Hard AI
with `deadCells` replaced by the matching count, against the Hard AI, on 500 deals each played from both seats.

| Rules | Matching variant: wins / ties / losses | Lead per game (SE, paired by deal) | Complete kingdoms (matching / Hard) |
| --- | ---: | ---: | ---: |
| Standard | 527 / 3 / 470 | +0.54 (0.12) | 50.8% / 39.5% |
| Middle Kingdom + Harmony | 527 / 1 / 472 | +1.09 (0.18) | 50.2% / 41.5% |

The lead is clear (over 4 standard errors); the win rate, about 52.8%, is within the noise of a thousand games.

**The hand rule against the matching** (`node scripts/graph/checks.js`): on 4,476 positions from Hard play, the matching
proves squares lost in 698; `deadCells` flags 372 of them, misses 326 and never raises a false alarm. By construction
it cannot see even-sized pockets that are unbalanced on the checkerboard, such as a T of four squares.

## Source and method

- Built on this repository at [bec03c8](https://github.com/1amthis/kingdomino-3d/commit/bec03c8): the search engine's
  boards (`src/core/search/engine.js`) for the solver and the solo policies, the rules engine and the Hard AI
  (`src/core/rules.js`, `src/core/ai.js`, `src/core/table.js`) for the Hard placements and the duels.
- Exact solver (`solveOffline` in [`lib.js`](../../scripts/graph/lib.js)): depth-first branch and bound over the graph of
  positions, seeded with the better of two beam searches, a transposition table keyed by Zobrist hashing up to the 8
  symmetries about the castle, and an admissible bound. The bound keeps closed components' points and lets every open
  component of a terrain and every square of it still to come merge, grouped by the pockets of free squares they touch
  (components that share no pocket can never join). On 300 mid-game positions it never fell below the exact optimum and
  cut the mean slack from 12.0 to 8.2 points.
- Flat Monte Carlo deals the unseen dominoes afresh for every playout and lays them with `quickEval`.
- Sequences come from `mulberry32(seed)` shuffles of the 48 dominoes, seeds 1–200 (solo) and 1001–1400 (branching);
  duel deals use seeds 1–500 of `dealTable`. Re-running seeds 1–12 of the solo run, deals 1–20 of the standard duels
  and the whole branching count from the committed scripts reproduced the saved records exactly.
- Times are Node.js on a shared 4-core runner, three or four workers at once.

## Reproduce

```bash
node scripts/graph/checks.js                                   # solver, bounds and matching checks (about 4 minutes)
python3 scripts/graph/tilings.py tilings.json
node --max-old-space-size=6000 scripts/graph/branching.js --out branching.json
node --max-old-space-size=3000 scripts/graph/solo.js --from 1 --to 200 --threads 3 --oracleMs 180000 --out solo.jsonl
node scripts/graph/duel.js --deals 500 --bonuses 0 --out duel-standard.jsonl
node scripts/graph/duel.js --deals 500 --bonuses 1 --out duel-bonuses.jsonl
python3 scripts/graph/summarize.py solo solo.jsonl
python3 scripts/graph/summarize.py duel duel-standard.jsonl
```

The solo run takes about half an hour on 3 workers, most of it in the exact solver; the time limit (`--oracleMs`)
decides which of the hardest sequences get proven.
