import assert from 'node:assert/strict';
import { test } from 'node:test';
import json from '../../src/shared/data/rom-challenges.json' with { type: 'json' };
import { ROMS } from '../../src/shared/rom.js';
import { type ChallengeTable, checkProof, createProof, proofRanges } from '../../src/shared/romProof.js';

const table = json as unknown as ChallengeTable;

import { defined } from './helpers.js';

const USA = '6d4f10a8b10e10dbe624cb23cf03b88bb8252973';

test('challenges cover every supported ROM', () => {
  assert.equal(Object.keys(table).length, ROMS.length);
});

test('a proof needs the exact digests in order', () => {
  const proof = defined(createProof(table, USA), 'proof');
  const ranges = proofRanges(proof);
  assert.equal(ranges.length, 4);
  for (const r of ranges) assert.ok(r.offset >= 0 && r.offset + r.length <= 0x100000);
  const right = proof.entries.map(([, , sha]) => sha);
  assert.equal(checkProof(proof, right), true);
  assert.equal(
    checkProof(
      proof,
      right.map((d) => d.toUpperCase()),
    ),
    true,
    'hex case-insensitive',
  );
  assert.equal(checkProof(proof, [...right.slice(0, 3), '0'.repeat(64)]), false, 'one wrong digest');
  assert.equal(checkProof(proof, right.slice(1)), false);
  assert.equal(checkProof(proof, 'nope'), false);
  assert.equal(checkProof(proof, [1, 2, 3, 4]), false);
});

test('unknown ROMs get no challenge', () => {
  assert.equal(createProof(table, 'deadbeef'), undefined);
});
