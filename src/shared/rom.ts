export type Locale = 'en' | 'fr' | 'de';

export interface RomInfo {
  sha1: string;
  region: 'usa' | 'canada' | 'europe' | 'france' | 'germany';
  locale: Locale;
  fps: number;
}

/**
 * Supported unheadered dumps. All five share the same WRAM layout, VRAM tile layout and HUD,
 * which was verified with the headless harness (boot, movement, damage, inventory writes).
 */
export const ROMS: RomInfo[] = [
  { sha1: '6d4f10a8b10e10dbe624cb23cf03b88bb8252973', region: 'usa', locale: 'en', fps: 60.0988 },
  { sha1: 'c1c6c7f76fff936c534ff11f87a54162fc0aa100', region: 'canada', locale: 'fr', fps: 60.0988 },
  { sha1: '7c073a222569b9b8e8ca5fcb5dfec3b5e31da895', region: 'europe', locale: 'en', fps: 50.007 },
  { sha1: '229364a1b92a05167cd38609b1aa98f7041987cc', region: 'france', locale: 'fr', fps: 50.007 },
  { sha1: '2e62494967fb0afdf5da1635607f9641df7c6559', region: 'germany', locale: 'de', fps: 50.007 },
];

export const ROM_SIZE = 0x100000;
const COPIER_HEADER = 0x200;

export const romBySha1 = (sha1: string) => ROMS.find((r) => r.sha1 === sha1.toLowerCase());

/** Copier dumps carry a 512-byte header; strip it so hashes match the clean ROM. */
export function stripHeader(data: Uint8Array): Uint8Array {
  return data.length === ROM_SIZE + COPIER_HEADER ? data.subarray(COPIER_HEADER) : data;
}
