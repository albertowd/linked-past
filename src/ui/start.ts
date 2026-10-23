// Start screen: player name, Link/Zelda mode, and whether to host a room or join one with an
// invite code. No accounts: the choices are remembered on this device.

import { saveKey } from '../game/session.js';
import { t } from '../i18n.js';
import * as db from '../rom/db.js';
import { type Cartridge, forget } from '../rom/rom.js';
import type { Mode } from '../shared/index.js';
import { h, label, panel } from './dom.js';
import { appIcon, cartridgeIcon } from './icons.js';

export interface StartChoice {
  role: 'host' | 'guest';
  name: string;
  mode: Mode;
}

interface Remembered {
  name?: string;
  mode?: Mode;
}

/** Forgets the stored ROM; the reload starts over at the cartridge picker. */
async function changeRom() {
  await forget();
  location.reload();
}

const NAME = /^[\p{L}\p{N} _-]{1,16}$/u;
const SRAM_SIZE = 0x2000;

function saveControls(cart: Cartridge, note: HTMLElement) {
  const key = saveKey(cart);
  const exportSave = async () => {
    const sram = await db.get<Uint8Array>(key);
    if (!sram) {
      note.textContent = t.noSave;
      return;
    }
    const a = h('a', {
      href: URL.createObjectURL(new Blob([sram.slice()], { type: 'application/octet-stream' })),
      download: `zelda3-${cart.info.region}.srm`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const file = h('input', { type: 'file', accept: '.srm,.sav', class: 'hidden' });
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    const data = new Uint8Array(await f.arrayBuffer()).slice(0, SRAM_SIZE);
    await db.set(key, data);
    note.textContent = t.saveImported;
  };
  return h(
    'div',
    { class: 'row saves' },
    label(t.saves, { color: '#b8b8c8' }, 1),
    h('button', { class: 'btn small', type: 'button', onclick: () => void exportSave() }, label(t.exportSave, {}, 1)),
    h('button', { class: 'btn small', type: 'button', onclick: () => file.click() }, label(t.importSave, {}, 1)),
    file,
  );
}

/** `invitedBy` is the host's name when the page was opened from a join link. */
export async function startScreen(
  cart: Cartridge,
  show: (...n: Node[]) => void,
  error?: string,
  invitedBy?: string,
): Promise<StartChoice> {
  const saved = (await db.get<Remembered>('start')) ?? {};
  let mode: Mode = saved.mode ?? 'link';
  return new Promise((resolve) => {
    const name = h('input', { placeholder: t.name, autocomplete: 'username', maxLength: 16, value: saved.name ?? '' });
    const err = h('p', { class: 'error' }, error ? (t.errors[error] ?? error) : '');
    const note = h('p', { class: 'hint' });

    const modeBtn = (m: Mode, title: string, help: string) =>
      h(
        'button',
        { class: `mode ${m}${m === mode ? ' on' : ''}`, type: 'button', dataset: { mode: m }, onclick: () => pick(m) },
        label(title, { color: m === 'link' ? '#78f878' : '#f8a0d0' }, 3),
        h('small', {}, help),
      );
    const modes = h(
      'div',
      { class: 'modes' },
      modeBtn('link', t.modeLink, t.modeLinkHelp),
      modeBtn('zelda', t.modeZelda, t.modeZeldaHelp),
    );
    const pick = (m: Mode) => {
      mode = m;
      for (const b of modes.querySelectorAll<HTMLElement>('.mode')) b.classList.toggle('on', b.dataset.mode === m);
    };

    const go = (role: 'host' | 'guest') => {
      const choice = { role, name: name.value.trim(), mode };
      if (!NAME.test(choice.name)) {
        err.textContent = t.errors.invalid_name;
        return;
      }
      void db.set('start', { name: choice.name, mode } satisfies Remembered);
      resolve(choice);
    };

    const form = h(
      'form',
      {
        class: 'login',
        onsubmit: (e: Event) => {
          e.preventDefault();
          go('guest');
        },
      },
      invitedBy === undefined
        ? ''
        : h('p', { class: 'invited' }, `${t.join.from} ${invitedBy || '?'}. ${t.join.linkHelp}`),
      label(t.modeTitle, {}, 2),
      modes,
      name,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: invitedBy === undefined ? 'btn primary' : 'btn',
            type: 'button',
            title: t.hostHelp,
            onclick: () => go('host'),
          },
          label(t.hostRoom),
        ),
        h(
          'button',
          { class: invitedBy === undefined ? 'btn' : 'btn primary', type: 'submit', title: t.joinHelp },
          label(t.joinRoom),
        ),
      ),
      err,
      saveControls(cart, note),
      h(
        'div',
        { class: 'row saves' },
        label(t.cartridge, { color: '#b8b8c8' }, 1),
        h(
          'button',
          { class: 'btn small', type: 'button', onclick: () => void changeRom() },
          cartridgeIcon(),
          label(t.changeRom, {}, 1),
        ),
      ),
      note,
      h('p', { class: 'version' }, `v${__APP_VERSION__}`),
    );
    show(panel('center', appIcon(), h('h1', { class: 'logo' }, label('LINKED PAST', { color: '#f8d830' }, 4)), form));
  });
}
