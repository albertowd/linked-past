import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROM_SIZE, ROMS, romBySha1, stripHeader } from '../../src/shared/rom.js';

test('every supported dump maps to a locale and frame rate', () => {
  assert.equal(ROMS.length, 6);
  assert.equal(romBySha1('6D4F10A8B10E10DBE624CB23CF03B88BB8252973')?.region, 'usa');
  assert.equal(romBySha1('229364a1b92a05167cd38609b1aa98f7041987cc')?.locale, 'fr');
  assert.equal(romBySha1('2e62494967fb0afdf5da1635607f9641df7c6559')?.fps, 50.007);
  assert.equal(romBySha1('0000'), undefined);
});

test('copier headers are stripped, clean dumps untouched', () => {
  const clean = new Uint8Array(ROM_SIZE);
  assert.equal(stripHeader(clean), clean);
  const headered = new Uint8Array(ROM_SIZE + 0x200);
  headered[0x200] = 0xaa;
  const out = stripHeader(headered);
  assert.equal(out.length, ROM_SIZE);
  assert.equal(out[0], 0xaa);
});
