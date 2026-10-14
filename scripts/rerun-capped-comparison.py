"""Rerun every time-capped deal pair at fixed simulation count, preserving the primary run.

Usage: python scripts/rerun-capped-comparison.py primary/duel.jsonl --old ../baseline \
    --output sensitivity/duel.jsonl --parts /absolute/scratch/reruns
"""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=pathlib.Path)
parser.add_argument('--old', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
parser.add_argument('--parts', required=True, type=pathlib.Path)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent.parent
source = args.source.read_bytes()
rows = [json.loads(line) for line in source.splitlines()]
meta, complete = rows[0], rows[-1]
games = [r for r in rows if r['type'] == 'game']
assert meta['type'] == 'metadata' and complete['type'] == 'complete'
assert complete['games'] == len(games) == meta['deals'] * meta['rules']['players'] * (meta['rules']['players'] - 1)
assert not args.output.exists(), 'refusing to overwrite sensitivity evidence'
for path, revision in [(root, meta['newRevision']), (args.old, meta['oldRevision'])]:
    actual = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
    assert actual == revision, f'engine revision changed: {path}'
affected = sorted({g['dealSeed'] for g in games if any(g['stats'][r]['limited'] for r in ['old', 'new'])})
print(f'Rerunning both/all seat assignments for {len(affected)} capped deals', flush=True)
args.parts.mkdir(parents=True, exist_ok=True)
t0 = time.monotonic()


def rerun(seed):
    path = args.parts / f"{meta['mode']}-{seed}.jsonl"
    subprocess.run(['node', str(root / 'scripts/compare-experts.js'), '--old', str(args.old.resolve()),
                    '--new', str(root), '--mode', meta['mode'], '--seed', str(seed), '--deals', '1',
                    '--sims', str(meta['sims']), '--ms', '1000000000', '--threads', '2',
                    '--output', str(path.resolve())], cwd=root, check=True, capture_output=True, text=True)
    result = [json.loads(line) for line in path.read_text().splitlines()]
    assert result[-1]['type'] == 'complete'
    batch = [r for r in result if r['type'] == 'game']
    assert len(batch) == meta['rules']['players'] * (meta['rules']['players'] - 1)
    assert not any(g['stats'][r]['limited'] for g in batch for r in ['old', 'new'])
    print(f'Fixed-simulation rerun complete: deal {seed}', flush=True)
    return batch


with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    replacements = {(g['dealSeed'], g['newSeat'], g['oldSeat']): g
                    for batch in pool.map(rerun, affected) for g in batch}
corrected = []
for original in games:
    key = (original['dealSeed'], original['newSeat'], original['oldSeat'])
    game = replacements.get(key, original).copy()
    if key in replacements:
        game['timingExcluded'] = True
    corrected.append(game)
metadata = {**meta, 'ms': 1000000000, 'sensitivity': {
    'method': 'Both/all seat assignments rerun for every deal with any capped decision; other searches already completed the full simulation budget',
    'sourceFile': str(args.source), 'sourceSHA256': hashlib.sha256(source).hexdigest(),
    'originalTimeCapMs': meta['ms'], 'rerunDeals': affected, 'rerunGames': len(replacements),
    'rerunConcurrentDeals': 2, 'threadsPerRerunDeal': 2,
    'timing': 'Rerun games excluded; unaffected primary games retained for timing only'}}
completion = {**complete, 'rerunWallSeconds': time.monotonic() - t0}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text('\n'.join(json.dumps(r, separators=(',', ':')) for r in [metadata, *corrected, completion]) + '\n')
print(f'Preserved {args.source}; wrote fixed-simulation sensitivity to {args.output}', flush=True)
