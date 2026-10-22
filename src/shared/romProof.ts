import type { RomChallenge } from './protocol.js';
import { romBySha1 } from './rom.js';

/** Per ROM SHA-1: [offset, length, sha256 of that slice]. Hashes only, never ROM bytes. */
export type ChallengeTable = Record<string, [offset: number, length: number, sha256: string][]>;
type Entry = ChallengeTable[string][number];
const ROUNDS = 4;

export interface PendingProof {
  romSha1: string;
  entries: Entry[];
}

function randomIndex(n: number): number {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % n;
}

/** Picks random slices of the claimed ROM; only a holder of that ROM can hash them. */
export function createProof(table: ChallengeTable, romSha1: string): PendingProof | undefined {
  const all = table[romSha1];
  if (!all?.length || !romBySha1(romSha1)) return undefined;
  const entries = Array.from({ length: ROUNDS }, () => all[randomIndex(all.length)]);
  return { romSha1, entries };
}

export const proofRanges = (p: PendingProof): RomChallenge[] =>
  p.entries.map(([offset, length]) => ({ offset, length }));

export function checkProof(p: PendingProof, digests: unknown): boolean {
  return (
    Array.isArray(digests) &&
    digests.length === p.entries.length &&
    p.entries.every(([, , sha], i) => typeof digests[i] === 'string' && digests[i].toLowerCase() === sha)
  );
}
