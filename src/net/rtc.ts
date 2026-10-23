// Local-network WebRTC with manual signaling: the offer/answer travel as codes (QR or copy-paste),
// and no ICE servers are configured, so only local (LAN / virtual LAN) addresses are ever used.
// The host's room code never changes: it only names the room. Each guest makes the offer (a
// request code) and the host answers it (an answer code), one pair per guest.
import { NET } from '../shared/index.js';

export const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

const GATHER_TIMEOUT_MS = 4000;

export type CodeKind = 'room' | 'request' | 'answer';

interface CodePayload {
  v: number; // NET.protocol
  k: 't' | 'q' | 'a';
  s: string; // SDP (empty in a room code)
  n?: string; // who made it (shown to the other side)
}

const PREFIX = { room: 'HWT', request: 'HWQ', answer: 'HWA' } as const;
const KIND_KEY = { room: 't', request: 'q', answer: 'a' } as const;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCodePoint(b);
  const b64 = btoa(bin).replaceAll('+', '-').replaceAll('/', '_');
  let end = b64.length;
  while (end > 0 && b64[end - 1] === '=') end--;
  return b64.slice(0, end);
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(b64), (c) => c.codePointAt(0) ?? 0);
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data.slice()]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Compressed, URL-safe code for an SDP (about 400–700 characters; a room code is tiny). */
export async function encodeCode(kind: CodeKind, sdp: string, name?: string): Promise<string> {
  const payload: CodePayload = {
    v: NET.protocol,
    k: KIND_KEY[kind],
    s: sdp,
    ...(name ? { n: name } : {}),
  };
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate-raw'));
  return `${PREFIX[kind]}.${toBase64Url(packed)}`;
}

export class CodeError extends Error {
  constructor(readonly code: 'bad_code' | 'wrong_kind' | 'version_mismatch') {
    super(code);
  }
}

export async function decodeCode(kind: CodeKind, text: string): Promise<{ sdp: string; name?: string }> {
  const trimmed = text.replaceAll(/\s+/g, '');
  const [prefix, body] = trimmed.split('.');
  if (!body) throw new CodeError('bad_code');
  if (prefix !== PREFIX[kind])
    throw new CodeError(Object.values(PREFIX).includes(prefix as never) ? 'wrong_kind' : 'bad_code');
  let payload: CodePayload;
  try {
    const raw = await pipe(fromBase64Url(body), new DecompressionStream('deflate-raw'));
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new CodeError('bad_code');
  }
  if (payload.v !== NET.protocol) throw new CodeError('version_mismatch');
  if (typeof payload.s !== 'string' || payload.k !== KIND_KEY[kind]) throw new CodeError('bad_code');
  return { sdp: payload.s, name: typeof payload.n === 'string' ? payload.n.slice(0, 16) : undefined };
}

/** A link that opens the app ready to join this room (the room QR code holds it). */
export const roomLink = (room: string) => `${location.origin}${location.pathname}#room=${room}`;

/** The code inside a room link, or the text itself when it is a bare code. */
export const codeFromText = (text: string) => new URLSearchParams(text.split('#')[1] ?? '').get('room') ?? text;

/** The room code carried by the page's own address, if it was opened from a room link. */
export const linkedRoom = () => new URLSearchParams(location.hash.slice(1)).get('room') ?? undefined;

/** Removes the room from the address once used, so a reload starts clean. */
export const clearLinkedRoom = () => history.replaceState(null, '', location.pathname + location.search);

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const isIPv4 = (ip: string) => {
  const m = IPV4.exec(ip.trim());
  return !!m && m.slice(1).every((part) => Number(part) <= 255);
};

/**
 * Browsers hide local addresses behind random `.local` names, which resolve on a normal LAN
 * but not always across virtual LANs (Radmin, Hamachi). Adding the same ports on a typed IP
 * gives the other side an address it can reach directly.
 */
export function withAddress(sdp: string, ip: string): string {
  if (!isIPv4(ip)) return sdp;
  const lines = sdp.split('\r\n');
  const extra: string[] = [];
  for (const line of lines) {
    const m = /^a=candidate:(\S+) (\d+) (udp|tcp) (\d+) (\S+) (\d+) typ host(.*)$/i.exec(line);
    if (!m?.[5].endsWith('.local')) continue;
    extra.push(`a=candidate:${m[1]}9 ${m[2]} ${m[3]} ${m[4]} ${ip.trim()} ${m[6]} typ host${m[7]}`);
  }
  if (!extra.length) return sdp;
  // Insert after the last candidate line so the media section stays well-formed.
  const last = lines.findLastIndex((l) => l.startsWith('a=candidate:'));
  lines.splice(last + 1, 0, ...extra);
  return lines.join('\r\n');
}

/** Waits until all local candidates are in the SDP (no trickle: the code is sent once). */
export function iceGathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState !== 'complete') return;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', done);
      resolve();
    };
    const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', done);
  });
}

export const localSdp = (pc: RTCPeerConnection, ip?: string) => {
  const sdp = pc.localDescription?.sdp ?? '';
  return ip ? withAddress(sdp, ip) : sdp;
};
