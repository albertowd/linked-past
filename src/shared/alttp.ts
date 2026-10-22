// A Link to the Past (USA 1.0) WRAM map. Offsets are relative to $7E0000.
// Every address below was checked against the running game with the Node test harness.
export const RAM = {
  module: 0x0010, // main game module: 0x07 underworld, 0x09 overworld, 0x0e text/menus
  submodule: 0x0011, // non-zero during transitions inside a module
  indoors: 0x001b,
  linkY: 0x0020, // u16, absolute world coordinates
  linkX: 0x0022, // u16
  linkZ: 0x0024, // height while hopping/recoiling
  recoilY: 0x0027, // signed recoil velocity
  recoilX: 0x0028,
  recoilZ: 0x0029,
  direction: 0x002f, // 0 up, 2 down, 4 left, 6 right
  recoilTimer: 0x0046,
  recoilState: 0x004d, // 1 while being knocked back
  linkState: 0x005d, // 0 normal; other values are scripted/special states
  overworldArea: 0x008a,
  room: 0x00a0, // u16 underworld room id
  cameraX: 0x00e2, // u16 BG2 horizontal scroll
  cameraY: 0x00e8, // u16 BG2 vertical scroll
  freeze: 0x02e4, // non-zero while the game freezes Link (cutscenes, dialogs)
  invincibility: 0x031f, // blink timer after taking damage
  pendingDamage: 0x0373, // the game applies this much damage to Link on its next frame
  // Save data mirror (persisted to SRAM by the game).
  sword: 0xf359,
  shield: 0xf35a,
  armor: 0xf35b, // 0 green, 1 blue, 2 red mail
  bottles: 0xf35c, // 4 bytes
  rupees: 0xf360, // u16 real value; the HUD counts $f362 towards it
  rupeesDisplay: 0xf362,
  bombs: 0xf343,
  maxHealth: 0xf36c, // in 1/8 hearts
  health: 0xf36d,
  bombUpgrades: 0xf370,
  arrowUpgrades: 0xf371,
  arrows: 0xf377,
} as const;

export const MODULE = { underworld: 0x07, overworld: 0x09, text: 0x0e } as const;

export enum Direction {
  Up = 0,
  Down = 2,
  Left = 4,
  Right = 6,
}

export const BOTTLE = {
  none: 0,
  mushroom: 1,
  empty: 2,
  redPotion: 3,
  greenPotion: 4,
  bluePotion: 5,
  fairy: 6,
  bee: 7,
  goodBee: 8,
} as const;

export interface Inventory {
  rupees: number;
  bombs: number;
  maxBombs: number;
  arrows: number;
  maxArrows: number;
  bottles: number[]; // BOTTLE values per slot
}

export interface LinkSnapshot {
  module: number;
  submodule: number;
  indoors: boolean;
  x: number;
  y: number;
  z: number;
  direction: Direction;
  linkState: number;
  area: number;
  room: number;
  cameraX: number;
  cameraY: number;
  frozen: boolean;
  invincible: boolean;
  sword: number;
  armor: number;
  health: number;
  maxHealth: number;
  inventory: Inventory;
}

const u16 = (w: Uint8Array, a: number) => w[a] | (w[a + 1] << 8);

// Capacity per upgrade level (Pond of Happiness), as the game's own capacity tables.
const BOMB_CAPACITY = [10, 15, 20, 25, 30, 35, 40, 50];
const ARROW_CAPACITY = [30, 35, 40, 45, 50, 55, 60, 70];

export function readSnapshot(wram: Uint8Array): LinkSnapshot {
  return {
    module: wram[RAM.module],
    submodule: wram[RAM.submodule],
    indoors: wram[RAM.indoors] !== 0,
    x: u16(wram, RAM.linkX),
    y: u16(wram, RAM.linkY),
    z: wram[RAM.linkZ],
    direction: wram[RAM.direction] as Direction,
    linkState: wram[RAM.linkState],
    area: wram[RAM.overworldArea],
    room: u16(wram, RAM.room),
    cameraX: u16(wram, RAM.cameraX),
    cameraY: u16(wram, RAM.cameraY),
    frozen: wram[RAM.freeze] !== 0,
    invincible: wram[RAM.invincibility] !== 0,
    sword: wram[RAM.sword],
    armor: wram[RAM.armor],
    health: wram[RAM.health],
    maxHealth: wram[RAM.maxHealth],
    inventory: {
      rupees: u16(wram, RAM.rupees),
      bombs: wram[RAM.bombs],
      maxBombs: BOMB_CAPACITY[wram[RAM.bombUpgrades] & 7],
      arrows: wram[RAM.arrows],
      maxArrows: ARROW_CAPACITY[wram[RAM.arrowUpgrades] & 7],
      bottles: Array.from(wram.subarray(RAM.bottles, RAM.bottles + 4)),
    },
  };
}

/** True while Link is under game control (cutscene, dialog, transition, menu, file select...). */
export function isCutscene(s: LinkSnapshot): boolean {
  const playable = s.module === MODULE.overworld || s.module === MODULE.underworld;
  return !playable || s.submodule !== 0 || s.frozen || s.linkState === 0x16;
}

/**
 * Players only see each other inside the same zone: one shared coordinate space per
 * overworld (light, dark, special) and one per underworld room.
 */
export function zoneOf(s: LinkSnapshot): string {
  if (s.module !== MODULE.overworld && s.module !== MODULE.underworld) return 'limbo';
  return s.indoors ? `uw:${s.room.toString(16)}` : `ow:${s.area >> 6}`;
}
