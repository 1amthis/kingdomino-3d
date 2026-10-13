"""Summarize compare-experts.js JSONL evidence; bootstrap whole paired deals, not games.

Usage: python scripts/summarize-expert-comparison.py benchmarks/symmetry-2026-10-14
Writes summary.json beside the per-game evidence. Uses only the Python standard library.
"""
import collections
import json
import pathlib
import random
import statistics
import sys

folder = pathlib.Path(sys.argv[1])
replicates = 10000
rng = random.Random(20261014)


def interval(samples):
    samples = sorted(samples)
    return [samples[int((len(samples) - 1) * p)] for p in (0.025, 0.975)]


def paired_bootstrap(groups):
    # Every mode replays a deal the same number of times, so its deal means have equal weights.
    summaries = [(statistics.mean(g["margin"] for g in rows),
                  statistics.mean({"win": 1, "tie": 0.5, "loss": 0}[g["result"]] for g in rows))
                 for rows in groups.values()]
    margins, scores = [], []
    for _ in range(replicates):
        drawn = rng.choices(summaries, k=len(summaries))
        margins.append(statistics.mean(x[0] for x in drawn))
        scores.append(statistics.mean(x[1] for x in drawn))
    return interval(margins), interval(scores), (margins, scores)


summary = {"bootstrapReplicates": replicates, "bootstrapSeed": 20261014,
           "confidenceMethod": "95% percentile bootstrap, resampling whole dealSeed clusters within each mode",
           "modes": {}}
draws = {}
for mode in ["standard", "bonuses", "duel", "three"]:
    path = folder / f"{mode}.jsonl"
    if not path.exists():
        continue
    lines = [json.loads(line) for line in path.read_text().splitlines()]
    metadata = lines[0]
    assert metadata["type"] == "metadata" and metadata["mode"] == mode
    assert lines[-1]["type"] == "complete", f"{mode}: run is incomplete"
    games = [g for g in lines if g["type"] == "game"]
    n = metadata["rules"]["players"]
    assert len(games) == metadata["deals"] * n * (n - 1) == lines[-1]["games"]
    groups = collections.defaultdict(list)
    for game in games:
        assert game["margin"] == game["scoreNew"] - game["scoreOld"]
        assert game["result"] == ("win" if game["rankNew"] < game["rankOld"] else
                                  "loss" if game["rankNew"] > game["rankOld"] else "tie")
        assert game["roles"][game["newSeat"]] == "new" and game["roles"][game["oldSeat"]] == "old"
        assert len(game["moves"]) == (96 if mode == "duel" else 72 if mode == "three" else 48)
        groups[game["dealSeed"]].append(game)
    assert set(groups) == set(range(metadata["seed"], metadata["seed"] + metadata["deals"]))
    for rows in groups.values():
        assert {(g["newSeat"], g["oldSeat"]) for g in rows} == {
            (a, b) for a in range(n) for b in range(n) if a != b}
        assert len(rows) == n * (n - 1)
    margin_ci, score_ci, draws[mode] = paired_bootstrap(groups)
    counts = collections.Counter(g["result"] for g in games)
    # Exact reruns can restore lost records, but their different machine load is not comparable timing.
    timing_games = [g for g in games if not g.get('timingExcluded', False)]
    stats = {}
    for role in ["old", "new"]:
        stats[role] = {key: sum(g["stats"][role][key] for g in timing_games)
                       for key in ["calls", "sims", "ms", "limited"]}
        stats[role]["msPerDecision"] = stats[role]["ms"] / stats[role]["calls"]
        stats[role]["msPerThousandSimulations"] = stats[role]["ms"] * 1000 / stats[role]["sims"]
        stats[role]["maxDecisionMs"] = max(g["stats"][role]["maxMs"] for g in timing_games)
    result = {"games": len(games), "deals": len(groups), "simsPerSearch": metadata["sims"],
              "wins": counts["win"], "ties": counts["tie"], "losses": counts["loss"],
              "matchScore": (counts["win"] + counts["tie"] / 2) / len(games), "matchScoreCI95": score_ci,
              "meanLead": statistics.mean(g["margin"] for g in games), "meanLeadCI95": margin_ci,
              "meanScoreNew": statistics.mean(g["scoreNew"] for g in games),
              "meanScoreOld": statistics.mean(g["scoreOld"] for g in games),
              "firstPlaceNew": sum(g["rankNew"] == 1 for g in games),
              "firstPlaceOld": sum(g["rankOld"] == 1 for g in games),
              "stats": stats, "timingGames": len(timing_games),
              "budgetLimitedDecisions": sum(g['stats'][r]['limited'] for g in games for r in ['old', 'new']),
              "relativeDecisionTimeChange": stats["new"]["msPerDecision"] / stats["old"]["msPerDecision"] - 1,
              "wallSeconds": lines[-1]["wallSeconds"], "metadata": metadata}
    summary["modes"][mode] = result
    print(f'{mode}: {len(games)} games; new W/T/L {counts["win"]}/{counts["tie"]}/{counts["loss"]}; '
          f'lead {result["meanLead"]:+.2f} [{margin_ci[0]:+.2f}, {margin_ci[1]:+.2f}]; '
          f'match score {result["matchScore"]:.1%} [{score_ci[0]:.1%}, {score_ci[1]:.1%}]; '
          f'decision time change {result["relativeDecisionTimeChange"]:+.1%}')

# The two 5x5 conditions are separate, equally sized strata, on disjoint deal seeds.
if {"standard", "bonuses"} <= set(draws):
    a, b = summary["modes"]["standard"], summary["modes"]["bonuses"]
    assert a["games"] == b["games"]
    margin_draws = [(x + y) / 2 for x, y in zip(draws["standard"][0], draws["bonuses"][0])]
    score_draws = [(x + y) / 2 for x, y in zip(draws["standard"][1], draws["bonuses"][1])]
    combined = {"games": a["games"] + b["games"], "deals": a["deals"] + b["deals"],
                "wins": a["wins"] + b["wins"], "ties": a["ties"] + b["ties"], "losses": a["losses"] + b["losses"],
                "meanLead": (a["meanLead"] + b["meanLead"]) / 2, "meanLeadCI95": interval(margin_draws),
                "matchScore": (a["matchScore"] + b["matchScore"]) / 2, "matchScoreCI95": interval(score_draws)}
    summary["combined5x5"] = combined
    print("combined5x5:", json.dumps(combined))

(folder / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
