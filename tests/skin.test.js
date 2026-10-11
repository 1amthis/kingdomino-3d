// The skins: Halloween comes with October, and a player's pick holds for the season it was made in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { season, seasonal, pick } from '../src/skins/index.js';

const day = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

test('Halloween runs from the first of October to the night after Halloween', () => {
  assert.equal(seasonal(day(2026, 9, 30, 23)), 'classic');
  assert.equal(seasonal(day(2026, 10, 1, 0)), 'halloween');
  assert.equal(seasonal(day(2026, 10, 31, 23)), 'halloween');
  assert.equal(seasonal(day(2026, 11, 1, 2)), 'halloween');
  assert.equal(seasonal(day(2026, 11, 2, 0)), 'classic');
  assert.equal(seasonal(day(2027, 3, 14)), 'classic');
});

test('every season has a name of its own', () => {
  assert.equal(season(day(2026, 10, 11)), 'halloween-2026');
  assert.equal(season(day(2026, 11, 1)), 'halloween-2026');
  // the off-season is named after the Halloween it leads to, across the new year
  assert.equal(season(day(2026, 11, 2)), 'classic-2027');
  assert.equal(season(day(2027, 1, 1)), 'classic-2027');
  assert.equal(season(day(2027, 9, 30)), 'classic-2027');
  assert.equal(season(day(2027, 10, 1)), 'halloween-2027');
});

test('a pick holds for its season, then the season decides again', () => {
  const october = day(2026, 10, 11);
  assert.equal(pick({}, october), 'halloween');
  assert.equal(pick(null, october), 'halloween');
  // Classic picked this October stays classic until the season turns...
  const classic = { skin: 'classic', skinSeason: season(october) };
  assert.equal(pick(classic, day(2026, 10, 31)), 'classic');
  assert.equal(pick(classic, day(2026, 12, 1)), 'classic');
  // ...and next October brings Halloween back
  assert.equal(pick(classic, day(2027, 10, 1)), 'halloween');
  // Halloween picked in spring lasts the off-season, then goes with the pumpkins
  const spring = day(2027, 4, 1);
  const spooky = { skin: 'halloween', skinSeason: season(spring) };
  assert.equal(pick(spooky, spring), 'halloween');
  assert.equal(pick(spooky, day(2027, 10, 15)), 'halloween');
  assert.equal(pick(spooky, day(2027, 11, 2)), 'classic');
});

test('a pick that is not a skin, or has no season, is ignored', () => {
  const march = day(2027, 3, 1);
  assert.equal(pick({ skin: 'christmas', skinSeason: season(march) }, march), 'classic');
  assert.equal(pick({ skin: 'halloween' }, march), 'classic');
});
