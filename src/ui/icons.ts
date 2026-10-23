// Small pictures for the title and cartridge cards.
import { h } from './dom.js';

/** The app icon (public/icons/icon.svg), shown on the title and cartridge cards. */
export const appIcon = () =>
  h('img', { class: 'app-icon', src: `${import.meta.env.BASE_URL}icons/icon.svg`, alt: '', width: 64, height: 64 });

// A 16x16 pixel SNES cartridge: grey shell, purple label with the Triforce, grip ridges and the
// narrower connector edge. One character per pixel; '.' is transparent.
const CARTRIDGE = [
  '..oooooooooooo..',
  '.ohhhhhhhhhhhho.',
  '.ohgggggggggggo.',
  '.ogoooooooooogo.',
  '.ogollllllllogo.',
  '.ogolllyylllogo.',
  '.ogollyyyyllogo.',
  '.ogolyyllyylogo.',
  '.ogoyyyyyyyyogo.',
  '.ogoooooooooogo.',
  '.oggggggggggggo.',
  '.oggdgdggdgdggo.',
  '.oggggggggggggo.',
  '..ooggggggggoo..',
  '...ooddddddoo...',
  '....oooooooo....',
];
const PALETTE: Record<string, string> = {
  o: '#303048',
  h: '#d8d8e8',
  g: '#b0b0c0',
  d: '#787890',
  l: '#6838a0',
  y: '#f8d830',
};
const CARTRIDGE_SVG = `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${CARTRIDGE.flatMap(
  (row, y) =>
    [...row].map((c, x) => (PALETTE[c] ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${PALETTE[c]}"/>` : '')),
).join('')}</svg>`;

export function cartridgeIcon(): HTMLElement {
  const el = h('span', { class: 'cart-icon' });
  el.innerHTML = CARTRIDGE_SVG;
  return el;
}
