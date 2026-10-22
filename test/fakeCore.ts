import type { Core } from '../src/emu/core.js';
import { RAM } from '../src/shared/index.js';

/** Just the memory views the game logic reads, backed by plain arrays. */
export function fakeCore() {
  const wram = new Uint8Array(0x20000);
  const vram = new Uint8Array(0x10000);
  const oam = new Uint8Array(544);
  const cgram = new Uint16Array(256);
  // Default: standing on the overworld, healthy, with a sword.
  wram[RAM.module] = 0x09;
  wram[RAM.health] = 24;
  wram[RAM.maxHealth] = 24;
  wram[RAM.sword] = 1;
  const core = {
    wram: () => wram,
    vram: () => vram,
    oam: () => oam,
    cgram: () => cgram,
    objNameBase: () => 0x8000,
  } as unknown as Core;
  // Hide every sprite (y = 240) like the game does for unused OAM slots.
  for (let i = 0; i < 128; i++) oam[i * 4 + 1] = 240;
  return { core, wram, vram, oam, cgram };
}
