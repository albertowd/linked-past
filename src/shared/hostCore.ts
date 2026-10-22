// The hosting player's side of a room, independent of transport: peers say hello, prove they
// own a supported cartridge, then play inside one World. The browser wires this to WebRTC.
import type { ClientMessage, Hello, Mode, RoomInfo, ServerMessage } from './protocol.js';
import { NET } from './protocol.js';
import { type ChallengeTable, checkProof, createProof, type PendingProof, proofRanges } from './romProof.js';
import { type Conn, World } from './world.js';

export interface HostOutput {
  send(peer: string, msg: ServerMessage): void;
  /** Disconnect a peer with a reason (version mismatch, full room, failed proof...). */
  kick(peer: string, code: string, message: string): void;
}

interface Peer {
  hello?: Hello;
  proof?: PendingProof;
  playerId?: string;
}

const NAME = /^[\p{L}\p{N} _-]{1,16}$/u;
const MODES = new Set<Mode>(['link', 'zelda']);

export const LOCAL_PEER = 'local';

export class HostCore {
  readonly world: World;
  private readonly peers = new Map<string, Peer>();

  constructor(
    readonly room: string,
    private readonly out: HostOutput,
    private readonly opts: { table?: ChallengeTable; cap?: number; now?: () => number; since?: number } = {},
  ) {
    this.world = new World(room, opts.cap ?? NET.roomCap, opts.now);
  }

  /** When hosting started; if two browsers host the same room name, the newer one yields. */
  get since() {
    return this.opts.since ?? 0;
  }

  info(): RoomInfo {
    return this.world.info();
  }

  /** A peer connected at the transport level; tell it who hosts. */
  connect(peer: string) {
    if (!this.peers.has(peer)) this.peers.set(peer, {});
    this.out.send(peer, { t: 'host', room: this.info(), v: NET.protocol, since: this.since });
  }

  message(peer: string, msg: ClientMessage) {
    if (!msg || typeof msg !== 'object') return;
    let p = this.peers.get(peer);
    if (!p) {
      p = {};
      this.peers.set(peer, p);
    }
    if (p.playerId) return this.world.onMessage(p.playerId, msg);
    if (msg.t === 'hello' && !p.hello) return this.hello(peer, p, msg.hello);
    if (msg.t === 'proof' && p.proof && p.hello) {
      if (!checkProof(p.proof, msg.digests))
        return this.reject(peer, 'rom_proof_failed', 'Could not verify your cartridge.');
      p.proof = undefined;
      this.enter(peer, p, p.hello);
    }
  }

  disconnect(peer: string) {
    const p = this.peers.get(peer);
    this.peers.delete(peer);
    if (p?.playerId) this.world.leave(p.playerId);
  }

  tick() {
    this.world.tick();
  }

  sendRoster() {
    this.world.sendRoster();
  }

  private hello(peer: string, p: Peer, hello: Hello) {
    if (!hello || typeof hello !== 'object' || hello.v !== NET.protocol)
      return this.reject(peer, 'version_mismatch', 'Different game version: everyone needs the same app version.');
    if (typeof hello.name !== 'string' || !NAME.test(hello.name.trim()) || !MODES.has(hello.mode))
      return this.reject(peer, 'bad_hello', 'Invalid player name.');
    if (this.world.full) return this.reject(peer, 'room_full', 'This room is full.');
    p.hello = { ...hello, name: this.uniqueName(hello.name.trim()) };
    if (peer === LOCAL_PEER) return this.enter(peer, p, p.hello);
    const proof = this.opts.table && createProof(this.opts.table, String(hello.rom).toLowerCase());
    if (!proof) return this.reject(peer, 'unsupported_rom', 'This cartridge is not supported.');
    p.proof = proof;
    this.out.send(peer, { t: 'challenge', ranges: proofRanges(proof) });
  }

  private enter(peer: string, p: Peer, hello: Hello) {
    const conn: Conn = {
      send: (m) => this.out.send(peer, m),
      close: (_code, reason) => this.out.kick(peer, 'closed', reason),
    };
    p.playerId = this.world.join(conn, { id: peer, name: hello.name }, hello.mode);
  }

  private reject(peer: string, code: string, message: string) {
    this.out.send(peer, { t: 'error', code, message });
    this.out.kick(peer, code, message);
    this.peers.delete(peer);
  }

  /** Two "Link"s in one room become "Link" and "Link 2". */
  private uniqueName(name: string) {
    const taken = new Set(
      [...this.peers.values()].flatMap((p) => (p.playerId && p.hello ? [p.hello.name.toLowerCase()] : [])),
    );
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }
}
