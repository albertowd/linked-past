// Runtime recoloring of Link's tunic (and hat) and skin. The game keeps its palettes in WRAM
// ($7EC500) and uploads them to the PPU when $0015 is set; we rewrite Link's row there.
// Regions use different base palettes (the French cartridge is brighter), so the original
// colors are learned from the running game rather than hard-coded.
import { bgr555, MODULE, RAM } from '../shared/index.js';

/** Link's sprite palette (OBJ palette 7 = CGRAM 240..255) inside the WRAM palette buffer. */
export const LINK_ROW = 0xc500 + (128 + 7 * 16) * 2;
const UPLOAD_FLAG = 0x0015;
const BUNNY_FLAG = 0x02e0; // non-zero while Link is a bunny (different palette)

/** Palette entries: tunic + hat change with the mail; skin is the face, hands and legs. */
export const TUNIC = [9, 10, 11, 12];
export const SKIN = [3, 4, 13];

export interface Appearance {
  tunic?: string; // '#rrggbb'
  skin?: string;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function hexToRgb(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToBgr555 = (r: number, g: number, b: number) => (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10);

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = ((t % 1) + 1) % 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

/**
 * Shades for a picked color: each original shade keeps its brightness relative to the others,
 * so the sprite's shading survives while hue and saturation come from the pick.
 */
export function recolor(originals: number[], hex: string): number[] {
  const target = hexToRgb(hex);
  if (!target) return originals;
  const [h, s, l] = rgbToHsl(...target);
  const lights = originals.map((c) => rgbToHsl(...bgr555(c))[2]);
  const mean = lights.reduce((a, b) => a + b, 0) / lights.length || 1;
  return lights.map((ol) => {
    const [r, g, b] = hslToRgb(h, s, clamp(l * (ol / mean), 0.04, 0.96));
    return rgbToBgr555(Math.round(r), Math.round(g), Math.round(b));
  });
}

const read16 = (w: Uint8Array, a: number) => w[a] | (w[a + 1] << 8);
const write16 = (w: Uint8Array, a: number, v: number) => {
  w[a] = v & 0xff;
  w[a + 1] = v >> 8;
};

/** Keeps Link's palette row recolored; call once per emulated frame. */
export class LinkPalette {
  private readonly originals = new Map<number, number[]>(); // per mail: entries 0..15
  private readonly written = new Map<number, number[]>(); // per mail: what we last wrote
  private appearance: Appearance = {};

  set(appearance: Appearance) {
    this.appearance = { ...appearance };
  }

  /** Returns true when it changed WRAM (and asked the game to upload the palette). */
  apply(wram: Uint8Array): boolean {
    const mail = wram[RAM.armor] & 3;
    const playable = wram[RAM.module] === MODULE.overworld || wram[RAM.module] === MODULE.underworld;
    if (!playable || wram[BUNNY_FLAG] !== 0) return false;
    const row = Array.from({ length: 16 }, (_, i) => read16(wram, LINK_ROW + i * 2));
    let base = this.originals.get(mail);
    if (!base) {
      // First normal frame with this mail: the row is still exactly what the game loaded.
      base = row;
      this.originals.set(mail, base);
    }
    const wanted = this.target(base);
    const last = this.written.get(mail) ?? base;
    let changed = false;
    for (let i = 0; i < 16; i++) {
      // Only touch entries holding the original or our previous color; anything else is an effect.
      const ours = row[i] === base[i] || row[i] === last[i];
      if (!ours || row[i] === wanted[i]) continue;
      write16(wram, LINK_ROW + i * 2, wanted[i]);
      changed = true;
    }
    this.written.set(mail, wanted);
    if (changed) wram[UPLOAD_FLAG] = 1;
    return changed;
  }

  private target(base: number[]): number[] {
    const out = [...base];
    const paint = (entries: number[], hex?: string) => {
      if (!hex) return;
      const shades = recolor(
        entries.map((i) => base[i]),
        hex,
      );
      entries.forEach((e, k) => {
        out[e] = shades[k];
      });
    };
    paint(TUNIC, this.appearance.tunic);
    paint(SKIN, this.appearance.skin);
    return out;
  }
}
