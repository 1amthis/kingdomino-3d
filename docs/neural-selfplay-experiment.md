# Neural policy/value MCTS self-play — scalable, raw-observation experiment

## Research hypothesis

Previous hand-engineered six- and nine-feature action regressions produced
smaller MCTS-teacher regret without a repeatable improvement in playing
strength. Instead of tuning another feature list, scale *search-generated
examples* and *representation learning*:

1. Represent each player's 9×9 playable board using raw terrain IDs and
   crown counts, plus the currently visible draft slots, legal-action mask,
   stage, and scoring-rule flags. No domain-specific synergy weights.
2. Run genuine MCTS self-play. At a draft decision record the four
   **root visit counts** from a 256-simulation search (not a heuristic label).
3. On terminal states attach a signed win/draw/loss outcome from the
   original actor's perspective.
4. Train a shared **policy and value neural network** with softmax
   cross-entropy plus outcome mean-squared error, Adam and D4 board
   rotations/reflections, holding out *whole self-play games* by seed.
5. Improve search with the learned policy only at *visible real draft roots*.
   Continue self-play under this guided search, mix its examples with the
   original generation (replay buffer), and train a second model.
6. Evaluate both versions on entirely new, seat-swapped **head-to-head
   games against the unmodified Expert**, with all scoring-option variants
   at the production 3,000-simulation / 1,500 ms budget. Evaluate the
   actual *wall-clock* effects of neural inference.

## Model and constraints

- Input: 355 float values (two 9×9 terrain/crown boards, 4 visible dominoes,
  slot mask, and 7 game-state flags).
- MLP: 355 → 64 ReLU → 64 ReLU → 4 draft policy logits + 1 tanh outcome value.
  Roughly 27k trainable weights, entirely implemented in JavaScript with no
  browser runtime dependency.
- Action masking, one forward pass per actual MCTS draft root, and PUCT
  selection based on priors. MCTS expansion and rollouts are unchanged.
- Only the policy head is used for search guiding in this pilot; the value head
  trains from final win/loss to prepare a future experiment that replaces
  terminal rollouts with learned values when calibrated. This version is
  **not a full AlphaZero implementation** and does not learn placements.
- 2-player 5×5 only, all four Middle Kingdom/Harmony rule cases. No 3–4
  player deployment or Mighty Duel support.
- Training experience uses 256 MCTS simulations for draft decisions, 64 for
  placement decisions. Random exploratory moves diversify trajectories;
  a quarter of episodes use original MCTS even in generation two.
- Generation one: 160 self-play training games and 40 held-out games,
  seeds 120000–120159 and 900000–900039.
- Generation two: 160 more guided training games and 40 held-out games,
  seeds 121000–121159 and 900100–900139.
- The second network learns on the **combined two-generation replay buffer**.

## Reproduce

```sh
npm test
node scripts/neural/collect.js --first 120000 --games 40 --sims 256 --place-sims 64 --out data/shard.json
node scripts/neural/train.js --dir data --out model0.json --epochs 14 --seed 701
node scripts/neural/collect.js --first 121000 --games 40 --sims 256 --place-sims 64 --model model0.json --out data/guided.json
node scripts/neural/train.js --dir data --out model1.json --init model0.json --epochs 9 --seed 702 --lr 0.00045
node scripts/neural/bench.js --model model1.json --first 160000 --deals 50 --sims 3000 --ms 1500 --out arena.json
```

These commands are illustrative; validation seeds and extra shards from the
workflow are also required by the trainer. Full reproduction runs in
[GitHub Actions](../.github/workflows/neural-selfplay.yml), with both checkpoint
weights, self-play examples, training reports, and per-seed arena records
available as artifacts.

## Scientific limitations

- **No proof of superiority from training accuracy**. Root visit targets
  reflect the MCTS search itself, which is noisy and shares its original
  simulator's biases. The value head's MSE is separate from policy quality.
- The network uses numeric terrain codes, so it may learn spurious ordinal
  relationships; one-hot convolutional inputs are a natural larger-scale
  successor. The modest dense network is an initial proof-of-concept, not
  the upper bound on neural Kingdomino.
- Value inference is not yet used to cut off expensive rollouts. Learning a
  cheap, well-calibrated terminal value that replaces rollouts is the
  plausible large performance opportunity.
- Training and validation games have disjoint seeds. Reusing any arena seed
  for architecture selection would require a **fresh final test**.
- The browser production worker uses plain `new Search()`, with no loaded
  checkpoint. It will continue playing **exactly the same** until an
  improvement is statistically confirmed.
