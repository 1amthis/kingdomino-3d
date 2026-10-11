# End-to-end spatial policy/value MCTS — research prototype

**Experimental only; default Expert and coach are unchanged.** This is
stacked on top of [PR #35](https://github.com/1amthis/kingdomino-3d/pull/35)
and is proposed against the neural research branch, *not* `main`.

## Why this experiment is different

The earlier network learned only the choice of the next domino. It did
not learn the higher-branching placement moves and its value output was
not used during search. This branch addresses those two structural
limitations.

### Representation and network

- The visible, *public* state of both players' 9×9 board regions is
  converted into **24 spatial planes**: one-hot terrain codes and normalized
  crown counts for each player (20 planes), plus four planes describing
  the domino currently being placed.
- **106 global signals** include current/next visible domino lines,
  claimed slots, stage, scoring rules, and which tiles are publicly
  known. The hidden deck is **never encoded**.
- A shared spatial CNN uses 16 channels, a 3×3 stem and **two residual
  3×3 blocks**. Its placement head outputs four orientations on each
  of 9×9 cells (324 moves) plus a separate discard head. Its draft
  head outputs the four visible slots. All probabilities are normalized
  over **the actual legal action list**.
- A separate tanh outcome head predicts signed win/tie/loss for the
  player whose turn it is. All three heads train jointly.
- Around **16,538 trainable parameters** in the first PyTorch model.
  CPU inference uses independent plain JavaScript kernels with portable
  JSON-exported model weights, with no runtime ML dependency.
- Applies only to **two players on 5×5** so far; other player counts and
  Mighty Duel are not silently extrapolated.

### Integration into the imperfect-information MCTS

- The learned prior is evaluated at an actual, publicly visible root
  position and supplies legal-move probabilities to PUCT. It covers
  **both draft and placement** choices.
- `Search({fullNet:network})` is opt-in. It disables placement action
  caps in that experimental search, to avoid excluding legal moves
  before learning their probabilities.
- `Search({fullNet:network,leafValueEvery:128})` additionally replaces
  one in 128 nonterminal heuristic rollouts with a learned outcome
  evaluation. The value is mapped back to the existing win-heavy
  MCTS reward scale, with the sign reversed for the other player.
  This trades expensive full-game simulations for a neural forward pass.
- Future revealed tiles are **determinized** exactly as before.
  Leaf neural inference only sees tiles currently visible in that
  simulated state, not the hidden deck. The search is still an
  *open-loop determinization-based approximation*; it is not yet a
  rigorous information-set MCTS.
- `new Search()` produces the same behavior as the original Expert.
  Tests check bitwise equivalence without network injection.

### Supervision and training

```bash
npm test
node scripts/full-neural/collect.js --first 250000 --games 16 --sims 192 --place-sims 96 --out shard.json
python -m pip install torch numpy
python scripts/full-neural/train.py --data shards --out full-model.json --epochs 12
node scripts/full-neural/bench.js --model full-model.json --mode policy --first 310000 --deals 25 --sims 3000 --ms 1500
node scripts/full-neural/bench.js --model full-model.json --mode value --leaf-every 128 --first 310000 --deals 25 --sims 3000 --ms 1500
```

For full reproduction, use the workflow rather than a single sample
shard: [.github/workflows/full-neural.yml](../.github/workflows/full-neural.yml).

Initial experiment:
- **128 training games** and **32 separate validation games**.
- **4,923 training decisions** and **1,231 validation decisions**.
- Policy teacher: actual MCTS visit distributions at **all legal moves**
  from 192-simulation drafts and 96-simulation placements, from complete
  games and all four bonus configurations.
- Outcome teacher: signed terminal game outcome from each acting player's
  perspective, not the heuristic score margin.
- D4 rotation/reflection data augmentation transforms the spatial input
  **and placement-action labels**, keeping draft slot indices unchanged.
- PyTorch AdamW optimizer, 12 epochs, early checkpoint selection by
  held-out legal-action policy cross-entropy.
- First checkpoint was selected at epoch 10, with validation
  policy CE **1.6334**, value MSE **0.9430**, and top-visited-action
  agreement **29.98%** (mixes high-branching placements and drafts).

The validation scores are *teacher-imitation* metrics, not strength.
This modest proof-of-concept has insufficient games to claim scalability
or superiority. The win-strength promotion gate is a **paired seat-swapped
arena** at the Expert's actual time budget. The experimental search has
uncapped root placements, unlike the original production Expert's cap of
48, so any positive result must be ablated against an *uncapped baseline*
before attributing an advantage to the neural model alone.

### Caveats and future scaling

This is a spatial **residual network**, but it is still small and CPU-run.
True `Bitter Lesson` progress calls for a bigger network on GPU,
distributed self-play, broader decision-state coverage, rigorous
information-set value training, and statistically validated promotion
against the incumbent. No large-scale GPU training is claimed here.
