import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureLink } from '../src/game/capture.js';
import { RAM, readSnapshot, unpackPixels } from '../src/shared/index.js';
import { fakeCore } from './fakeCore.js';

function scene() {
  const f = fakeCore();
  // Link at world (300, 200) with the camera at (256, 128): screen (44, 72).
  f.wram[RAM.linkX] = 300 & 0xff;
  f.wram[RAM.linkX + 1] = 300 >> 8;
  f.wram[RAM.linkY] = 200;
  f.wram[RAM.cameraX] = 0x00;
  f.wram[RAM.cameraX + 1] = 0x01;
  f.wram[RAM.cameraY] = 128;
  // Tiles 0,1,16,17 solid color 1 (plane 0 set on every row).
  for (const t of [0, 1, 16, 17]) for (let y = 0; y < 8; y++) f.vram[0x8000 + t * 32 + y * 2] = 0xff;
  // OAM 0: 16x16 sprite, tile 0, palette 7, at Link's screen position.
  f.oam.set([44, 72, 0x00, 7 << 1], 0);
  f.oam[512] = 0b10; // large size for slot 0
  for (let i = 0; i < 16; i++) f.cgram[128 + 7 * 16 + i] = 0x1000 + i;
  return f;
}

test('captures Link from OAM/VRAM with palette indices and colors', () => {
  const f = scene();
  const pose = captureLink(f.core, readSnapshot(f.wram));
  assert.ok(pose);
  assert.equal(pose.w, 16);
  assert.equal(pose.h, 16);
  assert.deepEqual([pose.ox, pose.oy], [0, 0]);
  assert.ok(unpackPixels(pose.px, 256).every((v) => v === 0x71));
  assert.equal(pose.pals[7][1], 0x1001);
});

test('ignores other name tables, far sprites and blinking frames', () => {
  const f = scene();
  f.oam[3] |= 1; // second name table: enemy graphics
  assert.equal(captureLink(f.core, readSnapshot(f.wram)), null);
  const g = scene();
  g.oam[0] = 200; // 150px away from Link
  assert.equal(captureLink(g.core, readSnapshot(g.wram)), null);
});
