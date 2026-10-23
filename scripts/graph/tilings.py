# Domino tilings (perfect matchings) of the 5x5 kingdom with the castle on each square, by dynamic
# programming over a broken profile: how many complete kingdoms each final castle position allows.
#   python3 scripts/graph/tilings.py [tilings.json]
import json
import sys
from functools import lru_cache


def tilings(rows, cols, blocked):
    @lru_cache(None)
    def go(i, mask):  # i: the next cell, row-major; bit k of mask: cell i + k already covered
        if i == rows * cols:
            return 1 if mask == 0 else 0
        r, c = divmod(i, cols)
        if (r, c) in blocked:
            return 0 if mask & 1 else go(i + 1, mask >> 1)
        if mask & 1:
            return go(i + 1, mask >> 1)
        total = 0
        if c + 1 < cols and not mask & 2 and (r, c + 1) not in blocked:  # lying along the row
            total += go(i + 2, mask >> 2)
        if r + 1 < rows and (r + 1, c) not in blocked:  # standing across the next row
            total += go(i + 1, (mask | (1 << cols)) >> 1)
        return total
    return go(0, 0)


grid = [[tilings(5, 5, frozenset({(r, c)})) for c in range(5)] for r in range(5)]
for row in grid:
    print(row)
print('4x6, no castle (known value 281):', tilings(4, 6, frozenset()))
print('7x7, castle in the centre:', tilings(7, 7, frozenset({(3, 3)})))
json.dump(grid, open(sys.argv[1] if len(sys.argv) > 1 else 'tilings.json', 'w'))
