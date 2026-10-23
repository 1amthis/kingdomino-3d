# Summaries of the graph study's runs: the solo comparison against the clairvoyant optimum, and the
# Hard against Hard-with-matching duels.
#   python3 scripts/graph/summarize.py solo solo.jsonl
#   python3 scripts/graph/summarize.py duel duel.jsonl
import json
import math
import statistics as st
import sys


def solo(recs):
    o = [r['oracle'] for r in recs]
    opt = [x['optimum'] if x['optimum'] is not None else x['best'] for x in o]
    ms = sorted(x['ms'] for x in o)
    n = len(recs)
    print(f'{n} sequences, optimum proven for {sum(x["optimum"] is not None for x in o)}')
    print(f'exact solver: median {ms[n // 2]} ms, 90th percentile {ms[int(0.9 * n)]} ms, max {ms[-1]} ms, '
          f'max nodes {max(x["nodes"] for x in o)}')
    print(f'optimum (best found when unproven): mean {st.mean(opt):.2f}, range {min(opt)}-{max(opt)}')
    slack = [x['rootBound'] - v for x, v in zip(o, opt)]
    print(f'optimum equals the bound "each terrain in one piece" in {slack.count(0)}, within 1 point in '
          f'{sum(s <= 1 for s in slack)}; beam search alone finds it in '
          f'{sum(x["optimum"] is not None and x["beam"] == x["optimum"] for x in o)}')
    print(f'{"policy":13s} {"mean":>5s} {"se":>5s} {"gap":>5s} {"% opt":>6s} {"full":>5s} {"disc":>5s} {"ms":>6s}')
    for a in recs[0]['agents']:
        s = [r['agents'][a]['score'] for r in recs]
        print(f'{a:13s} {st.mean(s):5.1f} {st.pstdev(s) / math.sqrt(n):5.2f} {st.mean(v - x for v, x in zip(opt, s)):5.1f} '
              f'{100 * sum(s) / sum(opt):5.1f}% {100 * sum(r["agents"][a]["complete"] for r in recs) / n:4.0f}% '
              f'{sum(r["agents"][a]["discards"] for r in recs) / n:5.2f} {st.mean(r["agents"][a]["ms"] for r in recs):6.0f}')
    print('paired differences (mean ± standard error):')
    for a, b in [('graph', 'greedy'), ('graph', 'hard'), ('hardMatching', 'hard'), ('mce200', 'graph'), ('mce200', 'mce50')]:
        d = [r['agents'][a]['score'] - r['agents'][b]['score'] for r in recs]
        print(f'  {a} - {b}: {st.mean(d):+.2f} ± {st.pstdev(d) / math.sqrt(n):.2f}')


def duel(recs):
    wins = losses = ties = full_g = full_h = 0
    margins, per_deal = [], []
    for r in recs:
        deal = 0
        for g in r['games']:
            mine = next(p for p in g if p['type'] == 'hardG')
            theirs = next(p for p in g if p['type'] == 'hard')
            wins += mine['place'] < theirs['place']
            losses += mine['place'] > theirs['place']
            ties += mine['place'] == theirs['place']
            margins.append(mine['total'] - theirs['total'])
            deal += mine['total'] - theirs['total']
            full_g += mine['complete']
            full_h += theirs['complete']
        per_deal.append(deal / 2)
    n = len(margins)
    diverged = sum([p['total'] for p in r['games'][0]] != [p['total'] for p in r['games'][1]] for r in recs)
    print(f'{len(recs)} deals, {n} games: matching variant {wins} wins, {losses} losses, {ties} ties '
          f'({100 * (wins + ties / 2) / n:.1f}%)')
    print(f'lead per game {st.mean(margins):+.2f} ± {st.pstdev(per_deal) / math.sqrt(len(per_deal)):.2f} (paired by deal)')
    print(f'complete kingdoms: {100 * full_g / n:.1f}% against {100 * full_h / n:.1f}%; '
          f'the two games of a deal differ in {diverged} deals')


kind, path = sys.argv[1], sys.argv[2]
records = [json.loads(line) for line in open(path) if line.strip()]
{'solo': solo, 'duel': duel}[kind](records)
