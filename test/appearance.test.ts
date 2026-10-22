import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hexToRgb, LINK_ROW, LinkPalette, recolor, SKIN, TUNIC } from '../src/game/appearance.js';
import { bgr555, MODULE, RAM } from '../src/shared/index.js';

// USA green-mail Link row as read from the running game.
const GREEN = [
  0x0000, 0x7fff, 0x237e, 0x11b7, 0x369e, 0x14a5, 0x01ff, 0x1078, 0x599d, 0x3647, 0x3b68, 0x0a4a, 0x12ef, 0x2a5c,
  0x1571, 0x7a18,
];

function wram(row = GREEN) {
  const w = new Uint8Array(0x20000);
  w[RAM.module] = MODULE.overworld;
  row.forEach((c, i) => {
    w[LINK_ROW + i * 2] = c & 0xff;
    w[LINK_ROW + i * 2 + 1] = c >> 8;
  });
  return w;
}
const rowOf = (w: Uint8Array) =>
  Array.from({ length: 16 }, (_, i) => w[LINK_ROW + i * 2] | (w[LINK_ROW + i * 2 + 1] << 8));

test('recolor keeps the shading order and takes the hue of the pick', () => {
  const tunic = TUNIC.map((i) => GREEN[i]);
  const red = recolor(tunic, '#d02020');
  const light = (c: number) => bgr555(c).reduce((a, b) => a + b, 0);
  const order = (cs: number[]) =>
    cs
      .map((c, i) => [light(c), i])
      .sort((a, b) => a[0] - b[0])
      .map((x) => x[1]);
  assert.deepEqual(order(red), order(tunic), 'darkest stays darkest');
  for (const c of red) {
    const [r, g, b] = bgr555(c);
    assert.ok(r >= g && r >= b, 'red dominant');
  }
  assert.deepEqual(recolor(tunic, 'nope'), tunic);
  assert.deepEqual(hexToRgb('#0a0b0c'), [10, 11, 12]);
});

test('only tunic and skin entries change, and the game is asked to upload', () => {
  const w = wram();
  const pal = new LinkPalette();
  pal.set({ tunic: '#2050e0', skin: '#8a5a3a' });
  assert.equal(pal.apply(w), true);
  assert.equal(w[0x0015], 1, 'palette upload requested');
  const row = rowOf(w);
  row.forEach((c, i) => {
    if (TUNIC.includes(i) || SKIN.includes(i)) assert.notEqual(c, GREEN[i], `entry ${i} recolored`);
    else assert.equal(c, GREEN[i], `entry ${i} untouched`);
  });
  w[0x0015] = 0;
  assert.equal(pal.apply(w), false, 'nothing to do once applied');
});

test('effects are left alone, reloads are recolored, and reset restores originals', () => {
  const w = wram();
  const pal = new LinkPalette();
  pal.set({ tunic: '#e02020' });
  pal.apply(w);
  // The game flashes entry 9 white: not ours, so we do not fight it.
  w[LINK_ROW + 9 * 2] = 0xff;
  w[LINK_ROW + 9 * 2 + 1] = 0x7f;
  pal.apply(w);
  assert.equal(rowOf(w)[9], 0x7fff);
  // The game reloads the original row (e.g. new screen): recolored again.
  const fresh = wram();
  pal.apply(fresh);
  assert.notEqual(rowOf(fresh)[10], GREEN[10]);
  // Clearing the color puts the originals back.
  pal.set({});
  pal.apply(fresh);
  assert.deepEqual(rowOf(fresh), GREEN);
});

test('never learns or paints while a bunny or outside gameplay', () => {
  const w = wram();
  w[0x02e0] = 1;
  const pal = new LinkPalette();
  pal.set({ tunic: '#e02020' });
  assert.equal(pal.apply(w), false);
  w[0x02e0] = 0;
  w[RAM.module] = 0x0e;
  assert.equal(pal.apply(w), false);
});
