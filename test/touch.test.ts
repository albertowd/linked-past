import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dpadDirections } from '../src/ui/touch.js';

const dirs = (dx: number, dy: number) => [...dpadDirections(dx, dy, 100)].sort();

test('cardinal directions', () => {
  assert.deepEqual(dirs(80, 0), ['RIGHT']);
  assert.deepEqual(dirs(-80, 0), ['LEFT']);
  assert.deepEqual(dirs(0, -80), ['UP']);
  assert.deepEqual(dirs(0, 80), ['DOWN']);
});

test('diagonals press two directions', () => {
  assert.deepEqual(dirs(60, 60), ['DOWN', 'RIGHT']);
  assert.deepEqual(dirs(-60, -60), ['LEFT', 'UP']);
  assert.deepEqual(dirs(60, -60), ['RIGHT', 'UP']);
  assert.deepEqual(dirs(-60, 60), ['DOWN', 'LEFT']);
});

test('dead zone in the middle and sector edges', () => {
  assert.deepEqual(dirs(5, 5), []);
  assert.deepEqual(dirs(80, 25), ['RIGHT'], '17° stays cardinal');
  assert.deepEqual(dirs(80, 45), ['DOWN', 'RIGHT'], '29° is diagonal');
});
