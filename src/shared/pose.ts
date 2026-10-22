import type { PoseData } from './protocol.js';

export const POSE_MAX = 64; // max width/height of a captured sprite

/** SNES BGR555 color word to 8-bit RGB, replicating the high bits like the PPU's DAC. */
export function bgr555(c: number): [number, number, number] {
  const r = c & 31;
  const g = (c >> 5) & 31;
  const b = (c >> 10) & 31;
  return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2)];
}

// Base64 without Buffer/atob so the same code runs in browsers and Node.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

function fromBase64(s: string): Uint8Array {
  let end = s.length;
  while (end > 0 && s[end - 1] === '=') end--;
  const clean = s.slice(0, end);
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) |
      (B64.indexOf(clean[i + 3] ?? 'A') & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** RLE as (count, value) byte pairs; sprites are mostly transparent so this packs well. */
export function packPixels(pixels: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < pixels.length; ) {
    const v = pixels[i];
    let n = 1;
    while (n < 255 && i + n < pixels.length && pixels[i + n] === v) n++;
    out.push(n, v);
    i += n;
  }
  return toBase64(Uint8Array.from(out));
}

export function unpackPixels(px: string, size: number): Uint8Array {
  const rle = fromBase64(px);
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i + 1 < rle.length && o < size; i += 2) {
    out.fill(rle[i + 1], o, Math.min(size, o + rle[i]));
    o += rle[i];
  }
  return out;
}

function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0;
  for (const ch of str) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Content hash so identical poses are shared and cached by every client. */
export function poseHash(p: Omit<PoseData, 'hash'>): string {
  const key = `${p.w},${p.h},${p.ox},${p.oy}|${p.px}|${JSON.stringify(p.pals)}`;
  return fnv1a(key, 0x811c9dc5).toString(16).padStart(8, '0') + fnv1a(key, 0x2f1a3b5d).toString(16).padStart(8, '0');
}

export function isValidPose(p: PoseData): boolean {
  if (!p || typeof p.px !== 'string' || p.px.length > 8192) return false;
  if (![p.w, p.h, p.ox, p.oy].every(Number.isInteger)) return false;
  if (p.w < 1 || p.h < 1 || p.w > POSE_MAX || p.h > POSE_MAX) return false;
  if (!p.pals || typeof p.pals !== 'object') return false;
  const pals = Object.entries(p.pals);
  if (pals.length > 8) return false;
  for (const [k, v] of pals) {
    if (!/^[0-7]$/.test(k) || !Array.isArray(v) || v.length !== 16 || !v.every((c) => Number.isInteger(c)))
      return false;
  }
  return poseHash(p) === p.hash;
}
