import { type RomChallenge, type RomInfo, romBySha1, stripHeader } from '../shared/index.js';
import * as db from './db.js';

export interface Cartridge {
  info: RomInfo;
  data: Uint8Array;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function identify(file: ArrayBuffer): Promise<Cartridge | undefined> {
  const data = new Uint8Array(stripHeader(new Uint8Array(file)));
  const info = romBySha1(hex(await crypto.subtle.digest('SHA-1', data)));
  return info && { info, data };
}

export async function loadSaved(): Promise<Cartridge | undefined> {
  const data = await db.get<Uint8Array>('rom');
  return data ? identify(data.buffer as ArrayBuffer) : undefined;
}

export const remember = (c: Cartridge) => db.set('rom', c.data);
export const forget = () => db.del('rom');

/** Answers the server's ownership challenge: SHA-256 of requested ROM slices. */
export async function prove(c: Cartridge, ranges: RomChallenge[]): Promise<string[]> {
  return Promise.all(
    ranges.map(async (r) => hex(await crypto.subtle.digest('SHA-256', c.data.slice(r.offset, r.offset + r.length)))),
  );
}
