import { AudioOut } from '../emu/audio.js';
import { BUTTON, Core } from '../emu/core.js';
import { Input } from '../emu/input.js';
import type { Link, LinkStatus } from '../net/link.js';
import * as db from '../rom/db.js';
import type { Cartridge } from '../rom/rom.js';
import {
  applyDelta,
  isCutscene,
  type LinkSnapshot,
  type Mode,
  NET,
  type PlayerState,
  type PlayerView,
  type RosterEntry,
  readSnapshot,
  type ServerMessage,
  type TradeLine,
  zoneOf,
} from '../shared/index.js';
import { ctx2d } from '../ui/dom.js';
import type { PixelFont } from '../ui/font.js';
import { applyHit, credit, debit } from './actions.js';
import { type Appearance, LinkPalette } from './appearance.js';
import { captureLink } from './capture.js';
import { Overlay } from './overlay.js';

/** What the session needs from the page around it. */
export interface SessionUI {
  status(s: LinkStatus, detail?: string): void;
  near(players: PlayerView[], me: LinkSnapshot | undefined): void;
  roster(players: RosterEntry[], meId: string | undefined): void;
  chat(name: string, text: string, mine: boolean): void;
  hit(fromName: string): void;
  tradeIncoming(tradeId: string, fromName: string, give: TradeLine[], want: TradeLine[]): void;
  tradeClosed(status: 'done' | 'declined' | 'failed' | 'expired', reason?: string): void;
  saved(): void;
}

const SPIN_CHARGE_FRAMES = 48;
const SRAM_CHECK_MS = 3000;

/** Battery saves live on this device only, one per cartridge (export/import moves them). */
export const saveKey = (cart: Cartridge) => `sram:${cart.info.sha1}`;

function sramHash(b: Uint8Array) {
  let h = 0x811c9dc5;
  for (const byte of b) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h;
}

export class GameSession {
  readonly input = new Input();
  private readonly palette = new LinkPalette();
  private core!: Core;
  private audio!: AudioOut;
  private readonly overlay: Overlay;
  private readonly ctx: CanvasRenderingContext2D;
  private me?: LinkSnapshot;
  private myId?: string;
  private readonly names = new Map<string, string>();
  private readonly nearPlayers = new Map<string, PlayerView>();
  private readonly rosterPlayers = new Map<string, RosterEntry>();
  private lastSent = '';
  private lastSentAt = 0;
  private readonly sentPoses = new Set<string>();
  private pose: string | null = null;
  /** Last playable zone: menus and dialogs keep the player (as a ghost) where they stood. */
  private zone = 'limbo';
  private bHeld = 0;
  private hidden = document.hidden;
  private raf = 0;
  private readonly sramKey: string;
  private sramLast = 0;
  private sramInterval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly cart: Cartridge,
    font: PixelFont,
    private readonly link: Link,
    readonly mode: Mode,
    screen: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    private readonly ui: SessionUI,
  ) {
    this.ctx = ctx2d(screen);
    this.overlay = new Overlay(overlayCanvas, font, (hash) => this.link.send({ t: 'pose?', hash }));
    this.sramKey = saveKey(cart);
    document.addEventListener('visibilitychange', () => (this.hidden = document.hidden));
  }

  async start() {
    this.core = await Core.create(this.cart.data);
    await this.restoreSave();
    this.audio = new AudioOut(this.core.sampleRate);
    this.link.onMessage((m) => this.onMessage(m));
    this.link.onStatus((s, d) => this.ui.status(s, d));
    this.sramLast = sramHash(this.core.sram());
    // Dev builds expose the session for debugging and automated multiplayer tests.
    if (import.meta.env.DEV) Object.assign(window, { __linkedPast: { session: this, core: this.core } });
    this.sramInterval = setInterval(() => this.checkSram(), SRAM_CHECK_MS);
    this.loop();
  }

  /** Audio can only start after a user gesture. */
  enableAudio() {
    void this.audio?.start();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.sramInterval);
    this.checkSram();
    this.link.close();
  }

  // ---- saves -------------------------------------------------------------------------

  private async restoreSave() {
    const sram = await db.get<Uint8Array>(this.sramKey);
    if (sram) {
      this.core.loadSram(sram);
      this.core.reset(); // boot again so the game reads the restored save
    }
  }

  private checkSram() {
    const sram = this.core.sram();
    const h = sramHash(sram);
    if (h === this.sramLast) return;
    this.sramLast = h;
    void db.set(this.sramKey, sram.slice()).then(() => this.ui.saved());
  }

  // ---- frame loop ----------------------------------------------------------------------

  private loop() {
    const frameMs = 1000 / this.core.fps;
    let last = performance.now();
    let acc = 0;
    const step = (now: number) => {
      acc = Math.min(acc + now - last, frameMs * 4); // never spiral after a stall
      last = now;
      let ran = false;
      while (acc >= frameMs) {
        acc -= frameMs;
        this.frame();
        ran = true;
      }
      if (ran) this.present();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private frame() {
    const { mask, pressed, released } = this.input.poll();
    this.core.runFrame(mask);
    this.palette.apply(this.core.wram()); // uploaded by the game on the next frame
    this.audio.push(this.core.drainAudio());
    const s = readSnapshot(this.core.wram());
    this.me = s;
    const zone = zoneOf(s);
    if (zone !== 'limbo' || s.module < 0x06) this.zone = zone; // title/file select really is limbo
    const ghost = this.isGhost(s);
    if (!ghost) {
      const pose = captureLink(this.core, s);
      if (pose) {
        if (!this.sentPoses.has(pose.hash) && this.link.send({ t: 'pose', pose })) {
          this.sentPoses.add(pose.hash);
          this.overlay.addPose(pose);
        }
        this.pose = pose.hash;
      }
    }
    this.combat(s, ghost, mask, pressed, released);
    this.sendState(s, ghost);
  }

  private isGhost(s: LinkSnapshot) {
    return this.hidden || isCutscene(s);
  }

  private combat(s: LinkSnapshot, ghost: boolean, mask: number, pressed: number, released: number) {
    if (this.mode !== 'link' || ghost || s.sword < 1) {
      this.bHeld = 0;
      return;
    }
    const B = 1 << BUTTON.B;
    if (pressed & B) this.link.send({ t: 'attack', x: s.x, y: s.y, dir: s.direction });
    if (mask & B) this.bHeld++;
    if (released & B) {
      if (this.bHeld >= SPIN_CHARGE_FRAMES)
        this.link.send({ t: 'attack', x: s.x, y: s.y, dir: s.direction, spin: true });
      this.bHeld = 0;
    }
  }

  private sendState(s: LinkSnapshot, ghost: boolean) {
    const state: PlayerState = {
      zone: this.zone,
      x: s.x,
      y: s.y,
      dir: s.direction,
      ghost,
      pose: this.pose,
      health: s.health,
      maxHealth: s.maxHealth,
      armor: Math.min(s.armor, 2),
      sword: Math.min(s.sword, 4),
      inv: s.inventory,
    };
    const key = JSON.stringify(state);
    const now = performance.now();
    // Only real changes go out (at most NET.stateHz), plus a refresh every NET.keyframeMs.
    if (now - this.lastSentAt < 1000 / NET.stateHz) return;
    if (key === this.lastSent && now - this.lastSentAt < NET.keyframeMs) return;
    if (!this.link.send({ t: 'state', s: state })) return; // not in the room yet: retry next frame
    this.lastSent = key;
    this.lastSentAt = now;
  }

  private present() {
    const { width, height, pixels } = this.core.frame();
    const canvas = this.ctx.canvas;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = this.overlay.canvas.width = width;
      canvas.height = this.overlay.canvas.height = height;
    }
    this.ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    this.overlay.draw(this.me, this.zone);
  }

  // ---- network -------------------------------------------------------------------------

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.you.id;
        this.nearPlayers.clear();
        this.rosterPlayers.clear();
        this.lastSent = ''; // (re)joined: the room needs our current state
        this.sentPoses.clear(); // the server may have restarted and lost its pose cache
        break;
      case 'near': {
        for (const p of m.players) this.names.set(p.id, p.name);
        const near = [...applyDelta(this.nearPlayers, m).values()];
        this.overlay.setNear(near);
        this.ui.near(near, this.me);
        break;
      }
      case 'roster':
        for (const p of m.players) this.names.set(p.id, p.name);
        this.ui.roster([...applyDelta(this.rosterPlayers, m).values()], this.myId);
        break;
      case 'pose':
        this.overlay.addPose(m.pose);
        break;
      case 'hit':
        if (applyHit(this.core, m.damage, m.kx, m.ky)) this.ui.hit(this.names.get(m.from) ?? '?');
        break;
      case 'chat':
        this.ui.chat(m.name, m.text, m.from === this.myId);
        break;
      case 'trade.incoming':
        this.ui.tradeIncoming(m.tradeId, m.fromName, m.give, m.want);
        break;
      case 'trade.debit':
        this.link.send({
          t: 'trade.ack',
          tradeId: m.tradeId,
          phase: 'debit',
          ok: debit(this.core, m.give, m.receive),
        });
        break;
      case 'trade.credit':
        credit(this.core, m.receive);
        this.link.send({ t: 'trade.ack', tradeId: m.tradeId, phase: 'credit', ok: true });
        break;
      case 'trade.refund':
        credit(this.core, m.give);
        break;
      case 'trade.closed':
        this.ui.tradeClosed(m.status, m.reason);
        break;
      case 'error':
        this.ui.status('offline', m.message);
        break;
    }
  }

  /** Tunic/skin colors; everyone sees them because poses carry the live palette. */
  setAppearance(appearance: Appearance) {
    this.palette.set(appearance);
  }

  say(text: string) {
    this.link.send({ t: 'chat', text });
  }

  offerTrade(to: string, give: TradeLine[], want: TradeLine[]) {
    this.link.send({ t: 'trade.offer', to, give, want });
  }

  replyTrade(tradeId: string, accept: boolean) {
    this.link.send({ t: 'trade.reply', tradeId, accept });
  }

  snapshot() {
    return this.me;
  }
}
