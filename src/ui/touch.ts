// On-screen controls for touch devices.
import type { Button } from '../emu/core.js';
import { h } from './dom.js';

type Dir = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
const DIRS: Dir[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

/**
 * Directions for a thumb at (dx, dy) from the D-pad center: 8 sectors of 45°, nothing inside
 * the dead zone. Diagonals press two directions like a real D-pad rocking on its pivot.
 */
export function dpadDirections(dx: number, dy: number, radius: number, deadZone = 0.22): Set<Dir> {
  const out = new Set<Dir>();
  if (Math.hypot(dx, dy) < radius * deadZone) return out;
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)); // -4..4, 0 = right, 2 = down
  const s = ((sector % 8) + 8) % 8;
  if (s === 7 || s === 0 || s === 1) out.add('RIGHT');
  if (s >= 1 && s <= 3) out.add('DOWN');
  if (s >= 3 && s <= 5) out.add('LEFT');
  if (s >= 5 && s <= 7) out.add('UP');
  return out;
}

/** Which of the 8 D-pad directions a set of pressed directions points, in degrees clockwise from up. */
export function dpadAngle(dirs: Set<Dir>): number | undefined {
  const dx = Number(dirs.has('RIGHT')) - Number(dirs.has('LEFT'));
  const dy = Number(dirs.has('DOWN')) - Number(dirs.has('UP'));
  if (!dx && !dy) return undefined;
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

const buzz = () => navigator.vibrate?.(8);

// The cross is one outline (no seam where the arms meet), with an arrowhead inside the end of
// each arm. The glow sits on the pressed direction, diagonals included.
const ARROW = 'M50 13 L58 23 H42 Z';
const DPAD_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs><radialGradient id="tpad-glow"><stop offset="0" stop-color="#f8d830" stop-opacity="0.8"/>
  <stop offset="1" stop-color="#f8d830" stop-opacity="0"/></radialGradient></defs>
  <path class="cross" d="M36 7 H64 V36 H93 V64 H64 V93 H36 V64 H7 V36 H36 Z"/>
  <g class="glow"><circle cx="50" cy="16" r="22" fill="url(#tpad-glow)"/></g>
  ${DIRS.map((d, i) => `<path class="arrow" data-d="${d}" d="${ARROW}" transform="rotate(${[0, 180, 270, 90][i]} 50 50)"/>`).join('')}
</svg>`;

/** D-pad: one surface, direction from the thumb's position, so sliding between directions works. */
function dpad(set: (b: Button, down: boolean) => void): HTMLElement {
  const el = h('div', { class: 'tpad', role: 'group', ariaLabel: 'D-pad' });
  el.innerHTML = DPAD_SVG;
  const glow = el.querySelector<SVGGElement>('.glow');
  let held = new Set<Dir>();
  const update = (e: PointerEvent | null) => {
    let next = new Set<Dir>();
    if (e) {
      const r = el.getBoundingClientRect();
      next = dpadDirections(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2);
    }
    for (const d of DIRS) if (held.has(d) !== next.has(d)) set(d, next.has(d));
    if (next.size > held.size) buzz();
    held = next;
    el.dataset.dir = [...next].join(' ');
    const angle = dpadAngle(next);
    if (angle !== undefined) glow?.setAttribute('transform', `rotate(${angle} 50 50)`);
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    update(e);
  });
  el.addEventListener('pointermove', (e) => el.hasPointerCapture(e.pointerId) && update(e));
  for (const end of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
    el.addEventListener(end, () => update(null));
  return el;
}

/**
 * Face buttons as one surface: each finger presses whatever button is under it, so rolling a
 * thumb from B to A (or resting between them for both) works like on a real pad.
 */
function faceButtons(set: (b: Button, down: boolean) => void): HTMLElement {
  const btn = (b: Button) => h('span', { class: `tface ${b.toLowerCase()}`, dataset: { btn: b } }, b);
  const el = h('div', { class: 'tfaces', role: 'group', ariaLabel: 'A B X Y' }, btn('X'), btn('Y'), btn('A'), btn('B'));
  const fingers = new Map<number, Button | undefined>();
  const count = (b: Button) => [...fingers.values()].filter((x) => x === b).length;
  const press = (id: number, x: number, y: number) => {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('.tface');
    const next = target && el.contains(target) ? (target.dataset.btn as Button) : undefined;
    const prev = fingers.get(id);
    if (prev === next) return;
    fingers.set(id, next);
    if (prev && count(prev) === 0) {
      set(prev, false);
      el.querySelector(`[data-btn="${prev}"]`)?.classList.remove('on');
    }
    if (next && count(next) === 1) {
      set(next, true);
      el.querySelector(`[data-btn="${next}"]`)?.classList.add('on');
      buzz();
    }
  };
  const release = (id: number) => {
    const prev = fingers.get(id);
    fingers.delete(id);
    if (prev && count(prev) === 0) {
      set(prev, false);
      el.querySelector(`[data-btn="${prev}"]`)?.classList.remove('on');
    }
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    press(e.pointerId, e.clientX, e.clientY);
  });
  el.addEventListener('pointermove', (e) => fingers.has(e.pointerId) && press(e.pointerId, e.clientX, e.clientY));
  for (const end of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
    el.addEventListener(end, (e) => release(e.pointerId));
  return el;
}

function metaButton(b: Button, text: string, set: (b: Button, down: boolean) => void): HTMLElement {
  const el = h('button', { class: 'tmeta', type: 'button' }, text);
  const on = (down: boolean) => (e: Event) => {
    e.preventDefault();
    set(b, down);
  };
  el.addEventListener('pointerdown', on(true));
  for (const end of ['pointerup', 'pointercancel', 'pointerleave'] as const) el.addEventListener(end, on(false));
  return el;
}

export function touchControls(set: (b: Button, down: boolean) => void): HTMLElement {
  return h(
    'div',
    { class: 'touch' },
    dpad(set),
    h('div', { class: 'tmetas' }, metaButton('SELECT', 'SELECT', set), metaButton('START', 'START', set)),
    faceButtons(set),
  );
}
