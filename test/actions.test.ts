import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyHit, credit, debit } from '../src/game/actions.js';
import { BOTTLE, RAM } from '../src/shared/index.js';
import { fakeCore } from './fakeCore.js';

test('a hit queues game damage and knockback', () => {
  const { core, wram } = fakeCore();
  assert.equal(applyHit(core, 4, -32, 0), true);
  assert.equal(wram[RAM.pendingDamage], 4);
  assert.equal(wram[RAM.recoilX], 0xe0, 'signed byte');
  assert.equal(wram[RAM.recoilState], 1);
});

test('no damage during cutscenes, i-frames, or when already down', () => {
  for (const setup of [
    (w: Uint8Array) => (w[RAM.module] = 0x0e),
    (w: Uint8Array) => (w[RAM.invincibility] = 10),
    (w: Uint8Array) => (w[RAM.health] = 0),
  ]) {
    const { core, wram } = fakeCore();
    setup(wram);
    assert.equal(applyHit(core, 4, 0, 0), false);
    assert.equal(wram[RAM.pendingDamage], 0);
  }
});

test('debit pays, credit receives, both write the save mirror', () => {
  const { core, wram } = fakeCore();
  wram[RAM.rupees] = 100;
  wram[RAM.bottles] = BOTTLE.fairy;
  wram[RAM.bottles + 1] = BOTTLE.empty;
  assert.equal(
    debit(
      core,
      [
        { item: 'bottle', content: BOTTLE.fairy },
        { item: 'rupees', qty: 30 },
      ],
      [{ item: 'bombs', qty: 5 }],
    ),
    true,
  );
  assert.equal(wram[RAM.rupees], 70);
  assert.equal(wram[RAM.bottles], BOTTLE.empty);
  credit(core, [
    { item: 'bombs', qty: 5 },
    { item: 'bottle', content: BOTTLE.bee },
  ]);
  assert.equal(wram[RAM.bombs], 5);
  assert.equal(wram[RAM.bottles], BOTTLE.bee);
});

test('debit refuses what you cannot pay or hold', () => {
  const { core, wram } = fakeCore();
  wram[RAM.rupees] = 10;
  assert.equal(debit(core, [{ item: 'rupees', qty: 11 }], []), false);
  assert.equal(debit(core, [], [{ item: 'bombs', qty: 11 }]), false, 'over capacity');
  assert.equal(wram[RAM.rupees], 10, 'nothing written');
});

test('credit clamps to capacity', () => {
  const { core, wram } = fakeCore();
  wram[RAM.rupees] = 0xe0;
  wram[RAM.rupees + 1] = 0x03; // 992
  credit(core, [
    { item: 'rupees', qty: 50 },
    { item: 'arrows', qty: 99 },
  ]);
  assert.equal(wram[RAM.rupees] | (wram[RAM.rupees + 1] << 8), 999);
  assert.equal(wram[RAM.arrows], 30);
});
