// Writes multiplayer effects into the game's RAM. All addresses verified on every supported region.

import type { Core } from '../emu/core.js';
import {
  applyLines,
  canGive,
  canReceive,
  type Inventory,
  isCutscene,
  RAM,
  readSnapshot,
  type TradeLine,
} from '../shared/index.js';

const signed = (v: number) => v & 0xff;

/** Applies a PvP hit through the game's own damage path ($0373), plus knockback. */
export function applyHit(core: Core, damage: number, kx: number, ky: number): boolean {
  const wram = core.wram();
  const s = readSnapshot(wram);
  if (isCutscene(s) || s.invincible || s.health === 0) return false;
  wram[RAM.pendingDamage] = Math.min(damage, 0xff);
  wram[RAM.recoilState] = 1;
  wram[RAM.recoilTimer] = 20;
  wram[RAM.recoilX] = signed(kx);
  wram[RAM.recoilY] = signed(ky);
  wram[RAM.recoilZ] = 0x14;
  return true;
}

function writeInventory(core: Core, inv: Inventory) {
  const wram = core.wram();
  wram[RAM.rupees] = inv.rupees & 0xff;
  wram[RAM.rupees + 1] = inv.rupees >> 8;
  wram[RAM.bombs] = inv.bombs;
  wram[RAM.arrows] = inv.arrows;
  wram.set(inv.bottles, RAM.bottles);
}

/** Phase 1 of a trade: pay our side, after checking we can also hold what we will get. */
export function debit(core: Core, give: TradeLine[], receive: TradeLine[]): boolean {
  const s = readSnapshot(core.wram());
  if (isCutscene(s) || !canGive(s.inventory, give) || !canReceive(s.inventory, receive, give)) return false;
  writeInventory(core, applyLines(s.inventory, give, -1));
  return true;
}

/** Phase 2 (or a refund): add items. Capacity was reserved during debit, so clamp defensively. */
export function credit(core: Core, lines: TradeLine[]): void {
  const inv = applyLines(readSnapshot(core.wram()).inventory, lines, 1);
  inv.rupees = Math.min(inv.rupees, 999);
  inv.bombs = Math.min(inv.bombs, inv.maxBombs);
  inv.arrows = Math.min(inv.arrows, inv.maxArrows);
  writeInventory(core, inv);
}
