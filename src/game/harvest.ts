// Builds the UI sprite atlas from the player's own ROM by booting it headlessly until the
// HUD is on screen, then reading tiles straight out of VRAM. Nothing copyrighted ships with
// the app, and the result matches whatever region the player's cartridge is.

import { BUTTON, Core } from '../emu/core.js';
import { bgr555, type Locale, MODULE, RAM } from '../shared/index.js';

export interface Sprite {
  w: number;
  h: number;
  rgba: number[];
}

export interface Atlas {
  version: number;
  /** 8x8 glyphs as 2bpp color indices (0 = transparent). */
  glyphs: Record<string, number[]>;
  icons: Record<'rupee' | 'bomb' | 'arrow' | 'heart' | 'halfHeart' | 'emptyHeart', Sprite>;
}

export const ATLAS_VERSION = 3;

// BG3 tile numbers, identical across all supported cartridges. The first row is A-P on the
// western ones; French cartridges have no X or Z in the second row. The Japanese cartridge has
// katakana there instead (no ヲ, ー, dakuten or small ャ) and no Latin letters at all: the UI
// font supplies whatever is missing.
const LETTER_ROWS: Record<Locale, string[]> = {
  en: ['ABCDEFGHIJKLMNOP', 'QRSTUVWXYZ'],
  de: ['ABCDEFGHIJKLMNOP', 'QRSTUVWXYZ'],
  fr: ['ABCDEFGHIJKLMNOP', 'QRSTUVWY'],
  ja: ['アイウエオカキクケコサシスセソタ', 'チツテトナニヌネノハヒフヘホマミ', 'ムメモヤユヨラリルレロワンョッュ'],
};
const DIGIT_TILE = 0x90;
const HEART_TILES = { heart: 0xa0, halfHeart: 0xa1, emptyHeart: 0xa2 } as const;
// HUD tilemap cells (column, row, width in tiles) for icons drawn in their real colors.
const HUD_CELLS = { rupee: [9, 2, 1], bomb: [13, 2, 1], arrow: [15, 2, 2] } as const;

const MAX_FRAMES = 9000;

export function tile2bpp(vram: Uint8Array, nameBase: number, tile: number, hflip = false, vflip = false): number[] {
  const out: number[] = [];
  for (let y = 0; y < 8; y++) {
    const o = nameBase + tile * 16 + (vflip ? 7 - y : y) * 2;
    for (let x = 0; x < 8; x++) {
      const bit = hflip ? x : 7 - x;
      out.push(((vram[o] >> bit) & 1) | (((vram[o + 1] >> bit) & 1) << 1));
    }
  }
  return out;
}

function hudSprite(core: Core, col: number, row: number, width: number): Sprite {
  const vram = core.vram();
  const cgram = core.cgram();
  const sc = core.bgScreenBase(2);
  const nb = core.bgNameBase(2);
  const w = width * 8;
  const rgba = new Array(w * 8 * 4).fill(0);
  for (let c = 0; c < width; c++) {
    const e = vram[sc + (row * 32 + col + c) * 2] | (vram[sc + (row * 32 + col + c) * 2 + 1] << 8);
    const px = tile2bpp(vram, nb, e & 0x3ff, !!(e & 0x4000), !!(e & 0x8000));
    const pal = (e >> 10) & 7;
    px.forEach((v, i) => {
      if (!v) return;
      const [r, g, b] = bgr555(cgram[pal * 4 + v]);
      const k = ((i >> 3) * w + c * 8 + (i & 7)) * 4;
      rgba.splice(k, 4, r, g, b, 255);
    });
  }
  return { w, h: 8, rgba };
}

function glyphSprite(core: Core, tile: number): Sprite {
  // Hearts use the HUD's heart palette (BG3 palette of the HUD life meter).
  const vram = core.vram();
  const cgram = core.cgram();
  const sc = core.bgScreenBase(2);
  const e = vram[sc + (3 * 32 + 20) * 2 + 1] << 8;
  const pal = (e >> 10) & 7;
  const px = tile2bpp(vram, core.bgNameBase(2), tile);
  const rgba: number[] = [];
  for (const v of px) rgba.push(...(v ? [...bgr555(cgram[pal * 4 + v]), 255] : [0, 0, 0, 0]));
  return { w: 8, h: 8, rgba };
}

/**
 * Menu letters are drawn as a stroke on a filled cell, HUD digits as a stroke with an
 * outline, and the index layout varies by region. Normalize to 0 transparent, 1 main
 * stroke, 2 shade, 3 outline: the usual corner color is background (some katakana start with a
 * stroke in the top-left corner), the rest ranked by brightness.
 */
export function normalizeGlyph(px: number[], luminance: (v: number) => number): number[] {
  const corners = [px[0], px[7], px[56], px[63]];
  const seen = (v: number) => corners.filter((c) => c === v).length;
  const bg = corners.reduce((best, v) => (seen(v) > seen(best) ? v : best));
  const values = [...new Set(px)].filter((v) => v !== 0 && v !== bg).sort((a, b) => luminance(b) - luminance(a));
  const rankOf = (i: number) => {
    if (values.length === 1) return 1;
    return i === values.length - 1 ? 3 : i + 1; // darkest is the outline
  };
  const rank = new Map(values.map((v, i) => [v, rankOf(i)]));
  return px.map((v) => (v === 0 || v === bg ? 0 : (rank.get(v) ?? 1)));
}

const NAME_ENTRY_MODULE = 4;
const LAST_MENU_MODULE = 5;
const SETTLE_FRAMES = 30;

/**
 * Taps a button every 40 frames: START through title/file select, A then START to accept a
 * name, A to advance dialog. This only touches the throwaway harvest instance.
 */
class BootDriver {
  private held = 0;
  private nameTaps = 0;

  input(frame: number, mod: number): number {
    if (frame % 40 === 0) this.held = 4;
    if (this.held === 0) return 0;
    this.held--;
    if (mod === NAME_ENTRY_MODULE) return 1 << (++this.nameTaps % 4 === 0 ? BUTTON.START : BUTTON.A);
    if (mod <= LAST_MENU_MODULE) return 1 << BUTTON.START;
    return mod === MODULE.text ? 1 << BUTTON.A : 0;
  }
}

async function bootToHud(core: Core, onProgress: (p: number) => void) {
  const driver = new BootDriver();
  let playable = 0;
  for (let f = 0; f < MAX_FRAMES; f++) {
    const w = core.wram();
    const mod = w[RAM.module];
    core.runFrame(driver.input(f, mod));
    playable = mod === MODULE.underworld && w[RAM.submodule] === 0 ? playable + 1 : 0;
    if (playable > SETTLE_FRAMES) return;
    if (f % 300 === 0) {
      onProgress(f / 4000);
      await new Promise((r) => setTimeout(r)); // keep the page responsive
    }
  }
  throw new Error('Could not reach the game to read its graphics.');
}

/** Boots to the first controllable moment with the HUD on screen and reads the atlas. */
export async function harvestAtlas(rom: Uint8Array, locale: Locale, onProgress: (p: number) => void): Promise<Atlas> {
  const core = await Core.create(rom);
  await bootToHud(core, onProgress);

  const vram = core.vram();
  const nb = core.bgNameBase(2);
  // Rank indices by brightness in the palette the HUD uses for its digits.
  const sc = core.bgScreenBase(2);
  const hudPal = (vram[sc + (3 * 32 + 9) * 2 + 1] >> 2) & 7;
  const cgram = core.cgram();
  const luminance = (v: number) => bgr555(cgram[hudPal * 4 + v]).reduce((a, b) => a + b, 0);
  const glyphs: Record<string, number[]> = {};
  LETTER_ROWS[locale].forEach((row, r) => {
    for (let i = 0; i < row.length; i++)
      glyphs[row[i]] = normalizeGlyph(tile2bpp(vram, nb, 0x150 + r * 16 + i), luminance);
  });
  for (let i = 0; i < 10; i++) glyphs[String(i)] = normalizeGlyph(tile2bpp(vram, nb, DIGIT_TILE + i), luminance);
  const icons = {
    rupee: hudSprite(core, ...HUD_CELLS.rupee),
    bomb: hudSprite(core, ...HUD_CELLS.bomb),
    arrow: hudSprite(core, ...HUD_CELLS.arrow),
    heart: glyphSprite(core, HEART_TILES.heart),
    halfHeart: glyphSprite(core, HEART_TILES.halfHeart),
    emptyHeart: glyphSprite(core, HEART_TILES.emptyHeart),
  };
  onProgress(1);
  return { version: ATLAS_VERSION, glyphs, icons };
}
