import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOTTLE, isCutscene, MODULE, RAM, readSnapshot, zoneOf } from '../../src/shared/alttp.js';

function wram(write: (w: Uint8Array) => void = () => {}) {
  const w = new Uint8Array(0x20000);
  w[RAM.module] = MODULE.overworld;
  w[RAM.linkX] = 0x34;
  w[RAM.linkX + 1] = 0x12;
  w[RAM.linkY] = 0x78;
  w[RAM.linkY + 1] = 0x06;
  w[RAM.health] = 20;
  w[RAM.maxHealth] = 24;
  w[RAM.rupees] = 0xe7;
  w[RAM.rupees + 1] = 0x03;
  w[RAM.bombUpgrades] = 2;
  w[RAM.arrowUpgrades] = 7;
  w[RAM.bottles] = BOTTLE.fairy;
  write(w);
  return w;
}

test('readSnapshot decodes little-endian words and inventory', () => {
  const s = readSnapshot(wram());
  assert.equal(s.x, 0x1234);
  assert.equal(s.y, 0x0678);
  assert.equal(s.health, 20);
  assert.equal(s.inventory.rupees, 999);
  assert.equal(s.inventory.maxBombs, 20);
  assert.equal(s.inventory.maxArrows, 70);
  assert.deepEqual(s.inventory.bottles, [BOTTLE.fairy, 0, 0, 0]);
});

test('cutscene detection', () => {
  assert.equal(isCutscene(readSnapshot(wram())), false);
  assert.equal(isCutscene(readSnapshot(wram((w) => (w[RAM.module] = MODULE.text)))), true, 'dialog/menu');
  assert.equal(isCutscene(readSnapshot(wram((w) => (w[RAM.submodule] = 3)))), true, 'transition');
  assert.equal(isCutscene(readSnapshot(wram((w) => (w[RAM.freeze] = 1)))), true, 'frozen');
  assert.equal(isCutscene(readSnapshot(wram((w) => (w[RAM.linkState] = 0x16)))), true, 'asleep in bed');
  assert.equal(isCutscene(readSnapshot(wram((w) => (w[RAM.module] = 1)))), true, 'file select');
});

test('zones split overworlds and underworld rooms', () => {
  assert.equal(zoneOf(readSnapshot(wram())), 'ow:0');
  assert.equal(zoneOf(readSnapshot(wram((w) => (w[RAM.overworldArea] = 0x43)))), 'ow:1');
  const inside = readSnapshot(
    wram((w) => {
      w[RAM.module] = MODULE.underworld;
      w[RAM.indoors] = 1;
      w[RAM.room] = 0x04;
      w[RAM.room + 1] = 0x01;
    }),
  );
  assert.equal(zoneOf(inside), 'uw:104');
  assert.equal(zoneOf(readSnapshot(wram((w) => (w[RAM.module] = 0x05)))), 'limbo');
});
