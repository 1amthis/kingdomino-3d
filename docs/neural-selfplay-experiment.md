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


## Measured results — 2026-10-11

### First exploratory arena (2 generations, 1,600 games)

[Successful CI workflow](https://github.com/1amthis/kingdomino-3d/actions/runs/38119620310) and
[full per-seed artifact](https://github.com/1amthis/kingdomino-3d/actions/runs/38119620310/artifacts/11693929233).

Both networks were evaluated against the unchanged Expert, 100 seed-swapped
deals per scoring-rule case and model (400 deals / 800 games for each
generation). Maximum 3,000 simulations and 1,500 milliseconds per move.

| Iteration | Neural wins | Expert wins | Draws | Mean margin | Approx. 95% paired CI |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 (initial self-play) | 389 | 378 | 33 | +0.16 | [−0.33, +0.65] |
| 1 (guided self-play + replay) | 403 | 343 | 54 | +0.52 | [+0.03, +1.00] |

Iteration 1 looked promising. **But this exploratory arena also served to
select iteration 1**, so its uncorrected interval does not establish a
prospective improvement. The two versions reused the same arena seeds.

Validation on disjoint training-era games:
- Iteration 0: 2,880 policy targets for fitting, 720 independent validation
  draft positions; top MCTS action agreement 57.9%.
- Iteration 1: 5,760 fitting positions in a two-generation replay buffer,
  1,440 validation positions; top MCTS action agreement 63.5%.
These validation datasets differ. Do not interpret percentage differences
as a controlled comparison.

### Independent prospective arena (frozen iteration 1, 1,600 more games)

After choosing iteration 1, we **froze all network weights** and tested
a new range of 800 independent paired deals (1,600 games), four scoring
configurations, 200 pairs per configuration; budget unchanged. Seeds were
not used for training, validation or initial arena selection.

[Successful independent CI workflow](https://github.com/1amthis/kingdomino-3d/actions/runs/38119852438),
[full per-seed artifact](https://github.com/1amthis/kingdomino-3d/actions/runs/38119852438/artifacts/11695155543).

| Rules | Neural wins | Expert wins | Score draws | Mean neural margin | Approx. 95% paired CI |
| --- | ---: | ---: | ---: | ---: | ---: |
| No bonuses | 185 | 198 | 17 | **−0.60** | [−1.22, +0.02] |
| Middle Kingdom | 193 | 186 | 21 | −0.10 | [−0.80, +0.59] |
| Harmony | 205 | 174 | 21 | +0.51 | [−0.15, +1.17] |
| Both bonuses | 206 | 173 | 21 | +0.90 | [+0.11, +1.68] |
| **All cases (800 paired deals)** | **789** | **731** | **80** | **+0.17** | **[−0.17, +0.52]** |

The pooled 95% CI **includes zero**, so the independent evaluation does not
show a statistically conclusive overall playing-strength improvement. The
two-bonus case looks positive, but is one of four cases and was not
pre-registered as the primary hypothesis; its interval is not adjusted for
multiple comparisons. Results are different by scoring rules and test seeds,
and inference overhead varies across machines. This model cannot be claimed
to reliably beat the current Expert.

**Decision: keep both neural checkpoint weights as downloadable experimental
artifacts. Keep this pull request in draft; do not enable neural inference in
the production browser worker.**

## Next high-compute experiment

A more serious *Bitter Lesson* scaling direction is:

1. **Millions of self-play positions**, rather than the current 5,760, and
   recurrent self-play model updates. Record policy visit distributions,
   terminal values and legal action masks.
2. **2D convolutional residual tower** with terrain as one-hot spatial planes,
   crowns, and explicit action encodings, not ordinal terrain integers.
   Train with a GPU accelerator (PyTorch or ONNX export) and use an
   optimized CPU/WebGPU inference runtime. The current MLP is a small
   dependency-free proof-of-concept.
3. **Joint drafting and placement policy**, rather than only drafting.
   The space of legal placements changes with the board; model it by
   action-conditioned features or a masked spatial policy.
4. **A calibrated learned value function used inside search** to replace
   expensive end-of-game rollouts, not just an auxiliary head. Validate
   how much additional search the saved compute enables.
5. **Separate frozen evaluations** for each rule mode on untouched game
   seeds, a browser-speed device test, and opponent mixtures. Promote a
   checkpoint only after a win/loss metric improves at equal elapsed time.

More search compute alone cannot guarantee improvement if the supervision
objective or the model/search integration is misaligned; the independent
arena, not training loss, remains the acceptance criterion.
