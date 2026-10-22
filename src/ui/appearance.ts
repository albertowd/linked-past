// "Link's colors": tunic (and hat) and skin pickers. Changes apply live; everyone in the room
// sees them, because the sprite capture sends the live palette.
import type { Appearance } from '../game/appearance.js';
import { t } from '../i18n.js';
import { h, label } from './dom.js';

// Quick picks: the three classic mails, then a few more tunics and skin tones.
const TUNICS = ['#48b048', '#3868d8', '#d03838', '#e0b020', '#8848c8', '#202020', '#f0f0f0'];
const SKINS = ['#f0b080', '#d89060', '#a86840', '#784028', '#4a2818'];

export function appearanceDialog(
  current: Appearance,
  onChange: (a: Appearance) => void,
  close: () => void,
): HTMLElement {
  let value: Appearance = { ...current };
  const commit = (next: Appearance) => {
    value = next;
    onChange(value);
    render();
  };

  const row = (key: keyof Appearance, title: string, swatches: string[], fallback: string) => {
    const picker = h('input', { type: 'color', value: value[key] ?? fallback, title });
    picker.oninput = () => commit({ ...value, [key]: picker.value });
    const chips = swatches.map((c) => {
      const chip = h('button', { class: 'swatch', type: 'button', title: c, ariaLabel: c });
      chip.style.background = c;
      chip.onclick = () => commit({ ...value, [key]: c });
      return chip;
    });
    const original = h(
      'button',
      { class: 'btn small', type: 'button', onclick: () => commit({ ...value, [key]: undefined }) },
      label(t.appearance.original, {}, 1),
    );
    const wrap = h(
      'div',
      { class: 'look-row' },
      label(title, { color: '#b8b8c8' }, 1),
      h('div', { class: 'swatches' }, picker, ...chips, original),
    );
    return { wrap, picker, chips, key };
  };

  const tunic = row('tunic', t.appearance.tunic, TUNICS, TUNICS[0]);
  const skin = row('skin', t.appearance.skin, SKINS, SKINS[0]);

  function render() {
    for (const r of [tunic, skin]) {
      const v = value[r.key];
      if (v) r.picker.value = v;
      for (const chip of r.chips) chip.classList.toggle('on', chip.title === v);
      r.wrap.classList.toggle('default', !v);
    }
  }
  render();

  return h(
    'div',
    { class: 'appearance' },
    label(t.appearance.title, { color: '#f8d830' }, 2),
    tunic.wrap,
    skin.wrap,
    h('p', { class: 'hint' }, t.appearance.help),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onclick: close }, label(t.controls.close)),
    ),
  );
}
