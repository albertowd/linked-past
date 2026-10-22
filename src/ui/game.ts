import { type ControlSettings, DEFAULT_SETTINGS, sanitizeSettings } from '../emu/bindings.js';
import type { Appearance } from '../game/appearance.js';
import type { Atlas } from '../game/harvest.js';
import type { GameSession, SessionUI } from '../game/session.js';
import { t } from '../i18n.js';
import { GuestLink } from '../net/guest.js';
import { HostLink } from '../net/host.js';
import type { Link, LinkStatus } from '../net/link.js';
import * as db from '../rom/db.js';
import {
  distance,
  type LinkSnapshot,
  type Mode,
  NET,
  type PlayerView,
  type RosterEntry,
  TRADABLE_BOTTLES,
  TRADE_RANGE,
  type TradeLine,
} from '../shared/index.js';
import { appearanceDialog } from './appearance.js';
import { controlsDialog } from './controls.js';
import { ctx2d, h, label, panel } from './dom.js';
import { type PixelFont, spriteCanvas } from './font.js';
import { inviteDialog, joinDialog } from './invite.js';
import { touchControls } from './touch.js';

const MODE_COLOR: Record<Mode, string> = { link: '#78f878', zelda: '#f8a0d0' };
const MAX_CHAT_LINES = 80;
const WORLD = 4096; // overworld size in pixels (8x8 areas of 512)

// t.potions follows the order of TRADABLE_BOTTLES.
const bottleName = (c: number) => t.potions[TRADABLE_BOTTLES.indexOf(c)] ?? t.bottle;

const lineLabel = (l: TradeLine) => (l.item === 'bottle' ? bottleName(l.content) : `${l.qty} ${t[l.item]}`);

export class GameScreen implements SessionUI {
  readonly root: HTMLElement;
  readonly screen = h('canvas', { class: 'screen', width: 256, height: 224 });
  readonly overlay = h('canvas', { class: 'overlay', width: 256, height: 224 });
  private game?: GameSession;
  private readonly statusEl = h('div', { class: 'status' });
  private readonly roomBadge = h('div', { class: 'room-badge' });
  private readonly savedEl = h('div', { class: 'saved' });
  private readonly nearEl = h('ul', { class: 'near' });
  private readonly mapCanvas = h('canvas', { class: 'map', width: 128, height: 128 });
  private mapWorld: 0 | 1 = 0;
  private players: RosterEntry[] = [];
  private myId?: string;
  private readonly chatLog = h('ol', { class: 'chat-log' });
  private readonly chatInput = h('input', {
    class: 'chat-input',
    maxLength: 120,
    placeholder: t.say,
    enterKeyHint: 'send',
  });
  private readonly toasts = h('div', { class: 'toasts' });
  private readonly dialog = h('div', { class: 'dialog hidden' });
  private settings: ControlSettings = DEFAULT_SETTINGS;
  private readonly coarse = matchMedia('(pointer: coarse)');
  private readonly chatBadge = h('span', { class: 'badge hidden' });
  private readonly mapTabs = [
    h('button', { class: 'tab on', onclick: () => this.setWorld(0) }, label(t.lightWorld, {}, 1)),
    h('button', { class: 'tab', onclick: () => this.setWorld(1) }, label(t.darkWorld, {}, 1)),
  ];

  constructor(
    private readonly font: PixelFont,
    private readonly atlas: Atlas,
    private readonly mode: Mode,
    private readonly link: Link,
  ) {
    const mapTabs = h('div', { class: 'tabs' }, ...this.mapTabs);
    setInterval(() => this.drawMap(), 400); // blink the local player's marker
    const chatForm = h('form', { class: 'chat-form', onsubmit: (e: Event) => this.sendChat(e) }, this.chatInput);
    this.root = h(
      'div',
      { class: 'game' },
      h(
        'div',
        { class: 'stage' },
        h('div', { class: 'screen-wrap' }, this.screen, this.overlay, this.toasts),
        touchControls((b, down) => this.game?.input.setTouch(b, down)),
        h(
          'button',
          {
            class: 'drawer-toggle',
            type: 'button',
            ariaLabel: t.chatToggle,
            onclick: () => this.toggleDrawer(),
          },
          '☰',
          this.chatBadge,
        ),
      ),
      h(
        'aside',
        { class: 'side' },
        h(
          'header',
          {},
          label(mode === 'link' ? t.modeLink : t.modeZelda, { color: MODE_COLOR[mode] }, 2),
          this.roomBadge,
          this.statusEl,
          this.savedEl,
          h(
            'button',
            { class: 'btn small', type: 'button', onclick: () => this.openConnect() },
            label(link.role === 'host' ? t.invite.open : t.join.open, {}, 1),
          ),
          h(
            'button',
            { class: 'btn small', type: 'button', onclick: () => this.openAppearance() },
            label(t.appearance.open, {}, 1),
          ),
          h(
            'button',
            { class: 'btn small', type: 'button', title: 'F1', onclick: () => this.openControls(false) },
            label(t.controls.open, {}, 1),
          ),
        ),
        panel('players', label(t.players), this.nearEl),
        panel('worldmap', label(t.map), mapTabs, this.mapCanvas),
        panel('chat', label(t.chat), this.chatLog, chatForm),
      ),
      this.dialog,
    );
  }

  bind(game: GameSession) {
    this.game = game;
    const resume = () => game.enableAudio();
    this.root.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume, { once: true });
    this.chatInput.addEventListener('focus', () => (game.input.suspended = true));
    this.chatInput.addEventListener('blur', () => (game.input.suspended = false));
    this.updateRoomBadge();
    this.coarse.addEventListener('change', () => this.applyControls());
    void this.loadControls();
    void db.get<Appearance>('appearance').then((a) => {
      this.appearance = a ?? {};
      game.setAppearance(this.appearance);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        this.openControls(false);
        return;
      }
      if (document.activeElement === this.chatInput) {
        if (e.key === 'Escape') this.chatInput.blur();
        return;
      }
      if (e.key === 't' || e.key === 'T' || e.key === '/') {
        e.preventDefault();
        this.chatInput.focus();
      }
    });
  }

  private updateRoomBadge() {
    const role = this.link.role === 'host' ? t.hosting : t.guest;
    const count = this.players.length ? ` · ${this.players.length}/${NET.roomCap}` : '';
    this.roomBadge.replaceChildren(label(`${role}: ${this.link.room}${count}`, { color: '#b8b8c8' }, 1));
  }

  // ---- controls ------------------------------------------------------------------------

  private async loadControls() {
    const saved = await db.get<ControlSettings>('controls');
    this.settings = sanitizeSettings(saved);
    this.applyControls();
    if (!saved) this.openControls(true);
    // Hosts start inviting and guests start joining right away (after the first-run controls).
    this.queueDialog(() => this.openConnect());
  }

  private appearance: Appearance = {};

  private openAppearance() {
    this.openDialog(
      appearanceDialog(
        this.appearance,
        (a) => {
          this.appearance = a;
          this.game?.setAppearance(a);
          void db.set('appearance', a);
        },
        () => this.closeDialog(),
      ),
    );
  }

  /** Invite friends (host) or paste an invite code (guest). */
  private openConnect() {
    const close = () => this.closeDialog();
    if (this.link instanceof HostLink) this.openDialog(inviteDialog(this.link, close));
    else if (this.link instanceof GuestLink) this.openDialog(joinDialog(this.link, close));
  }

  private readonly dialogQueue: (() => void)[] = [];

  /** Opens now if nothing else is showing, otherwise right after the current dialog closes. */
  private queueDialog(open: () => void) {
    if (this.dialog.classList.contains('hidden')) open();
    else this.dialogQueue.push(open);
  }

  private applyControls() {
    this.game?.input.setBindings(this.settings.bindings);
    const { touch, touchScale } = this.settings;
    this.root.classList.toggle('touch-mode', touch === 'on' || (touch === 'auto' && this.coarse.matches));
    this.root.style.setProperty('--tscale', String(touchScale));
  }

  private openControls(firstRun: boolean) {
    if (!this.game) return;
    this.openDialog(
      controlsDialog({
        input: this.game.input,
        settings: this.settings,
        firstRun,
        onChange: (s) => {
          this.settings = s;
          this.applyControls();
          void db.set('controls', s);
        },
        onClose: () => {
          void db.set('controls', this.settings); // also marks the first-run screen as seen
          this.closeDialog();
        },
      }),
    );
  }

  /** Landscape phones keep the sidebar in a drawer over the game. */
  private toggleDrawer() {
    const open = this.root.classList.toggle('drawer-open');
    if (open) this.chatBadge.classList.add('hidden');
  }

  // ---- SessionUI -----------------------------------------------------------------------

  status(s: LinkStatus, detail?: string) {
    const problem = detail ? (t.connect[detail as keyof typeof t.connect] ?? t.errors[detail] ?? detail) : undefined;
    const text = {
      connecting: t.connecting,
      searching: problem ?? t.connect.need_invite,
      verifying: t.verifyingRom,
      online: '',
      offline: problem ?? t.disconnected,
    }[s];
    this.statusEl.replaceChildren(text ? label(text, { color: s === 'offline' ? '#f87878' : '#b8b8c8' }, 1) : '');
  }

  near(players: PlayerView[], me: LinkSnapshot | undefined) {
    const items = players.map((p) => {
      const close = !!me && distance(me.x, me.y, p.x, p.y) <= TRADE_RANGE;
      const canTrade = close && !p.ghost;
      return h(
        'li',
        { class: p.ghost ? 'ghost' : '' },
        label(p.name, { color: MODE_COLOR[p.mode] }, 2),
        this.hearts(p.health, p.maxHealth),
        p.ghost ? label(t.cutscene, { color: '#b8c8f8' }, 1) : '',
        h(
          'button',
          {
            class: 'btn small',
            disabled: !canTrade,
            title: canTrade ? t.trade : t.tooFar,
            onclick: () => this.composeTrade(p),
          },
          label(t.trade, {}, 1),
        ),
      );
    });
    this.nearEl.replaceChildren(...items);
  }

  roster(players: RosterEntry[], meId: string | undefined) {
    const before = new Map(this.players.map((p) => [p.id, p.name]));
    for (const p of players)
      if (!before.has(p.id) && this.players.length && p.id !== meId) this.system(`${p.name} ${t.joined}`);
    const now = new Set(players.map((p) => p.id));
    for (const [id, name] of before) if (!now.has(id)) this.system(`${name} ${t.left}`);
    this.players = players;
    this.myId = meId;
    this.updateRoomBadge();
    this.drawMap();
  }

  chat(name: string, text: string, mine: boolean) {
    const sender = this.players.find((p) => p.name === name);
    this.pushChat(
      h(
        'li',
        { class: mine ? 'mine' : '' },
        label(`${name}:`, { color: sender ? MODE_COLOR[sender.mode] : '#f8d830' }, 2),
        // One label per word so long messages wrap instead of widening the sidebar.
        ...text
          .split(/\s+/)
          .filter(Boolean)
          .map((word) => label(word, {}, 2)),
      ),
    );
  }

  hit(fromName: string) {
    this.toast(`${t.hitBy} ${fromName}`, '#f87878');
  }

  tradeIncoming(tradeId: string, fromName: string, give: TradeLine[], want: TradeLine[]) {
    this.openDialog(
      label(`${fromName} ${t.tradeFrom}`, { color: '#f8d830' }),
      this.lineList(t.want, give),
      this.lineList(t.give, want),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => this.answerTrade(tradeId, true) }, label(t.accept)),
        h('button', { class: 'btn', onclick: () => this.answerTrade(tradeId, false) }, label(t.decline)),
      ),
    );
  }

  tradeClosed(status: 'done' | 'declined' | 'failed' | 'expired', reason?: string) {
    this.closeDialog();
    const text = { done: t.tradeDone, declined: t.tradeDeclined, failed: t.tradeFailed, expired: t.tradeExpired }[
      status
    ];
    this.toast(reason && status === 'failed' ? `${text}: ${reason}` : text, status === 'done' ? '#78f878' : '#f8d830');
  }

  saved() {
    // Separate from the status line so a connection problem stays visible.
    this.savedEl.replaceChildren(label(t.saved, { color: '#78f878' }, 1));
    setTimeout(() => this.savedEl.replaceChildren(), 1500);
  }

  // ---- pieces --------------------------------------------------------------------------

  /** Icon for one heart container holding `left` eighths of health. */
  private heartIcon(left: number) {
    const { heart, halfHeart, emptyHeart } = this.atlas.icons;
    if (left >= 8) return heart;
    return left >= 4 ? halfHeart : emptyHeart;
  }

  private hearts(health: number, max: number) {
    const wrap = h('span', { class: 'hearts' });
    for (let i = 0; i < Math.ceil(max / 8); i++) {
      wrap.append(spriteCanvas(this.heartIcon(health - i * 8)));
    }
    return wrap;
  }

  private icon(item: TradeLine['item']) {
    const s = { rupees: this.atlas.icons.rupee, bombs: this.atlas.icons.bomb, arrows: this.atlas.icons.arrow }[
      item as 'rupees'
    ];
    if (!s) return '';
    const c = spriteCanvas(s);
    c.classList.add('icon');
    return c;
  }

  private lineList(title: string, lines: TradeLine[]) {
    return h(
      'div',
      { class: 'lines' },
      label(title, { color: '#b8b8c8' }),
      ...(lines.length ? lines : [null]).map((l) =>
        h('div', { class: 'line' }, l ? this.icon(l.item) : '', label(l ? lineLabel(l) : t.none)),
      ),
    );
  }

  private composeTrade(target: PlayerView) {
    const me = this.game?.snapshot();
    if (!me) return;
    const qty = (max: number) =>
      h('input', { type: 'number', min: '0', max: String(max), value: '0', inputMode: 'numeric' });
    const give = { rupees: qty(me.inventory.rupees), bombs: qty(me.inventory.bombs), arrows: qty(me.inventory.arrows) };
    const want = { rupees: qty(999), bombs: qty(50), arrows: qty(70) };
    const bottleSelect = (options: number[]) =>
      h(
        'select',
        {},
        h('option', { value: '0' }, t.none),
        ...options.map((c) => h('option', { value: String(c) }, bottleName(c))),
      );
    const giveBottle = bottleSelect(me.inventory.bottles.filter((b) => TRADABLE_BOTTLES.includes(b)));
    const wantBottle = bottleSelect(TRADABLE_BOTTLES);
    const column = (title: string, q: typeof give, bottle: HTMLSelectElement) =>
      h(
        'fieldset',
        {},
        label(title, { color: '#b8b8c8' }),
        ...(['rupees', 'bombs', 'arrows'] as const).map((k) =>
          h('label', { class: 'line' }, this.icon(k), label(t[k], {}, 1), q[k]),
        ),
        h('label', { class: 'line' }, label(t.bottle, {}, 1), bottle),
      );
    const collect = (q: typeof give, bottle: HTMLSelectElement): TradeLine[] => {
      const lines: TradeLine[] = [];
      for (const k of ['rupees', 'bombs', 'arrows'] as const) {
        const n = Math.floor(Number(q[k].value));
        if (n > 0) lines.push({ item: k, qty: n });
      }
      if (Number(bottle.value)) lines.push({ item: 'bottle', content: Number(bottle.value) });
      return lines;
    };
    this.openDialog(
      label(`${t.tradeWith} ${target.name}`, { color: '#f8d830' }),
      h('div', { class: 'cols' }, column(t.give, give, giveBottle), column(t.want, want, wantBottle)),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => {
              this.game?.offerTrade(target.id, collect(give, giveBottle), collect(want, wantBottle));
              this.closeDialog();
            },
          },
          label(t.offer),
        ),
        h('button', { class: 'btn', onclick: () => this.closeDialog() }, label(t.cancel)),
      ),
    );
  }

  private answerTrade(tradeId: string, accept: boolean) {
    this.game?.replyTrade(tradeId, accept);
    this.closeDialog();
  }

  private openDialog(...children: Node[]) {
    this.dialog.replaceChildren(panel('box', ...children));
    this.dialog.classList.remove('hidden');
    if (this.game) this.game.input.suspended = true;
  }

  private closeDialog() {
    this.dialog.classList.add('hidden');
    this.dialog.replaceChildren();
    if (this.game) this.game.input.suspended = false;
    this.dialogQueue.shift()?.();
  }

  private sendChat(e: Event) {
    e.preventDefault();
    const text = this.chatInput.value.trim();
    if (text) this.game?.say(text);
    this.chatInput.value = '';
    this.chatInput.blur();
  }

  private system(text: string) {
    this.pushChat(h('li', { class: 'system' }, label(text, { color: '#b8b8c8' }, 1)));
  }

  private pushChat(li: HTMLElement) {
    if (!this.root.classList.contains('drawer-open')) this.chatBadge.classList.remove('hidden');
    this.chatLog.append(li);
    while (this.chatLog.children.length > MAX_CHAT_LINES) this.chatLog.firstChild?.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private toast(text: string, color: string) {
    const el = h('div', { class: 'toast' }, label(text, { color }, 2));
    this.toasts.append(el);
    setTimeout(() => el.remove(), 2500);
  }

  private setWorld(w: 0 | 1) {
    this.mapWorld = w;
    this.mapTabs.forEach((tab, i) => {
      tab.classList.toggle('on', i === w);
    });
    this.drawMap();
  }

  /** Area grid of the chosen world with every player outdoors there. */
  private drawMap() {
    const ctx = ctx2d(this.mapCanvas);
    const S = this.mapCanvas.width;
    ctx.fillStyle = this.mapWorld ? '#301838' : '#183818';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = this.mapWorld ? '#583060' : '#305830';
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo((i * S) / 8 + 0.5, 0);
      ctx.lineTo((i * S) / 8 + 0.5, S);
      ctx.moveTo(0, (i * S) / 8 + 0.5);
      ctx.lineTo(S, (i * S) / 8 + 0.5);
      ctx.stroke();
    }
    const zone = `ow:${this.mapWorld}`;
    const blink = Math.floor(performance.now() / 400) % 2 === 0;
    for (const p of this.players) {
      if (p.zone !== zone) continue;
      const x = Math.floor(((p.x % WORLD) / WORLD) * S);
      const y = Math.floor(((p.y % WORLD) / WORLD) * S);
      const mine = p.id === this.myId;
      ctx.fillStyle = p.ghost ? '#b8c8f8' : MODE_COLOR[p.mode];
      if (!mine || blink) ctx.fillRect(x - 2, y - 2, 4, 4);
      if (mine) {
        ctx.strokeStyle = '#f8f8f8';
        ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      }
    }
    const inside = this.players.filter((p) => p.zone.startsWith('uw:')).length;
    if (inside) this.font.draw(ctx, `${t.indoors}: ${inside}`, 2, S - 10);
  }
}
