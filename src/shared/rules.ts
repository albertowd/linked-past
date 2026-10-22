import { BOTTLE, Direction, type Inventory } from './alttp.js';
import type { Mode, TradeLine } from './protocol.js';

export const TRADE_RANGE = 48; // px between players
export const TRADABLE_BOTTLES: number[] = [
  BOTTLE.redPotion,
  BOTTLE.greenPotion,
  BOTTLE.bluePotion,
  BOTTLE.fairy,
  BOTTLE.bee,
  BOTTLE.goodBee,
];

// Link's world X/Y is the top-left of a ~16x24 body; combat uses its center.
const center = (x: number, y: number) => ({ cx: x + 8, cy: y + 12 });

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Does a sword swing from (ax, ay) facing dir reach a player standing at (bx, by)? */
export function swordReaches(ax: number, ay: number, dir: Direction, bx: number, by: number, spin = false): boolean {
  const a = center(ax, ay);
  const b = center(bx, by);
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  if (spin) return Math.hypot(dx, dy) <= 30;
  const reach = 26;
  const side = 14;
  switch (dir) {
    case Direction.Up:
      return dy <= 4 && dy >= -reach && Math.abs(dx) <= side;
    case Direction.Down:
      return dy >= -4 && dy <= reach && Math.abs(dx) <= side;
    case Direction.Left:
      return dx <= 4 && dx >= -reach && Math.abs(dy) <= side;
    case Direction.Right:
      return dx >= -4 && dx <= reach && Math.abs(dy) <= side;
    default:
      return false;
  }
}

/** Damage in 1/8 hearts, the unit the game uses. Mail halves (blue) or quarters (red) it. */
export function swordDamage(sword: number, targetArmor: number, spin = false): number {
  const base = [0, 4, 8, 12, 16][Math.min(Math.max(sword, 0), 4)] * (spin ? 2 : 1);
  return Math.max(1, Math.floor(base / 2 ** Math.min(Math.max(targetArmor, 0), 2)));
}

/** Knockback velocity (signed bytes) pushing the target away from the attacker. */
export function knockback(dir: Direction): { kx: number; ky: number } {
  const v = 0x20;
  switch (dir) {
    case Direction.Up:
      return { kx: 0, ky: -v };
    case Direction.Down:
      return { kx: 0, ky: v };
    case Direction.Left:
      return { kx: -v, ky: 0 };
    default:
      return { kx: v, ky: 0 };
  }
}

export const canFight = (mode: Mode) => mode === 'link';

export function isValidLine(line: TradeLine): boolean {
  if (line.item === 'bottle') return TRADABLE_BOTTLES.includes(line.content);
  return Number.isInteger(line.qty) && line.qty > 0 && line.qty <= 999;
}

/** Can this inventory give away all of `lines`? */
export function canGive(inv: Inventory, lines: TradeLine[]): boolean {
  const need = { rupees: 0, bombs: 0, arrows: 0 };
  const bottles = [...inv.bottles];
  for (const l of lines) {
    if (l.item === 'bottle') {
      const i = bottles.indexOf(l.content);
      if (i < 0) return false;
      bottles[i] = BOTTLE.empty;
    } else need[l.item] += l.qty;
  }
  return inv.rupees >= need.rupees && inv.bombs >= need.bombs && inv.arrows >= need.arrows;
}

/** Can this inventory hold `lines` after first giving away `giving`? */
export function canReceive(inv: Inventory, lines: TradeLine[], giving: TradeLine[] = []): boolean {
  const after = applyLines(inv, giving, -1);
  const add = { rupees: 0, bombs: 0, arrows: 0 };
  let bottlesNeeded = 0;
  for (const l of lines) {
    if (l.item === 'bottle') bottlesNeeded++;
    else add[l.item] += l.qty;
  }
  const emptyBottles = after.bottles.filter((b) => b === BOTTLE.empty).length;
  return (
    after.rupees + add.rupees <= 999 &&
    after.bombs + add.bombs <= inv.maxBombs &&
    after.arrows + add.arrows <= inv.maxArrows &&
    emptyBottles >= bottlesNeeded
  );
}

/** Pure inventory arithmetic; sign -1 removes lines, +1 adds them. */
export function applyLines(inv: Inventory, lines: TradeLine[], sign: 1 | -1): Inventory {
  const out: Inventory = { ...inv, bottles: [...inv.bottles] };
  for (const l of lines) {
    if (l.item === 'bottle') {
      const from = sign < 0 ? l.content : BOTTLE.empty;
      const to = sign < 0 ? BOTTLE.empty : l.content;
      const i = out.bottles.indexOf(from);
      if (i >= 0) out.bottles[i] = to;
    } else {
      out[l.item] += sign * l.qty;
    }
  }
  return out;
}

export function describeLine(l: TradeLine): string {
  if (l.item !== 'bottle') return `${l.qty} ${l.item}`;
  const names: Record<number, string> = {
    [BOTTLE.redPotion]: 'red potion',
    [BOTTLE.greenPotion]: 'green potion',
    [BOTTLE.bluePotion]: 'blue potion',
    [BOTTLE.fairy]: 'fairy',
    [BOTTLE.bee]: 'bee',
    [BOTTLE.goodBee]: 'good bee',
  };
  return names[l.content] ?? 'bottle';
}
