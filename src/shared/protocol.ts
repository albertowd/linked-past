import type { Direction, Inventory } from './alttp.js';

/** Link mode can fight other Link-mode players; Zelda mode is non-combat. Both can trade. */
export type Mode = 'link' | 'zelda';

export type TradeLine = { item: 'rupees' | 'bombs' | 'arrows'; qty: number } | { item: 'bottle'; content: number };

/**
 * A captured Link sprite. Pixels are row-major bytes of (palette << 4 | colorIndex),
 * 0 meaning transparent, RLE-packed then base64'd. Palettes are BGR555 words, 16 per row.
 */
export interface PoseData {
  hash: string;
  w: number;
  h: number;
  ox: number; // offset from Link's world X/Y to the top-left of the image
  oy: number;
  px: string;
  pals: Record<number, number[]>;
}

export interface PlayerState {
  zone: string;
  x: number;
  y: number;
  dir: Direction;
  ghost: boolean;
  pose: string | null;
  health: number;
  maxHealth: number;
  armor: number;
  sword: number;
  inv: Inventory;
}

/** What other clients see about a player in their zone. */
export interface PlayerView {
  id: string;
  name: string;
  mode: Mode;
  zone: string;
  x: number;
  y: number;
  dir: Direction;
  ghost: boolean;
  pose: string | null;
  health: number;
  maxHealth: number;
}

/** Low-rate world map entry for every connected player. */
export interface RosterEntry {
  id: string;
  name: string;
  mode: Mode;
  zone: string;
  x: number;
  y: number;
  ghost: boolean;
}

/** A copy of the world for up to NET.roomCap players. */
export interface RoomInfo {
  id: string;
  size: number;
  cap: number;
}

/** First message a player sends to the host. */
export interface Hello {
  v: number; // NET.protocol; host and guests must match
  name: string;
  mode: Mode;
  rom: string; // SHA-1 of the player's cartridge
}

export interface RomChallenge {
  offset: number;
  length: number;
}

export type ClientMessage =
  | { t: 'proof'; digests: string[] }
  | { t: 'hello'; hello: Hello }
  | { t: 'state'; s: PlayerState }
  | { t: 'pose'; pose: PoseData }
  | { t: 'pose?'; hash: string }
  | { t: 'attack'; x: number; y: number; dir: Direction; spin?: boolean }
  | { t: 'trade.offer'; to: string; give: TradeLine[]; want: TradeLine[] }
  | { t: 'trade.reply'; tradeId: string; accept: boolean }
  | { t: 'trade.ack'; tradeId: string; phase: 'debit' | 'credit' | 'refund'; ok: boolean; reason?: string }
  | { t: 'chat'; text: string };

export type ServerMessage =
  | { t: 'challenge'; ranges: RomChallenge[] }
  | { t: 'welcome'; you: { id: string; name: string; mode: Mode }; room: RoomInfo }
  /** Sent by the hosting browser to every peer that joins the room, so guests know who hosts. */
  | { t: 'host'; room: RoomInfo; v: number; since: number }
  | { t: 'error'; code: string; message: string }
  // near/roster are deltas: `players` are new or changed entries, `gone` the ids that left.
  // `full: true` replaces the whole set (on join and as a periodic keyframe).
  | { t: 'near'; players: PlayerView[]; gone: string[]; full?: boolean }
  | { t: 'roster'; players: RosterEntry[]; gone: string[]; full?: boolean }
  | { t: 'pose'; pose: PoseData }
  | { t: 'hit'; from: string; damage: number; kx: number; ky: number }
  | { t: 'trade.incoming'; tradeId: string; from: string; fromName: string; give: TradeLine[]; want: TradeLine[] }
  | { t: 'trade.debit'; tradeId: string; give: TradeLine[]; receive: TradeLine[] }
  | { t: 'trade.credit'; tradeId: string; receive: TradeLine[] }
  | { t: 'trade.refund'; tradeId: string; give: TradeLine[] }
  | { t: 'trade.closed'; tradeId: string; status: 'done' | 'declined' | 'failed' | 'expired'; reason?: string }
  | { t: 'chat'; from: string; name: string; text: string };

export const NET = {
  /** Bump when messages change incompatibly; a host only accepts guests on the same version. */
  protocol: 1,
  stateHz: 20,
  roomCap: 20,
  rosterIntervalMs: 1000,
  /** Nothing is resent unless it changed, but every stream refreshes at least this often. */
  keyframeMs: 30_000,
  /** World-map positions are rounded to this many pixels (one map pixel) before diffing. */
  rosterGrid: 32,
  tradeTimeoutMs: 30_000,
  maxChat: 120,
} as const;
