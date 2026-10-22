// Player-configurable controls: one keyboard key and one gamepad button per SNES button.
// Gamepad analog sticks always steer the D-pad on top of whatever is bound here.
import { BUTTON, type Button } from './core.js';

export const BUTTONS = Object.keys(BUTTON) as Button[];

export interface Bindings {
  keys: Record<Button, string | null>; // KeyboardEvent.code
  pad: Record<Button, number | null>; // Standard Gamepad button index
}

export type TouchMode = 'auto' | 'on' | 'off';

export interface ControlSettings {
  bindings: Bindings;
  touch: TouchMode;
  touchScale: number; // 0.75 .. 1.5
}

export const DEFAULT_BINDINGS: Bindings = {
  keys: {
    B: 'KeyZ',
    Y: 'KeyA',
    SELECT: 'ShiftRight',
    START: 'Enter',
    UP: 'ArrowUp',
    DOWN: 'ArrowDown',
    LEFT: 'ArrowLeft',
    RIGHT: 'ArrowRight',
    A: 'KeyX',
    X: 'KeyS',
    L: 'KeyQ',
    R: 'KeyW',
  },
  // Laid out like a SNES pad: B bottom, A right, Y left, X top.
  pad: { B: 0, A: 1, Y: 2, X: 3, L: 4, R: 5, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 },
};

export const DEFAULT_SETTINGS: ControlSettings = { bindings: DEFAULT_BINDINGS, touch: 'auto', touchScale: 1 };

/** Keys the page itself uses; binding them would break chat or the controls screen. */
export const RESERVED_KEYS = new Set(['Escape', 'KeyT', 'Slash', 'F1', 'Tab']);

const clone = (b: Bindings): Bindings => ({ keys: { ...b.keys }, pad: { ...b.pad } });

/** Binds a key to a button, unbinding it from any other button so one key never does two things. */
export function bindKey(b: Bindings, button: Button, code: string): Bindings {
  const next = clone(b);
  for (const other of BUTTONS) if (next.keys[other] === code) next.keys[other] = null;
  next.keys[button] = code;
  return next;
}

export function bindPad(b: Bindings, button: Button, index: number): Bindings {
  const next = clone(b);
  for (const other of BUTTONS) if (next.pad[other] === index) next.pad[other] = null;
  next.pad[button] = index;
  return next;
}

export function keyMap(b: Bindings): Map<string, Button> {
  const map = new Map<string, Button>();
  for (const button of BUTTONS) {
    const code = b.keys[button];
    if (code) map.set(code, button);
  }
  return map;
}

/** Accepts settings read back from storage, keeping only well-formed entries. */
export function sanitizeSettings(raw: unknown): ControlSettings {
  const r = (raw ?? {}) as Partial<ControlSettings>;
  const keys = { ...DEFAULT_BINDINGS.keys };
  const pad = { ...DEFAULT_BINDINGS.pad };
  for (const button of BUTTONS) {
    const k = r.bindings?.keys?.[button];
    if (k === null || (typeof k === 'string' && k.length <= 32 && !RESERVED_KEYS.has(k))) keys[button] = k;
    const p = r.bindings?.pad?.[button];
    if (p === null || (Number.isInteger(p) && (p as number) >= 0 && (p as number) < 32))
      pad[button] = p as number | null;
  }
  const touch = r.touch === 'on' || r.touch === 'off' ? r.touch : 'auto';
  const scale = typeof r.touchScale === 'number' ? Math.min(1.5, Math.max(0.75, r.touchScale)) : 1;
  return { bindings: { keys, pad }, touch, touchScale: scale };
}

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  MetaLeft: 'Left ⌘',
  MetaRight: 'Right ⌘',
  Space: 'Space',
  Enter: 'Enter',
  Backspace: 'Backspace',
};

/** Human name for a KeyboardEvent.code (layout-independent physical key); `names` localizes it. */
export function keyLabel(code: string | null, names: Record<string, string> = {}): string {
  if (!code) return '—';
  if (names[code]) return names[code];
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

const PAD_NAMES = [
  'Bottom (A/✕)',
  'Right (B/○)',
  'Left (X/□)',
  'Top (Y/△)',
  'LB',
  'RB',
  'LT',
  'RT',
  'Back / Select',
  'Start',
  'Left stick',
  'Right stick',
  'D-pad ↑',
  'D-pad ↓',
  'D-pad ←',
  'D-pad →',
  'Home',
];

export function padLabel(index: number | null, names: string[] = PAD_NAMES, button = 'Button'): string {
  if (index === null) return '—';
  return names[index] ?? `${button} ${index}`;
}
