import assert from 'node:assert/strict';

/** Narrows away undefined with a readable failure instead of a non-null assertion. */
export function defined<T>(value: T | undefined | null, what = 'value'): T {
  assert.ok(value !== undefined && value !== null, `expected ${what} to be defined`);
  return value;
}
