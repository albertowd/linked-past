import type { Core } from '../emu/core.js';
import { type LinkSnapshot, POSE_MAX, type PoseData, packPixels, poseHash } from '../shared/index.js';

const BOX = 48; // capture window around Link, in pixels
const ORIGIN = 16; // Link's X/Y sits this far into the window
const LINK_TILE_LIMIT = 0x20; // Link's body, sword and shield are DMA'd into OBJ tiles $00-$1F
const SHADOW_TILE = 0x6c;

interface ObjEntry {
  x: number; // screen position
  y: number;
  tile: number;
  size: 8 | 16;
  pal: number;
  hflip: boolean;
  vflip: boolean;
}

/** Decodes OAM slot i (low table + high-table size/X9 bits); undefined when not visible. */
function readObj(oam: Uint8Array, i: number): ObjEntry | undefined {
  const y = oam[i * 4 + 1];
  const attr = oam[i * 4 + 3];
  if (y >= 224 || attr & 1) return undefined; // hidden, or second name table
  const hi = (oam[512 + (i >> 2)] >> ((i & 3) * 2)) & 3;
  return {
    x: oam[i * 4] - (hi & 1 ? 256 : 0),
    y,
    tile: oam[i * 4 + 2],
    size: hi & 2 ? 16 : 8,
    pal: (attr >> 1) & 7,
    hflip: (attr & 0x40) !== 0,
    vflip: (attr & 0x80) !== 0,
  };
}

const isLinkObj = (o: ObjEntry, lx: number, ly: number) =>
  (o.tile < LINK_TILE_LIMIT || o.tile === SHADOW_TILE) && Math.abs(o.x - lx) <= 24 && Math.abs(o.y - ly) <= 24;

/** 4bpp color index of pixel (sx, sy) inside an object, following 16-tile VRAM rows. */
function objPixel(vram: Uint8Array, base: number, tile: number, sx: number, sy: number): number {
  const t = (tile + (sx >> 3) + ((sy >> 3) << 4)) & 0xff;
  const o = base + t * 32 + (sy & 7) * 2;
  const bit = 7 - (sx & 7);
  return (
    ((vram[o] >> bit) & 1) |
    (((vram[o + 1] >> bit) & 1) << 1) |
    (((vram[o + 16] >> bit) & 1) << 2) |
    (((vram[o + 17] >> bit) & 1) << 3)
  );
}

/** Paints one object into the capture window; returns how many pixels it drew. */
function paintObj(buf: Uint8Array, vram: Uint8Array, base: number, o: ObjEntry, left: number, top: number): number {
  let drawn = 0;
  for (let yy = 0; yy < o.size; yy++) {
    const py = top + yy;
    if (py >= 0 && py < BOX) drawn += paintRow(buf, vram, base, o, left, py, o.vflip ? o.size - 1 - yy : yy);
  }
  return drawn;
}

function paintRow(buf: Uint8Array, vram: Uint8Array, base: number, o: ObjEntry, left: number, py: number, sy: number) {
  let drawn = 0;
  for (let xx = 0; xx < o.size; xx++) {
    const px = left + xx;
    if (px < 0 || px >= BOX) continue;
    const v = objPixel(vram, base, o.tile, o.hflip ? o.size - 1 - xx : xx, sy);
    if (!v) continue;
    buf[py * BOX + px] = (o.pal << 4) | v;
    drawn++;
  }
  return drawn;
}

/** Tight bounding box of non-transparent pixels. */
function cropBox(buf: Uint8Array) {
  let minX = BOX;
  let minY = BOX;
  let maxX = -1;
  let maxY = -1;
  buf.forEach((v, i) => {
    if (!v) return;
    const x = i % BOX;
    const y = Math.floor(i / BOX);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  return { minX, minY, w: Math.min(POSE_MAX, maxX - minX + 1), h: Math.min(POSE_MAX, maxY - minY + 1) };
}

/**
 * Captures how Link looks this frame by re-rendering his OAM entries from VRAM.
 * Works for every supported ROM region since it reads what the PPU is showing.
 */
export function captureLink(core: Core, s: LinkSnapshot): PoseData | null {
  const oam = core.oam();
  const vram = core.vram();
  const base = core.objNameBase();
  const lx = s.x - s.cameraX;
  const ly = s.y - s.cameraY;
  const buf = new Uint8Array(BOX * BOX);
  const used = new Set<number>();
  let drawn = 0;

  // Lower OAM index has priority, so paint from the back.
  for (let i = 127; i >= 0; i--) {
    const o = readObj(oam, i);
    if (!o || !isLinkObj(o, lx, ly)) continue;
    const n = paintObj(buf, vram, base, o, o.x - lx + ORIGIN, o.y - ly + ORIGIN);
    if (n) used.add(o.pal);
    drawn += n;
  }
  if (drawn < 16) return null; // Link is blinking or off screen this frame

  const { minX, minY, w, h } = cropBox(buf);
  const crop = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) crop.set(buf.subarray((minY + y) * BOX + minX, (minY + y) * BOX + minX + w), y * w);

  const cgram = core.cgram();
  const pals: Record<number, number[]> = {};
  for (const p of used) pals[p] = Array.from(cgram.subarray(128 + p * 16, 128 + p * 16 + 16));
  const pose = { w, h, ox: minX - ORIGIN, oy: minY - ORIGIN, px: packPixels(crop), pals };
  return { ...pose, hash: poseHash(pose) };
}
