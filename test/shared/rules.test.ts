import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOTTLE, Direction, type Inventory } from '../../src/shared/alttp.js';
import {
  applyLines,
  canFight,
  canGive,
  canReceive,
  describeLine,
  isValidLine,
  knockback,
  swordDamage,
  swordReaches,
} from '../../src/shared/rules.js';

const inv = (over: Partial<Inventory> = {}): Inventory => ({
  rupees: 100,
  bombs: 5,
  maxBombs: 10,
  arrows: 10,
  maxArrows: 30,
  bottles: [BOTTLE.redPotion, BOTTLE.empty, BOTTLE.none, BOTTLE.none],
  ...over,
});

test('sword reach follows facing direction', () => {
  assert.equal(swordReaches(100, 100, Direction.Right, 120, 100), true);
  assert.equal(swordReaches(100, 100, Direction.Left, 120, 100), false);
  assert.equal(swordReaches(100, 100, Direction.Down, 100, 140), false);
  assert.equal(swordReaches(100, 100, Direction.Down, 100, 120), true);
});

test('mail reduces damage but never to zero', () => {
  assert.equal(swordDamage(1, 0), 4);
  assert.equal(swordDamage(1, 2), 1);
  assert.equal(swordDamage(2, 1), 4);
});

test('trade validation', () => {
  assert.equal(canGive(inv(), [{ item: 'rupees', qty: 100 }]), true);
  assert.equal(canGive(inv(), [{ item: 'rupees', qty: 101 }]), false);
  assert.equal(canGive(inv(), [{ item: 'bottle', content: BOTTLE.fairy }]), false);
  assert.equal(canReceive(inv(), [{ item: 'bombs', qty: 6 }]), false);
  assert.equal(canReceive(inv(), [{ item: 'bottle', content: BOTTLE.fairy }]), true);
  // giving the potion frees a second empty bottle
  assert.equal(
    canReceive(
      inv(),
      [
        { item: 'bottle', content: BOTTLE.fairy },
        { item: 'bottle', content: BOTTLE.bee },
      ],
      [{ item: 'bottle', content: BOTTLE.redPotion }],
    ),
    true,
  );
  const after = applyLines(
    inv(),
    [
      { item: 'bottle', content: BOTTLE.redPotion },
      { item: 'rupees', qty: 40 },
    ],
    -1,
  );
  assert.deepEqual(after.bottles.slice(0, 2), [BOTTLE.empty, BOTTLE.empty]);
  assert.equal(after.rupees, 60);
});

test('spin attack hits all around and doubles damage', () => {
  assert.equal(swordReaches(100, 100, Direction.Up, 100, 125, true), true);
  assert.equal(swordReaches(100, 100, Direction.Up, 100, 140, true), false);
  assert.equal(swordDamage(1, 0, true), 8);
  assert.equal(swordDamage(4, 0), 16);
  assert.equal(swordDamage(9, -1), 16, 'inputs are clamped');
});

test('knockback pushes along the swing', () => {
  assert.deepEqual(knockback(Direction.Up), { kx: 0, ky: -32 });
  assert.deepEqual(knockback(Direction.Down), { kx: 0, ky: 32 });
  assert.deepEqual(knockback(Direction.Left), { kx: -32, ky: 0 });
  assert.deepEqual(knockback(Direction.Right), { kx: 32, ky: 0 });
});

test('only link mode fights', () => {
  assert.equal(canFight('link'), true);
  assert.equal(canFight('zelda'), false);
});

test('line validation and labels', () => {
  assert.equal(isValidLine({ item: 'rupees', qty: 1 }), true);
  assert.equal(isValidLine({ item: 'rupees', qty: 0 }), false);
  assert.equal(isValidLine({ item: 'bombs', qty: 2.5 }), false);
  assert.equal(isValidLine({ item: 'arrows', qty: 1000 }), false);
  assert.equal(isValidLine({ item: 'bottle', content: BOTTLE.empty }), false, 'empty bottles are not tradable');
  assert.equal(isValidLine({ item: 'bottle', content: BOTTLE.fairy }), true);
  assert.equal(describeLine({ item: 'bombs', qty: 3 }), '3 bombs');
  assert.equal(describeLine({ item: 'bottle', content: BOTTLE.goodBee }), 'good bee');
});

test('capacity limits on receive', () => {
  assert.equal(canReceive(inv({ rupees: 990 }), [{ item: 'rupees', qty: 10 }]), false);
  assert.equal(canReceive(inv(), [{ item: 'arrows', qty: 20 }]), true);
  assert.equal(canReceive(inv(), [{ item: 'arrows', qty: 21 }]), false);
  assert.equal(
    canReceive(inv({ bottles: [BOTTLE.fairy, BOTTLE.bee, 0, 0] }), [{ item: 'bottle', content: BOTTLE.fairy }]),
    false,
    'no empty bottle',
  );
});
