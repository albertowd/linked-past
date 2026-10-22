import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bgr555, isValidPose, packPixels, poseHash, unpackPixels } from '../../src/shared/pose.js';
import type { PoseData } from '../../src/shared/protocol.js';

function pose(over: Partial<Omit<PoseData, 'hash'>> = {}): PoseData {
  const px = new Uint8Array(16 * 24);
  px.fill(0x71, 40, 120);
  const base = { w: 16, h: 24, ox: -1, oy: 0, px: packPixels(px), pals: { 7: Array(16).fill(0x7fff) }, ...over };
  return { ...base, hash: poseHash(base) };
}

test('RLE round-trips sparse and dense pixel data', () => {
  for (const data of [
    new Uint8Array(0),
    new Uint8Array(1000),
    Uint8Array.from({ length: 777 }, (_, i) => (i * 37) & 0xff),
    Uint8Array.from({ length: 600 }, (_, i) => (i % 300 < 260 ? 5 : i)),
  ]) {
    assert.deepEqual(unpackPixels(packPixels(data), data.length), data);
  }
});

test('unpack never writes past the requested size', () => {
  const packed = packPixels(new Uint8Array(500).fill(3));
  assert.equal(unpackPixels(packed, 10).length, 10);
});

test('hash is content-addressed', () => {
  assert.equal(pose().hash, pose().hash);
  assert.notEqual(pose().hash, pose({ ox: 0 }).hash);
  assert.match(pose().hash, /^[0-9a-f]{16}$/);
});

test('isValidPose accepts a well-formed pose and rejects tampering', () => {
  assert.equal(isValidPose(pose()), true);
  assert.equal(isValidPose({ ...pose(), ox: 3 }), false, 'hash mismatch');
  assert.equal(isValidPose(pose({ w: 0 })), false);
  assert.equal(isValidPose(pose({ w: 65 })), false);
  assert.equal(isValidPose(pose({ ox: 1.5 })), false);
  assert.equal(isValidPose(pose({ pals: { 8: Array(16).fill(0) } })), false, 'palette row out of range');
  assert.equal(isValidPose(pose({ pals: { 7: [1, 2, 3] } })), false, 'short palette');
  assert.equal(isValidPose(pose({ px: 'A'.repeat(9000) })), false, 'oversized payload');
  assert.equal(isValidPose(null as unknown as PoseData), false);
});

test('bgr555 expands 5-bit channels to full range', () => {
  assert.deepEqual(bgr555(0x0000), [0, 0, 0]);
  assert.deepEqual(bgr555(0x7fff), [255, 255, 255]);
  assert.deepEqual(bgr555(0x001f), [255, 0, 0]);
  assert.deepEqual(bgr555(0x7c00), [0, 0, 255]);
});
