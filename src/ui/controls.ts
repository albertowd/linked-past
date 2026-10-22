// Controls screen: what each button does in the game, plus keyboard/gamepad rebinding and
// touch-control options. Opens by itself the first time someone plays.
import {
  type Bindings,
  bindKey,
  bindPad,
  type ControlSettings,
  DEFAULT_SETTINGS,
  keyLabel,
  padLabel,
  type TouchMode,
} from '../emu/bindings.js';
import type { Button } from '../emu/core.js';
import type { Input } from '../emu/input.js';
import { t } from '../i18n.js';
import { h, label } from './dom.js';

// Order follows how often a new player needs them.
const ROWS: Button[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'B', 'A', 'Y', 'X', 'START', 'SELECT', 'L', 'R'];

const SNES_COLORS: Partial<Record<Button, string>> = { A: '#e04848', B: '#e8c020', X: '#4878e0', Y: '#40a860' };
const ARROWS: Partial<Record<Button, string>> = { UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→' };

function snesBadge(b: Button) {
  const color = SNES_COLORS[b];
  const el = h('span', { class: `snes${color ? ' round' : ''}` }, ARROWS[b] ? `✚${ARROWS[b]}` : b);
  if (color) el.style.background = color;
  return el;
}

export interface ControlsDialogOptions {
  input: Input;
  settings: ControlSettings;
  firstRun: boolean;
  onChange(settings: ControlSettings): void;
  onClose(): void;
}

/** Builds the dialog body; the caller places it in its dialog container. */
export function controlsDialog(opts: ControlsDialogOptions): HTMLElement {
  let settings = opts.settings;
  const table = h('div', { class: 'binds', role: 'table' });

  const commit = (next: ControlSettings) => {
    settings = next;
    opts.onChange(settings);
    render();
  };

  const rebind = async (cell: HTMLButtonElement, button: Button, kind: 'key' | 'pad') => {
    for (const other of table.querySelectorAll('.bind.waiting')) other.classList.remove('waiting');
    cell.classList.add('waiting');
    cell.textContent = kind === 'key' ? t.controls.pressKey : t.controls.pressButton;
    for (;;) {
      const got = await opts.input.capture();
      if (got.kind === 'cancel') return render();
      if (got.kind !== kind) continue; // e.g. a gamepad press while rebinding a key
      const bindings: Bindings =
        got.kind === 'key'
          ? bindKey(settings.bindings, button, got.code)
          : bindPad(settings.bindings, button, got.index);
      return commit({ ...settings, bindings });
    }
  };

  const bindCell = (button: Button, kind: 'key' | 'pad') => {
    const { keyNames, padNames } = t.controls;
    const text =
      kind === 'key'
        ? keyLabel(settings.bindings.keys[button], keyNames)
        : padLabel(settings.bindings.pad[button], padNames, keyNames.button);
    const cell = h('button', { class: 'bind', type: 'button', title: t.controls.change }, text);
    cell.onclick = () => void rebind(cell, button, kind);
    return cell;
  };

  function render() {
    table.replaceChildren(
      h(
        'div',
        { class: 'bind-row head', role: 'row' },
        h('span', {}, 'SNES'),
        label(t.controls.inGame, { color: '#b8b8c8' }, 1),
        label(t.controls.keyboard, { color: '#b8b8c8' }, 1),
        label(t.controls.gamepad, { color: '#b8b8c8' }, 1),
      ),
      ...ROWS.map((b) =>
        h(
          'div',
          { class: 'bind-row', role: 'row' },
          snesBadge(b),
          label(t.controls.actions[b], {}, 1),
          bindCell(b, 'key'),
          bindCell(b, 'pad'),
        ),
      ),
    );
  }
  render();

  const touchSelect = h(
    'select',
    { onchange: () => commit({ ...settings, touch: touchSelect.value as TouchMode }) },
    ...(['auto', 'on', 'off'] as const).map((m) =>
      h('option', { value: m, selected: settings.touch === m }, t.controls.touchModes[m]),
    ),
  );
  const scale = h('input', {
    type: 'range',
    min: '0.75',
    max: '1.5',
    step: '0.05',
    value: String(settings.touchScale),
    oninput: () => commit({ ...settings, touchScale: Number(scale.value) }),
  });

  const close = () => {
    opts.input.cancelCapture();
    opts.onClose();
  };

  return h(
    'div',
    { class: 'controls' },
    Object.assign(label(opts.firstRun ? t.controls.welcome : t.controls.title, { color: '#f8d830' }, 2), {
      className: 'label title',
    }),
    h('p', { class: 'hint' }, t.controls.help),
    table,
    h(
      'ul',
      { class: 'extras' },
      h('li', {}, h('kbd', {}, 'T'), ' ', t.controls.chatKey),
      h('li', {}, h('kbd', {}, 'F1'), ' ', t.controls.helpKey),
      h('li', {}, t.controls.stick),
    ),
    h(
      'fieldset',
      { class: 'touch-settings' },
      label(t.controls.touch, { color: '#b8b8c8' }, 1),
      h('label', { class: 'line' }, t.controls.touchShow, touchSelect),
      h('label', { class: 'line' }, t.controls.touchSize, scale),
    ),
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        { class: 'btn primary', type: 'button', onclick: close },
        label(opts.firstRun ? t.controls.gotIt : t.controls.close),
      ),
      h(
        'button',
        { class: 'btn', type: 'button', onclick: () => commit(structuredClone(DEFAULT_SETTINGS)) },
        label(t.controls.reset),
      ),
    ),
  );
}
