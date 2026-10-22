import { type Bindings, BUTTONS, DEFAULT_BINDINGS, keyMap, RESERVED_KEYS } from './bindings.js';
import { BUTTON, type Button } from './core.js';

const AXIS_THRESHOLD = 0.5;

export type Captured = { kind: 'key'; code: string } | { kind: 'pad'; index: number } | { kind: 'cancel' };

function stickMask(pad: Gamepad): number {
  let mask = 0;
  const [x = 0, y = 0] = pad.axes;
  if (x < -AXIS_THRESHOLD) mask |= 1 << BUTTON.LEFT;
  if (x > AXIS_THRESHOLD) mask |= 1 << BUTTON.RIGHT;
  if (y < -AXIS_THRESHOLD) mask |= 1 << BUTTON.UP;
  if (y > AXIS_THRESHOLD) mask |= 1 << BUTTON.DOWN;
  return mask;
}

const pressedButtons = (pad: Gamepad) => pad.buttons.flatMap((b, i) => (b.pressed ? [i] : []));

export class Input {
  private keys = 0;
  private touch = 0;
  private prev = 0;
  private bindings: Bindings = DEFAULT_BINDINGS;
  private codes = keyMap(DEFAULT_BINDINGS);
  private capturing?: (c: Captured) => void;
  private padHeld = new Set<string>(); // "pad:button" pairs held when capture started
  /** Set while a text field or dialog has focus so typing does not move Link. */
  suspended = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => this.key(e, true));
    target.addEventListener('keyup', (e) => this.key(e, false));
    target.addEventListener('blur', () => (this.keys = 0));
  }

  setBindings(b: Bindings) {
    this.bindings = b;
    this.codes = keyMap(b);
    this.keys = 0;
  }

  /** Resolves with the next key or gamepad button the player presses (Escape cancels). */
  capture(): Promise<Captured> {
    this.capturing?.({ kind: 'cancel' });
    this.padHeld = new Set(this.allPadPresses());
    return new Promise((resolve) => {
      this.capturing = (c) => {
        this.capturing = undefined;
        resolve(c);
      };
    });
  }

  cancelCapture() {
    this.capturing?.({ kind: 'cancel' });
  }

  private allPadPresses(): string[] {
    return [...(navigator.getGamepads?.() ?? [])].flatMap((pad) =>
      pad ? pressedButtons(pad).map((i) => `${pad.index}:${i}`) : [],
    );
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (this.capturing && down) {
      e.preventDefault();
      if (e.code === 'Escape') this.capturing({ kind: 'cancel' });
      else if (!RESERVED_KEYS.has(e.code)) this.capturing({ kind: 'key', code: e.code });
      return;
    }
    const b = this.codes.get(e.code);
    if (!b || (this.suspended && down)) return;
    e.preventDefault();
    const bit = 1 << BUTTON[b];
    this.keys = down ? this.keys | bit : this.keys & ~bit;
  }

  setTouch(b: Button, down: boolean) {
    const bit = 1 << BUTTON[b];
    this.touch = down ? this.touch | bit : this.touch & ~bit;
  }

  private padMask(pad: Gamepad): number {
    let mask = stickMask(pad);
    for (const b of BUTTONS) {
      const i = this.bindings.pad[b];
      if (i !== null && pad.buttons[i]?.pressed) mask |= 1 << BUTTON[b];
    }
    return mask;
  }

  /** Samples all devices; returns the mask plus buttons newly pressed/released this frame. */
  poll(): { mask: number; pressed: number; released: number } {
    if (this.capturing) {
      const fresh = this.allPadPresses().find((p) => !this.padHeld.has(p));
      if (fresh) this.capturing({ kind: 'pad', index: Number(fresh.split(':')[1]) });
    }
    let mask = this.suspended || this.capturing ? 0 : this.keys | this.touch;
    if (!this.suspended && !this.capturing) {
      for (const pad of navigator.getGamepads?.() ?? []) if (pad) mask |= this.padMask(pad);
    }
    const pressed = mask & ~this.prev;
    const released = this.prev & ~mask;
    this.prev = mask;
    return { mask, pressed, released };
  }
}
