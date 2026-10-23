import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dpadAngle, dpadDirections } from '../src/ui/touch.js';

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

test('the indicator points at all 8 directions', () => {
  const angle = (dx: number, dy: number) => dpadAngle(dpadDirections(dx, dy, 100));
  assert.equal(angle(0, -80), 0);
  assert.equal(angle(60, -60), 45);
  assert.equal(angle(80, 0), 90);
  assert.equal(angle(60, 60), 135);
  assert.equal(angle(0, 80), 180);
  assert.equal(angle(-60, 60), 225);
  assert.equal(angle(-80, 0), 270);
  assert.equal(angle(-60, -60), 315);
  assert.equal(angle(5, 5), undefined);
});
