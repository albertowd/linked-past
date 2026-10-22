import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeGlyph, tile2bpp } from '../src/game/harvest.js';

test('tile2bpp decodes bitplanes and flips', () => {
  const vram = new Uint8Array(64);
  vram[0] = 0b1000_0000; // plane 0, row 0: leftmost pixel
  vram[1] = 0b1000_0001; // plane 1, row 0: leftmost and rightmost
  const px = tile2bpp(vram, 0, 0);
  assert.equal(px[0], 3);
  assert.equal(px[7], 2);
  assert.equal(px[8], 0);
  const flipped = tile2bpp(vram, 0, 0, true, true);
  assert.equal(flipped[63], 3, 'h+v flip moves (0,0) to (7,7)');
});

test('normalizeGlyph removes the filled cell and ranks strokes by brightness', () => {
  // Menu style: background 3, stroke 2 (region-dependent indices).
  const menu = [3, 3, 2, 2, 3, 3, 3, 3, ...Array(56).fill(3)];
  assert.deepEqual(normalizeGlyph(menu, (v) => v).slice(0, 4), [0, 0, 1, 1]);
  // HUD digit style: transparent background, bright stroke 1, dark outline 3.
  const digit = [0, 1, 3, 0, ...Array(60).fill(0)];
  const lum = (v: number) => [0, 900, 300, 10][v];
  assert.deepEqual(normalizeGlyph(digit, lum).slice(0, 3), [0, 1, 3]);
});
