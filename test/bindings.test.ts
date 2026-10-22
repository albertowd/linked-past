import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bindKey,
  bindPad,
  DEFAULT_BINDINGS,
  DEFAULT_SETTINGS,
  keyLabel,
  keyMap,
  padLabel,
  sanitizeSettings,
} from '../src/emu/bindings.js';

test('defaults map every SNES button to a distinct key and pad button', () => {
  const keys = Object.values(DEFAULT_BINDINGS.keys);
  const pads = Object.values(DEFAULT_BINDINGS.pad);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(pads).size, pads.length);
  assert.equal(keyMap(DEFAULT_BINDINGS).get('KeyZ'), 'B');
});

test('rebinding a key steals it from the button that had it', () => {
  const b = bindKey(DEFAULT_BINDINGS, 'A', 'KeyZ');
  assert.equal(b.keys.A, 'KeyZ');
  assert.equal(b.keys.B, null, 'B lost Z');
  assert.equal(DEFAULT_BINDINGS.keys.B, 'KeyZ', 'defaults are not mutated');
  assert.equal(keyMap(b).get('KeyZ'), 'A');
  const p = bindPad(DEFAULT_BINDINGS, 'START', 0);
  assert.equal(p.pad.START, 0);
  assert.equal(p.pad.B, null);
});

test('stored settings are validated and merged with defaults', () => {
  assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings('garbage'), DEFAULT_SETTINGS);
  const s = sanitizeSettings({
    bindings: { keys: { B: 'Space', A: 'Escape', Y: 42 }, pad: { B: 7, A: -1, X: null } },
    touch: 'on',
    touchScale: 9,
  });
  assert.equal(s.bindings.keys.B, 'Space');
  assert.equal(s.bindings.keys.A, 'KeyX', 'reserved key rejected');
  assert.equal(s.bindings.keys.Y, 'KeyA', 'non-string rejected');
  assert.equal(s.bindings.pad.B, 7);
  assert.equal(s.bindings.pad.A, 1, 'negative index rejected');
  assert.equal(s.bindings.pad.X, null, 'explicitly unbound stays unbound');
  assert.equal(s.touch, 'on');
  assert.equal(s.touchScale, 1.5, 'clamped');
  assert.equal(sanitizeSettings({ touch: 'sometimes' }).touch, 'auto');
});

test('labels are readable', () => {
  assert.equal(keyLabel('KeyZ'), 'Z');
  assert.equal(keyLabel('ArrowUp'), '↑');
  assert.equal(keyLabel('Digit4'), '4');
  assert.equal(keyLabel('Numpad8'), 'Num 8');
  assert.equal(keyLabel('ShiftRight'), 'Right Shift');
  assert.equal(keyLabel(null), '—');
  assert.equal(padLabel(0), 'Bottom (A/✕)');
  assert.equal(padLabel(20), 'Button 20');
  assert.equal(padLabel(null), '—');
  assert.equal(keyLabel('ShiftLeft', { ShiftLeft: 'Umschalt links' }), 'Umschalt links', 'localized');
  assert.equal(padLabel(30, ['x'], 'Knopf'), 'Knopf 30');
});
