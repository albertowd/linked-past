import { registerSW } from 'virtual:pwa-register';
import { ATLAS_VERSION, type Atlas, harvestAtlas } from './game/harvest.js';
import { GameSession } from './game/session.js';
import { browserLocale, setLocale, t } from './i18n.js';
import { GuestLink } from './net/guest.js';
import { HostLink } from './net/host.js';
import type { Link } from './net/link.js';
import { clearLinkedRoom, decodeCode, linkedRoom } from './net/rtc.js';
import * as db from './rom/db.js';
import { type Cartridge, identify, loadSaved, remember } from './rom/rom.js';
import { byId, h, panel, setFont } from './ui/dom.js';
import { PixelFont } from './ui/font.js';
import { GameScreen } from './ui/game.js';
import { appIcon, cartridgeIcon } from './ui/icons.js';
import { startScreen } from './ui/start.js';

registerSW({ immediate: true });
const app = byId('app');
setLocale(browserLocale());

function show(...nodes: Node[]) {
  app.replaceChildren(...nodes);
}

async function pickRom(error?: string): Promise<Cartridge> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.sfc,.smc,.bin', class: 'hidden' });
    const msg = h('p', { class: 'error' }, error ?? '');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const cart = await identify(await file.arrayBuffer());
      if (!cart) {
        msg.textContent = t.unsupportedRom;
        return;
      }
      await remember(cart);
      resolve(cart);
    };
    show(
      panel(
        'center rom',
        appIcon(),
        h('h1', {}, t.pickRom),
        h('p', {}, t.pickRomHelp),
        h('button', { class: 'btn', onclick: () => input.click() }, cartridgeIcon(), t.chooseFile),
        input,
        msg,
      ),
    );
  });
}

async function loadAtlas(cart: Cartridge): Promise<Atlas> {
  const key = `atlas:${cart.info.sha1}`;
  const cached = await db.get<Atlas>(key);
  if (cached?.version === ATLAS_VERSION) return cached;
  const bar = h('div', { class: 'bar' });
  show(panel('center', h('p', {}, t.reading), h('div', { class: 'progress' }, bar)));
  const atlas = await harvestAtlas(
    cart.data,
    cart.info.locale,
    (p) => (bar.style.width = `${Math.round(Math.min(1, p) * 100)}%`),
  );
  await db.set(key, atlas);
  return atlas;
}

async function main() {
  let cart = await loadSaved();
  cart ??= await pickRom();
  setLocale(cart.info.locale);
  let atlas: Atlas;
  try {
    atlas = await loadAtlas(cart);
  } catch (e) {
    await db.del('rom');
    cart = await pickRom(String(e));
    atlas = await loadAtlas(cart);
  }
  const font = new PixelFont(atlas);
  setFont(font);
  // Opened from a room link (the host's QR code): say whose room it is and suggest Join.
  const room = linkedRoom();
  const invitedBy = room
    ? await decodeCode('room', room).then(
        (c) => c.name ?? '',
        () => '',
      )
    : undefined;
  const choice = await startScreen(cart, show, undefined, invitedBy);
  if (room) clearLinkedRoom();
  const hello = { name: choice.name, mode: choice.mode, rom: cart.info.sha1 };
  const link: Link = choice.role === 'host' ? new HostLink(choice.name, hello) : new GuestLink(hello, cart);
  const screen = new GameScreen(font, atlas, choice.mode, link, choice.role === 'guest' ? invitedBy : undefined);
  show(screen.root);
  const game = new GameSession(cart, font, link, choice.mode, screen.screen, screen.overlay, screen);
  screen.bind(game);
  await game.start();
}

try {
  await main();
} catch (e) {
  show(panel('center', h('p', { class: 'error' }, String(e))));
}
