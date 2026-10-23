// Renders text with the game's own menu alphabet and digits (harvested from the ROM).
// The game font has no punctuation, so a few marks are drawn in the same 8x8 style.
import type { Atlas, Sprite } from '../game/harvest.js';
import { ctx2d } from './dom.js';

// Letters some regions lack: French cartridges have no X/Z in the menu font, and the Japanese
// one has katakana instead of A-Z (and lacks ヲ, ー, small ャ and the dakuten marks).
const FALLBACK_LETTERS: Record<string, string[]> = {
  A: ['..###', '.##.##', '##...##', '##...##', '#######', '##...##', '##...##', ''],
  B: ['######', '##...##', '##...##', '######', '##...##', '##...##', '######', ''],
  C: ['.#####', '##...##', '##', '##', '##', '##...##', '.#####', ''],
  D: ['#####', '##..##', '##...##', '##...##', '##...##', '##..##', '#####', ''],
  E: ['#######', '##', '##', '######', '##', '##', '#######', ''],
  F: ['#######', '##', '##', '######', '##', '##', '##', ''],
  G: ['.#####', '##...##', '##', '##.####', '##...##', '##...##', '.######', ''],
  H: ['##...##', '##...##', '##...##', '#######', '##...##', '##...##', '##...##', ''],
  I: ['######', '..##', '..##', '..##', '..##', '..##', '######', ''],
  J: ['....###', '.....##', '.....##', '.....##', '##...##', '##...##', '.#####', ''],
  K: ['##...##', '##..##', '##.##', '####', '##.##', '##..##', '##...##', ''],
  L: ['##', '##', '##', '##', '##', '##', '#######', ''],
  M: ['##...##', '###.###', '#######', '##.#.##', '##...##', '##...##', '##...##', ''],
  N: ['##...##', '###..##', '####.##', '##.####', '##..###', '##...##', '##...##', ''],
  O: ['.#####', '##...##', '##...##', '##...##', '##...##', '##...##', '.#####', ''],
  P: ['######', '##...##', '##...##', '######', '##', '##', '##', ''],
  Q: ['.#####', '##...##', '##...##', '##...##', '##.#.##', '##..##', '.###.##', ''],
  R: ['######', '##...##', '##...##', '######', '##.##', '##..##', '##...##', ''],
  S: ['.#####', '##...##', '##', '.#####', '.....##', '##...##', '.#####', ''],
  T: ['######', '..##', '..##', '..##', '..##', '..##', '..##', ''],
  U: ['##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '.#####', ''],
  V: ['##...##', '##...##', '##...##', '##...##', '.##.##', '..###', '...#', ''],
  W: ['##...##', '##...##', '##...##', '##.#.##', '#######', '###.###', '##...##', ''],
  X: ['##...##', '##...##', '.##.##', '..###', '.##.##', '##...##', '##...##', ''],
  Y: ['##..##', '##..##', '##..##', '.####', '..##', '..##', '..##', ''],
  Z: ['#######', '....##', '...##', '..##', '.##', '##', '#######', ''],
  ヲ: ['.######', '......#', '.######', '......#', '.....#', '....#', '..##', ''],
  ー: ['', '', '', '.######', '', '', '', ''],
  ャ: ['', '', '..#', '.#####', '..#..#', '...#', '...#', ''],
  '・': ['', '', '', '...##', '...##', '', '', ''],
};

// Dakuten and handakuten, drawn into the top-right corner of the kana before them.
const DAKUTEN = '\u3099';
const HANDAKUTEN = '\u309a';
const MARKS: Record<string, string[]> = {
  [DAKUTEN]: ['#.#', '#.#', '', '', '', '', '', ''],
  [HANDAKUTEN]: ['###', '#.#', '###', '', '', '', '', ''],
};
// Small kana the cartridge lacks read fine at full size.
const SMALL_KANA: Record<string, string> = {
  ァ: 'ア',
  ィ: 'イ',
  ゥ: 'ウ',
  ェ: 'エ',
  ォ: 'オ',
  ヮ: 'ワ',
  ヵ: 'カ',
  ヶ: 'ケ',
};

const PUNCTUATION: Record<string, string[]> = {
  '.': ['', '', '', '', '', '', '.##', '.##'],
  ',': ['', '', '', '', '', '.##', '.##', '##'],
  '!': ['.##', '.##', '.##', '.##', '.##', '', '.##', '.##'],
  '?': ['.####', '##..##', '....##', '...##', '..##', '', '..##', '..##'],
  ':': ['', '.##', '.##', '', '', '.##', '.##', ''],
  '-': ['', '', '', '#####', '#####', '', '', ''],
  "'": ['.##', '.##', '##', '', '', '', '', ''],
  '/': ['.....##', '....##', '...##', '..##', '.##', '##', '#', ''],
  '(': ['..##', '.##', '##', '##', '##', '.##', '..##', ''],
  ')': ['##', '.##', '..##', '..##', '..##', '.##', '##', ''],
  '+': ['', '..##', '..##', '######', '..##', '..##', '', ''],
  '<': ['...##', '..##', '.##', '##', '.##', '..##', '...##', ''],
  '>': ['##', '.##', '..##', '...##', '..##', '.##', '##', ''],
  '=': ['', '', '#####', '', '#####', '', '', ''],
  '#': ['.#..#', '######', '.#..#', '.#..#', '######', '.#..#', '', ''],
  '%': ['##...#', '##..#', '...#', '..#', '.#', '#..##', '...##', ''],
  '*': ['', '#.#.#', '.###', '#####', '.###', '#.#.#', '', ''],
  _: ['', '', '', '', '', '', '', '######'],
  '"': ['##.##', '##.##', '', '', '', '', '', ''],
  '&': ['.##', '#..#', '.##', '.##.#', '#..#', '#..##', '.##.#', ''],
};

const punctuationGlyph = (rows: string[]) =>
  Array.from({ length: 64 }, (_, i) => (rows[i >> 3]?.[i & 7] === '#' ? 1 : 0));

/**
 * The game alphabet is uppercase only: fold case and accents (German umlauts as digraphs).
 * Japanese folds to katakana, keeping dakuten as separate marks.
 */
export function fold(text: string): string {
  return text
    .normalize('NFKC') // full-width Latin, digits and punctuation, half-width katakana
    .replaceAll(/[\u3041-\u3096]/g, (c) => String.fromCodePoint((c.codePointAt(0) ?? 0) + 0x60)) // hiragana
    .replaceAll(/[ァィゥェォヮヵヶ]/g, (c) => SMALL_KANA[c])
    .replaceAll('、', ',')
    .replaceAll('。', '.')
    .replaceAll(/[äÄ]/g, 'AE')
    .replaceAll(/[öÖ]/g, 'OE')
    .replaceAll(/[üÜ]/g, 'UE')
    .replaceAll('ß', 'SS')
    .normalize('NFD')
    .replaceAll(/[^\P{M}\u3099\u309a]/gu, '') // combining accents left by NFD, but not dakuten
    .toUpperCase();
}

export interface TextStyle {
  color?: string; // main stroke
  shade?: string; // secondary stroke
  outline?: string; // drop shadow
}

const DEFAULT: Required<TextStyle> = { color: '#f8f8f8', shade: '#b8b8c8', outline: '#101028' };

export class PixelFont {
  private readonly glyphs = new Map<string, { px: number[]; width: number; dx?: number }>();
  private readonly cache = new Map<string, HTMLCanvasElement>();

  constructor(readonly atlas: Atlas) {
    const all: Record<string, number[]> = {};
    for (const [ch, rows] of Object.entries(FALLBACK_LETTERS)) all[ch] = punctuationGlyph(rows);
    Object.assign(all, atlas.glyphs);
    for (const [ch, rows] of Object.entries(PUNCTUATION)) all[ch] = punctuationGlyph(rows);
    for (const [ch, px] of Object.entries(all)) {
      let right = 0;
      for (let i = 0; i < px.length; i++) if (px[i]) right = Math.max(right, i & 7);
      this.glyphs.set(ch, { px, width: right + 2 });
    }
    for (const [ch, rows] of Object.entries(MARKS))
      this.glyphs.set(ch, { px: punctuationGlyph(rows), width: 2, dx: -1 });
  }

  /** False when the text has letters this font cannot draw (kanji, for one). */
  canRender(text: string): boolean {
    return [...fold(text)].every((ch) => this.glyphs.has(ch) || !/\p{L}/u.test(ch));
  }

  measure(text: string): number {
    let w = 0;
    for (const ch of fold(text)) w += this.glyphs.get(ch)?.width ?? 4;
    return w;
  }

  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: TextStyle = {}) {
    const s = { ...DEFAULT, ...style };
    const colors = [null, s.color, s.shade, s.outline];
    for (const ch of fold(text)) {
      const g = this.glyphs.get(ch);
      if (!g) {
        x += 4;
        continue;
      }
      const gx = x + (g.dx ?? 0);
      // Outline pass gives the game's dark drop shadow even for single-color glyphs.
      ctx.fillStyle = s.outline;
      for (let i = 0; i < 64; i++) if (g.px[i]) ctx.fillRect(gx + (i & 7) + 1, y + (i >> 3) + 1, 1, 1);
      for (let i = 0; i < 64; i++) {
        const c = colors[g.px[i]];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(gx + (i & 7), y + (i >> 3), 1, 1);
      }
      x += g.width;
    }
  }

  /** A canvas of the text at 1x; scale it with CSS (image-rendering: pixelated). */
  canvas(text: string, style: TextStyle = {}): HTMLCanvasElement {
    const key = `${text}\u0000${JSON.stringify(style)}`;
    const hit = this.cache.get(key);
    if (hit) return this.copy(hit);
    const c = document.createElement('canvas');
    c.width = Math.max(1, this.measure(text) + 1);
    c.height = 9;
    this.draw(ctx2d(c), text, 0, 0, style);
    c.className = 'px';
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(key, c);
    return this.copy(c);
  }

  private copy(src: HTMLCanvasElement): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.className = src.className;
    ctx2d(c).drawImage(src, 0, 0);
    return c;
  }
}

export function spriteCanvas(s: Sprite): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = s.w;
  c.height = s.h;
  c.className = 'px';
  ctx2d(c).putImageData(new ImageData(Uint8ClampedArray.from(s.rgba), s.w, s.h), 0, 0);
  return c;
}
