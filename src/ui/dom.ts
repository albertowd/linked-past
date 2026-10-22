import type { PixelFont, TextStyle } from './font.js';

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; dataset?: Record<string, string> } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, dataset, ...rest } = props;
  if (cls) el.className = cls;
  if (dataset) Object.assign(el.dataset, dataset);
  Object.assign(el, rest);
  for (const c of children) if (c) el.append(c);
  return el;
}

/** 2D context of a canvas; canvases always have one, so a missing context is a real bug. */
export function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

export function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return el;
}

let font: PixelFont | undefined;
export const setFont = (f: PixelFont) => (font = f);

/** Text in the game font when the atlas is ready, plain text before that. */
export function label(text: string, style?: TextStyle, scale = 2): HTMLElement {
  const wrap = h('span', { class: 'label', title: text });
  wrap.style.setProperty('--s', String(scale));
  if (font) wrap.append(font.canvas(text, style));
  else wrap.textContent = text;
  wrap.setAttribute('aria-label', text);
  return wrap;
}

/** A framed panel like the game's menus and text boxes. */
export const panel = (cls: string, ...children: Child[]) => h('section', { class: `panel ${cls}` }, ...children);
