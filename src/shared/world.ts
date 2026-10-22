import { DeltaStream, encodeItems } from './delta.js';
import { isValidPose } from './pose.js';
import {
  type ClientMessage,
  type Mode,
  NET,
  type PlayerState,
  type PlayerView,
  type PoseData,
  type RoomInfo,
  type RosterEntry,
  type ServerMessage,
  type TradeLine,
} from './protocol.js';
import {
  canFight,
  canGive,
  canReceive,
  distance,
  isValidLine,
  knockback,
  swordDamage,
  swordReaches,
  TRADE_RANGE,
} from './rules.js';

export interface Conn {
  send(msg: ServerMessage): void;
  close(code: number, reason: string): void;
}

interface Player {
  id: string;
  userId: string;
  name: string;
  mode: Mode;
  conn: Conn;
  state?: PlayerState;
  lastAttackAt: number;
  lastHitAt: number;
  lastChatAt: number;
  tradeId?: string;
  near: DeltaStream<PlayerView>;
  roster: DeltaStream<RosterEntry>;
}

type Ack = 'pending' | 'ok' | 'failed';
type Side = 'from' | 'to';

interface Trade {
  id: string;
  from: string;
  to: string;
  give: TradeLine[]; // from -> to
  want: TradeLine[]; // to -> from
  status: 'offered' | 'debiting' | 'crediting';
  debit: Record<Side, Ack>;
  credit: Record<Side, Ack>;
  createdAt: number;
}

const VIEW_RANGE = 384; // px: a screen plus margin
const ATTACK_COOLDOWN_MS = 250;
const HIT_INVULNERABLE_MS = 900;
const CHAT_COOLDOWN_MS = 400;
const MAX_POSES = 20_000;
const MAX_LINES = 4;

const isNum = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

function sanitizeState(s: unknown): PlayerState | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const v = s as PlayerState;
  const inv = v.inv;
  const ok =
    typeof v.zone === 'string' &&
    v.zone.length <= 16 &&
    isNum(v.x, 0, 0xffff) &&
    isNum(v.y, 0, 0xffff) &&
    [0, 2, 4, 6].includes(v.dir) &&
    typeof v.ghost === 'boolean' &&
    (v.pose === null || (typeof v.pose === 'string' && v.pose.length <= 32)) &&
    isNum(v.health, 0, 255) &&
    isNum(v.maxHealth, 0, 255) &&
    isNum(v.armor, 0, 2) &&
    isNum(v.sword, 0, 4) &&
    !!inv &&
    isNum(inv.rupees, 0, 999) &&
    isNum(inv.bombs, 0, 99) &&
    isNum(inv.maxBombs, 0, 99) &&
    isNum(inv.arrows, 0, 99) &&
    isNum(inv.maxArrows, 0, 99) &&
    Array.isArray(inv.bottles) &&
    inv.bottles.length === 4 &&
    inv.bottles.every((b) => isNum(b, 0, 8));
  return ok ? v : undefined;
}

/** Removes C0 control characters and DEL so chat can't inject terminal/layout tricks. */
export function stripControlChars(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

function sideOf(trade: Trade, playerId: string): Side | undefined {
  if (trade.from === playerId) return 'from';
  if (trade.to === playerId) return 'to';
  return undefined;
}

const validLines = (lines: unknown): lines is TradeLine[] =>
  Array.isArray(lines) && lines.length <= MAX_LINES && lines.every((l) => l && typeof l === 'object' && isValidLine(l));

/**
 * One room: an authoritative-ish copy of the world for up to `cap` players. Each client owns its emulator (and so its RAM); the
 * world relays presence, adjudicates PvP using its own copy of player positions, and
 * escrows trades in two phases (debit both sides, then credit both sides).
 */
export class World {
  private readonly players = new Map<string, Player>();
  private readonly poses = new Map<string, PoseData>();
  private readonly trades = new Map<string, Trade>();

  constructor(
    readonly id = '1',
    readonly cap: number = NET.roomCap,
    private readonly now: () => number = Date.now,
  ) {}

  get size() {
    return this.players.size;
  }

  get full() {
    return this.players.size >= this.cap;
  }

  info(): RoomInfo {
    return { id: this.id, size: this.players.size, cap: this.cap };
  }

  join(conn: Conn, user: { id: string; name: string }, mode: Mode): string {
    for (const p of this.players.values()) {
      if (p.userId === user.id) {
        p.conn.close(4001, 'signed in elsewhere');
        this.leave(p.id);
      }
    }
    const id = crypto.randomUUID();
    this.players.set(id, {
      id,
      userId: user.id,
      name: user.name,
      mode,
      conn,
      lastAttackAt: 0,
      lastHitAt: 0,
      lastChatAt: 0,
      near: new DeltaStream(NET.keyframeMs),
      roster: new DeltaStream(NET.keyframeMs),
    });
    conn.send({ t: 'welcome', you: { id, name: user.name, mode }, room: this.info() });
    this.sendRoster();
    return id;
  }

  leave(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.tradeId) this.abortTrade(p.tradeId, 'partner left');
    this.players.delete(id);
    this.sendRoster();
  }

  onMessage(id: string, msg: ClientMessage) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'state': {
        const s = sanitizeState(msg.s);
        if (s) p.state = s;
        break;
      }
      case 'pose':
        if (isValidPose(msg.pose)) this.storePose(msg.pose);
        break;
      case 'pose?': {
        const pose = this.poses.get(msg.hash);
        if (pose) p.conn.send({ t: 'pose', pose });
        break;
      }
      case 'attack':
        this.attack(p, !!msg.spin);
        break;
      case 'trade.offer':
        this.offer(p, msg.to, msg.give, msg.want);
        break;
      case 'trade.reply':
        this.reply(p, msg.tradeId, msg.accept === true);
        break;
      case 'trade.ack':
        this.ack(p, msg.tradeId, msg.phase, msg.ok === true);
        break;
      case 'chat':
        this.chat(p, msg.text);
        break;
    }
  }

  /**
   * Run at NET.stateHz: sends each player only the nearby players that changed since their last
   * update (and who left), with a full keyframe at least every NET.keyframeMs.
   */
  tick() {
    const t = this.now();
    for (const trade of this.trades.values()) {
      if (trade.status === 'offered' && t - trade.createdAt > NET.tradeTimeoutMs) this.closeTrade(trade, 'expired');
    }
    const live = [...this.players.values()].flatMap((p) => (p.state ? [{ p, s: p.state }] : []));
    for (const { p: me, s } of live) {
      const near: PlayerView[] = [];
      for (const { p: o, s: os } of live) {
        if (o === me || os.zone !== s.zone || distance(s.x, s.y, os.x, os.y) > VIEW_RANGE) continue;
        near.push({
          id: o.id,
          name: o.name,
          mode: o.mode,
          zone: os.zone,
          x: os.x,
          y: os.y,
          dir: os.dir,
          ghost: os.ghost,
          pose: os.pose,
          health: os.health,
          maxHealth: os.maxHealth,
        });
      }
      const delta = me.near.next(near, t);
      if (delta) me.conn.send({ t: 'near', ...delta });
    }
  }

  /**
   * World-map data for everyone, run every NET.rosterIntervalMs. Positions are snapped to one map
   * pixel, so walking around only produces an update when the dot on the map actually moves.
   */
  sendRoster() {
    const t = this.now();
    const grid = NET.rosterGrid;
    const players: RosterEntry[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      mode: p.mode,
      zone: p.state?.zone ?? 'limbo',
      x: Math.floor((p.state?.x ?? 0) / grid) * grid,
      y: Math.floor((p.state?.y ?? 0) / grid) * grid,
      ghost: p.state?.ghost ?? true,
    }));
    const encoded = encodeItems(players);
    for (const p of this.players.values()) {
      const delta = p.roster.next(players, t, encoded);
      if (delta) p.conn.send({ t: 'roster', ...delta });
    }
  }

  private storePose(pose: PoseData) {
    if (this.poses.has(pose.hash)) return;
    const oldest = this.poses.keys().next();
    if (this.poses.size >= MAX_POSES && !oldest.done) this.poses.delete(oldest.value);
    this.poses.set(pose.hash, pose);
  }

  private attack(p: Player, spin: boolean) {
    const t = this.now();
    const s = p.state;
    if (!s || s.ghost || !canFight(p.mode) || s.sword < 1 || t - p.lastAttackAt < ATTACK_COOLDOWN_MS) return;
    p.lastAttackAt = t;
    for (const o of this.players.values()) {
      const os = o.state;
      if (o === p || !os || os.ghost || !canFight(o.mode) || os.zone !== s.zone || os.health === 0) continue;
      if (t - o.lastHitAt < HIT_INVULNERABLE_MS) continue;
      if (!swordReaches(s.x, s.y, s.dir, os.x, os.y, spin)) continue;
      o.lastHitAt = t;
      const away = spin ? this.awayDir(s, os) : s.dir;
      o.conn.send({ t: 'hit', from: p.id, damage: swordDamage(s.sword, os.armor, spin), ...knockback(away) });
    }
  }

  private awayDir(a: PlayerState, b: PlayerState) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 4 : 6;
    return dy < 0 ? 0 : 2;
  }

  private offer(p: Player, toId: unknown, give: unknown, want: unknown) {
    const target = typeof toId === 'string' ? this.players.get(toId) : undefined;
    const reject = (reason: string) => p.conn.send({ t: 'trade.closed', tradeId: '', status: 'failed', reason });
    if (!target || target === p) return reject('player not found');
    if (!validLines(give) || !validLines(want) || give.length + want.length === 0) return reject('invalid items');
    if (p.tradeId || target.tradeId) return reject('busy');
    const a = p.state;
    const b = target.state;
    if (!a || !b || a.ghost || b.ghost) return reject('not available');
    if (a.zone !== b.zone || distance(a.x, a.y, b.x, b.y) > TRADE_RANGE * 2) return reject('too far');
    if (!canGive(a.inv, give) || !canReceive(a.inv, want, give)) return reject('you cannot afford that');
    if (!canGive(b.inv, want) || !canReceive(b.inv, give, want)) return reject('they cannot do that trade');
    const trade: Trade = {
      id: crypto.randomUUID(),
      from: p.id,
      to: target.id,
      give,
      want,
      status: 'offered',
      debit: { from: 'pending', to: 'pending' },
      credit: { from: 'pending', to: 'pending' },
      createdAt: this.now(),
    };
    this.trades.set(trade.id, trade);
    p.tradeId = target.tradeId = trade.id;
    target.conn.send({ t: 'trade.incoming', tradeId: trade.id, from: p.id, fromName: p.name, give, want });
  }

  private reply(p: Player, tradeId: string, accept: boolean) {
    const trade = this.trades.get(tradeId);
    if (trade?.to !== p.id || trade.status !== 'offered') return;
    if (!accept) return this.closeTrade(trade, 'declined');
    trade.status = 'debiting';
    this.players.get(trade.from)?.conn.send({ t: 'trade.debit', tradeId, give: trade.give, receive: trade.want });
    p.conn.send({ t: 'trade.debit', tradeId, give: trade.want, receive: trade.give });
  }

  private ack(p: Player, tradeId: string, phase: string, ok: boolean) {
    const trade = this.trades.get(tradeId);
    const side = trade && sideOf(trade, p.id);
    if (!trade || !side) return;
    if (phase === 'debit') this.ackDebit(trade, side, ok);
    else if (phase === 'credit') this.ackCredit(trade, side, ok);
  }

  private ackDebit(trade: Trade, side: Side, ok: boolean) {
    if (trade.status !== 'debiting' || trade.debit[side] !== 'pending') return;
    trade.debit[side] = ok ? 'ok' : 'failed';
    const acks = Object.values(trade.debit);
    if (acks.includes('pending')) return;
    if (acks.includes('failed')) return this.abortTrade(trade.id, 'a player could not pay');
    trade.status = 'crediting';
    this.players.get(trade.from)?.conn.send({ t: 'trade.credit', tradeId: trade.id, receive: trade.want });
    this.players.get(trade.to)?.conn.send({ t: 'trade.credit', tradeId: trade.id, receive: trade.give });
  }

  private ackCredit(trade: Trade, side: Side, ok: boolean) {
    if (trade.status !== 'crediting') return;
    trade.credit[side] = ok ? 'ok' : 'failed';
    if (!Object.values(trade.credit).includes('pending')) this.closeTrade(trade, 'done');
  }

  /** Cancels a trade, refunding anyone who already paid. */
  private abortTrade(tradeId: string, reason: string) {
    const trade = this.trades.get(tradeId);
    if (!trade) return;
    if (trade.status === 'debiting') {
      if (trade.debit.from === 'ok')
        this.players.get(trade.from)?.conn.send({ t: 'trade.refund', tradeId, give: trade.give });
      if (trade.debit.to === 'ok')
        this.players.get(trade.to)?.conn.send({ t: 'trade.refund', tradeId, give: trade.want });
    }
    // Once crediting started both sides already paid; whoever is still connected gets their goods.
    this.closeTrade(trade, trade.status === 'crediting' ? 'done' : 'failed', reason);
  }

  private closeTrade(trade: Trade, status: 'done' | 'declined' | 'failed' | 'expired', reason?: string) {
    this.trades.delete(trade.id);
    for (const id of [trade.from, trade.to]) {
      const p = this.players.get(id);
      if (!p) continue;
      if (p.tradeId === trade.id) p.tradeId = undefined;
      p.conn.send({ t: 'trade.closed', tradeId: trade.id, status, reason });
    }
  }

  private chat(p: Player, text: unknown) {
    const t = this.now();
    if (typeof text !== 'string' || t - p.lastChatAt < CHAT_COOLDOWN_MS) return;
    const clean = stripControlChars(text).trim().slice(0, NET.maxChat);
    if (!clean) return;
    p.lastChatAt = t;
    for (const o of this.players.values()) o.conn.send({ t: 'chat', from: p.id, name: p.name, text: clean });
  }
}
