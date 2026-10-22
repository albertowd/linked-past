import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOTTLE, type PlayerState, packPixels, poseHash, type ServerMessage } from '../../src/shared/index.js';
import { type Conn, stripControlChars, World } from '../../src/shared/world.js';
import { defined } from './helpers.js';

function client() {
  const inbox: ServerMessage[] = [];
  const closed: string[] = [];
  const conn: Conn = { send: (m) => inbox.push(m), close: (_code, reason) => closed.push(reason) };
  const last = <T extends ServerMessage['t']>(t: T) =>
    inbox.filter((m) => m.t === t).at(-1) as Extract<ServerMessage, { t: T }> | undefined;
  return { conn, inbox, closed, last };
}

const state = (over: Partial<PlayerState> = {}): PlayerState => ({
  zone: 'ow:0',
  x: 100,
  y: 100,
  dir: 6,
  ghost: false,
  pose: null,
  health: 24,
  maxHealth: 24,
  armor: 0,
  sword: 1,
  inv: { rupees: 50, bombs: 3, maxBombs: 10, arrows: 0, maxArrows: 30, bottles: [BOTTLE.redPotion, 0, 0, 0] },
  ...over,
});

function setup(modeB: 'link' | 'zelda' = 'link') {
  let now = 10_000;
  const world = new World('1', 20, () => now);
  const a = client();
  const b = client();
  const ida = world.join(a.conn, { id: 'a', name: 'Alice' }, 'link');
  const idb = world.join(b.conn, { id: 'b', name: 'Bob' }, modeB);
  world.onMessage(ida, { t: 'state', s: state() });
  world.onMessage(idb, { t: 'state', s: state({ x: 118, inv: { ...state().inv, bottles: [BOTTLE.empty, 0, 0, 0] } }) });
  return { world, a, b, ida, idb, advance: (ms: number) => (now += ms) };
}

test('players in the same zone see each other', () => {
  const { world, a } = setup();
  world.tick();
  assert.equal(a.last('near')?.players[0].name, 'Bob');
});

test('link mode sword hits link mode, not zelda mode, not ghosts', () => {
  const s = setup();
  s.world.onMessage(s.ida, { t: 'attack', x: 100, y: 100, dir: 6 });
  assert.equal(s.b.last('hit')?.damage, 4);

  const z = setup('zelda');
  z.world.onMessage(z.ida, { t: 'attack', x: 100, y: 100, dir: 6 });
  assert.equal(z.b.last('hit'), undefined);

  const g = setup();
  g.world.onMessage(g.idb, { t: 'state', s: state({ x: 118, ghost: true }) });
  g.world.onMessage(g.ida, { t: 'attack', x: 100, y: 100, dir: 6 });
  assert.equal(g.b.last('hit'), undefined);
});

test('trade escrow: offer, accept, debit both, credit both', () => {
  const { world, a, b, ida, idb } = setup();
  world.onMessage(ida, {
    t: 'trade.offer',
    to: idb,
    give: [{ item: 'bottle', content: BOTTLE.redPotion }],
    want: [{ item: 'rupees', qty: 20 }],
  });
  const offer = defined(b.last('trade.incoming'), 'offer');
  assert.equal(offer.fromName, 'Alice');
  world.onMessage(idb, { t: 'trade.reply', tradeId: offer.tradeId, accept: true });
  assert.deepEqual(a.last('trade.debit')?.give, [{ item: 'bottle', content: BOTTLE.redPotion }]);
  assert.deepEqual(b.last('trade.debit')?.give, [{ item: 'rupees', qty: 20 }]);
  world.onMessage(ida, { t: 'trade.ack', tradeId: offer.tradeId, phase: 'debit', ok: true });
  assert.equal(a.last('trade.credit'), undefined);
  world.onMessage(idb, { t: 'trade.ack', tradeId: offer.tradeId, phase: 'debit', ok: true });
  assert.deepEqual(a.last('trade.credit')?.receive, [{ item: 'rupees', qty: 20 }]);
  world.onMessage(ida, { t: 'trade.ack', tradeId: offer.tradeId, phase: 'credit', ok: true });
  world.onMessage(idb, { t: 'trade.ack', tradeId: offer.tradeId, phase: 'credit', ok: true });
  assert.equal(a.last('trade.closed')?.status, 'done');
});

test('failed debit refunds the side that paid', () => {
  const { world, a, b, ida, idb } = setup();
  world.onMessage(ida, { t: 'trade.offer', to: idb, give: [{ item: 'rupees', qty: 10 }], want: [] });
  const { tradeId } = defined(b.last('trade.incoming'), 'offer');
  world.onMessage(idb, { t: 'trade.reply', tradeId, accept: true });
  world.onMessage(ida, { t: 'trade.ack', tradeId, phase: 'debit', ok: true });
  world.onMessage(idb, { t: 'trade.ack', tradeId, phase: 'debit', ok: false });
  assert.deepEqual(a.last('trade.refund')?.give, [{ item: 'rupees', qty: 10 }]);
  assert.equal(a.last('trade.closed')?.status, 'failed');
});

test('cannot offer more than you have', () => {
  const { world, a, b, ida, idb } = setup();
  world.onMessage(ida, { t: 'trade.offer', to: idb, give: [{ item: 'rupees', qty: 500 }], want: [] });
  assert.equal(b.last('trade.incoming'), undefined);
  assert.equal(a.last('trade.closed')?.status, 'failed');
});

test('offers expire', () => {
  const { world, a, b, ida, idb, advance } = setup();
  world.onMessage(ida, { t: 'trade.offer', to: idb, give: [{ item: 'rupees', qty: 1 }], want: [] });
  advance(31_000);
  world.tick();
  assert.equal(a.last('trade.closed')?.status, 'expired');
  assert.equal(b.last('trade.closed')?.status, 'expired');
});

test('chat is sanitized and broadcast', () => {
  const { world, b, ida } = setup();
  world.onMessage(ida, { t: 'chat', text: '  hi\u0007 there  ' });
  assert.equal(b.last('chat')?.text, 'hi there');
});

test('other zones and far players are not sent', () => {
  const { world, a, idb } = setup();
  world.onMessage(idb, { t: 'state', s: state({ zone: 'uw:104' }) });
  world.tick();
  assert.equal(a.last('near')?.players.length, 0);
  world.onMessage(idb, { t: 'state', s: state({ x: 1000 }) });
  world.tick();
  assert.equal(a.last('near')?.players.length, 0);
});

test('malformed state is ignored', () => {
  const { world, a, idb } = setup();
  world.onMessage(idb, { t: 'state', s: { ...state(), x: -5 } });
  world.onMessage(idb, { t: 'state', s: { ...state(), dir: 3 as 0 } });
  world.onMessage(idb, { t: 'state', s: { ...state(), inv: { ...state().inv, bottles: [1] } } });
  world.tick();
  assert.equal(a.last('near')?.players[0].x, 118, 'last valid state kept');
});

test('attacks respect cooldown and hit invulnerability', () => {
  const s = setup();
  s.world.onMessage(s.ida, { t: 'attack', x: 0, y: 0, dir: 6 });
  s.advance(100);
  s.world.onMessage(s.ida, { t: 'attack', x: 0, y: 0, dir: 6 });
  assert.equal(s.b.inbox.filter((m) => m.t === 'hit').length, 1, 'cooldown');
  s.advance(300);
  s.world.onMessage(s.ida, { t: 'attack', x: 0, y: 0, dir: 6 });
  assert.equal(s.b.inbox.filter((m) => m.t === 'hit').length, 1, 'still invulnerable');
  s.advance(1000);
  s.world.onMessage(s.ida, { t: 'attack', x: 0, y: 0, dir: 6 });
  assert.equal(s.b.inbox.filter((m) => m.t === 'hit').length, 2);
});

test('players without a sword cannot attack; spin hits behind', () => {
  const s = setup();
  s.world.onMessage(s.ida, { t: 'state', s: state({ sword: 0 }) });
  s.world.onMessage(s.ida, { t: 'attack', x: 0, y: 0, dir: 6 });
  assert.equal(s.b.last('hit'), undefined);
  s.world.onMessage(s.ida, { t: 'state', s: state({ dir: 4 }) });
  s.world.onMessage(s.ida, { t: 'attack', x: 0, y: 0, dir: 4, spin: true });
  const hit = defined(s.b.last('hit'), 'spin hit');
  assert.equal(hit.damage, 8);
  assert.equal(hit.kx, 32, 'pushed away from the attacker');
});

test('poses are validated, cached and served on request', () => {
  const { world, a, ida, idb } = setup();
  const body = { w: 1, h: 1, ox: 0, oy: 0, px: packPixels(Uint8Array.of(0x71)), pals: { 7: Array(16).fill(0) } };
  const good = { ...body, hash: poseHash(body) };
  world.onMessage(idb, { t: 'pose', pose: { ...good, hash: 'forged' } });
  world.onMessage(ida, { t: 'pose?', hash: 'forged' });
  assert.equal(a.last('pose'), undefined);
  world.onMessage(idb, { t: 'pose', pose: good });
  world.onMessage(ida, { t: 'pose?', hash: good.hash });
  assert.equal(a.last('pose')?.pose.hash, good.hash);
});

test('signing in elsewhere replaces the old session', () => {
  const { world, a } = setup();
  const again = client();
  world.join(again.conn, { id: 'a', name: 'Alice' }, 'zelda');
  assert.deepEqual(a.closed, ['signed in elsewhere']);
  assert.equal(world.size, 2);
});

test('leaving mid-trade refunds the partner who paid', () => {
  const { world, a, b, ida, idb } = setup();
  world.onMessage(ida, { t: 'trade.offer', to: idb, give: [{ item: 'rupees', qty: 5 }], want: [] });
  const { tradeId } = defined(b.last('trade.incoming'), 'offer');
  world.onMessage(idb, { t: 'trade.reply', tradeId, accept: true });
  world.onMessage(ida, { t: 'trade.ack', tradeId, phase: 'debit', ok: true });
  world.leave(idb);
  assert.deepEqual(a.last('trade.refund')?.give, [{ item: 'rupees', qty: 5 }]);
  assert.equal(a.last('trade.closed')?.status, 'failed');
});

test('trade guards: busy, distance, ghosts, decline, invalid lines', () => {
  const s = setup();
  s.world.onMessage(s.ida, { t: 'trade.offer', to: s.idb, give: [{ item: 'rupees', qty: 1 }], want: [] });
  s.world.onMessage(s.ida, { t: 'trade.offer', to: s.idb, give: [{ item: 'rupees', qty: 1 }], want: [] });
  assert.equal(s.a.last('trade.closed')?.reason, 'busy');
  const { tradeId } = defined(s.b.last('trade.incoming'), 'offer');
  s.world.onMessage(s.idb, { t: 'trade.reply', tradeId, accept: false });
  assert.equal(s.b.last('trade.closed')?.status, 'declined');

  s.world.onMessage(s.idb, { t: 'state', s: state({ x: 300 }) });
  s.world.onMessage(s.ida, { t: 'trade.offer', to: s.idb, give: [{ item: 'rupees', qty: 1 }], want: [] });
  assert.equal(s.a.last('trade.closed')?.reason, 'too far');

  s.world.onMessage(s.idb, { t: 'state', s: state({ ghost: true }) });
  s.world.onMessage(s.ida, { t: 'trade.offer', to: s.idb, give: [{ item: 'rupees', qty: 1 }], want: [] });
  assert.equal(s.a.last('trade.closed')?.reason, 'not available');

  s.world.onMessage(s.ida, { t: 'trade.offer', to: s.idb, give: [{ item: 'rupees', qty: -4 }], want: [] });
  assert.equal(s.a.last('trade.closed')?.reason, 'invalid items');
  s.world.onMessage(s.ida, { t: 'trade.offer', to: 'nobody', give: [], want: [] });
  assert.equal(s.a.last('trade.closed')?.reason, 'player not found');
});

test('roster lists everyone with their zone', () => {
  const { world, a } = setup();
  world.sendRoster();
  assert.deepEqual(
    a.last('roster')?.players.map((p) => [p.name, p.zone]),
    [
      ['Alice', 'ow:0'],
      ['Bob', 'ow:0'],
    ],
  );
});

test('chat cooldown and control characters', () => {
  const { world, b, ida, advance } = setup();
  world.onMessage(ida, { t: 'chat', text: 'one' });
  world.onMessage(ida, { t: 'chat', text: 'two' });
  advance(500);
  world.onMessage(ida, { t: 'chat', text: '\u0000\u001b' });
  world.onMessage(ida, { t: 'chat', text: 42 as unknown as string });
  assert.deepEqual(
    b.inbox.filter((m) => m.t === 'chat').map((m) => m.t === 'chat' && m.text),
    ['one'],
  );
  assert.equal(stripControlChars('a\u0007b\u007fc\u00e9'), 'abc\u00e9');
});

test('near only carries real changes and refreshes every 30 s', () => {
  const { world, a, idb, advance } = setup();
  world.tick();
  assert.equal(a.last('near')?.full, true);
  const count = () => a.inbox.filter((m) => m.t === 'near').length;
  const before = count();
  for (let i = 0; i < 20; i++) {
    advance(50);
    world.tick();
  }
  assert.equal(count(), before, 'a second of standing still sends nothing');
  world.onMessage(idb, { t: 'state', s: state({ x: 130 }) });
  world.tick();
  const moved = defined(a.last('near'));
  assert.equal(moved.full, undefined);
  assert.deepEqual(
    moved.players.map((p) => p.x),
    [130],
  );
  world.onMessage(idb, { t: 'state', s: state({ zone: 'uw:104' }) });
  world.tick();
  assert.equal(a.last('near')?.gone.length, 1, 'left the view');
  advance(30_000);
  world.tick();
  assert.equal(a.last('near')?.full, true, 'keyframe');
});

test('roster only updates when a map dot moves', () => {
  const { world, a, idb, advance } = setup();
  world.sendRoster();
  const count = () => a.inbox.filter((m) => m.t === 'roster').length;
  const before = count();
  world.onMessage(idb, { t: 'state', s: state({ x: 120 }) }); // same 32 px map cell as 118
  advance(1000);
  world.sendRoster();
  assert.equal(count(), before, 'sub-pixel moves are not sent');
  world.onMessage(idb, { t: 'state', s: state({ x: 140 }) });
  advance(1000);
  world.sendRoster();
  const r = defined(a.last('roster'));
  assert.deepEqual(
    r.players.map((p) => [p.name, p.x]),
    [['Bob', 128]],
  );
});
