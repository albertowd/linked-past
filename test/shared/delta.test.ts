import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDelta, DeltaStream } from '../../src/shared/delta.js';

type Item = { id: string; x: number };

test('first call is a full keyframe, then only changes', () => {
  const s = new DeltaStream<Item>(30_000);
  assert.deepEqual(s.next([{ id: 'a', x: 1 }], 0), { players: [{ id: 'a', x: 1 }], gone: [], full: true });
  assert.equal(s.next([{ id: 'a', x: 1 }], 50), undefined, 'nothing changed: nothing sent');
  assert.deepEqual(
    s.next(
      [
        { id: 'a', x: 2 },
        { id: 'b', x: 0 },
      ],
      100,
    ),
    {
      players: [
        { id: 'a', x: 2 },
        { id: 'b', x: 0 },
      ],
      gone: [],
    },
  );
  assert.deepEqual(s.next([{ id: 'b', x: 0 }], 150), { players: [], gone: ['a'] });
});

test('keyframe every interval even without changes, and on reset', () => {
  const s = new DeltaStream<Item>(30_000);
  s.next([{ id: 'a', x: 1 }], 0);
  assert.equal(s.next([{ id: 'a', x: 1 }], 29_999), undefined);
  assert.equal(s.next([{ id: 'a', x: 1 }], 30_000)?.full, true);
  s.reset();
  assert.equal(s.next([{ id: 'a', x: 1 }], 30_001)?.full, true);
});

test('applyDelta converges to the sender state', () => {
  const sender = new DeltaStream<Item>(30_000);
  const known = new Map<string, Item>();
  const frames = [
    [{ id: 'a', x: 1 }],
    [
      { id: 'a', x: 1 },
      { id: 'b', x: 5 },
    ],
    [{ id: 'b', x: 6 }],
    [],
  ];
  frames.forEach((items, i) => {
    const d = sender.next(items, i * 100);
    if (d) applyDelta(known, d);
    assert.deepEqual([...known.values()], items, `frame ${i}`);
  });
  applyDelta(known, { players: [{ id: 'z', x: 0 }], gone: [], full: true });
  assert.deepEqual([...known.keys()], ['z'], 'full replaces everything');
});
