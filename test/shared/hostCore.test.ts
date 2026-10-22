import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { HostCore, LOCAL_PEER } from '../../src/shared/hostCore.js';
import { NET, type ServerMessage } from '../../src/shared/protocol.js';
import type { ChallengeTable } from '../../src/shared/romProof.js';

const USA = '6d4f10a8b10e10dbe624cb23cf03b88bb8252973';
// A fake cartridge and its challenge table, built the same way scripts/make-rom-challenges.mjs does.
const rom = crypto.randomBytes(4096);
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const table: ChallengeTable = {
  [USA]: Array.from({ length: 8 }, (_, i) => [i * 256, 256, sha(rom.subarray(i * 256, i * 256 + 256))]),
};

function setup(cap = 3) {
  const inbox = new Map<string, ServerMessage[]>();
  const kicked = new Map<string, string>();
  const host = new HostCore(
    'castle',
    {
      send: (peer, m) => inbox.set(peer, [...(inbox.get(peer) ?? []), m]),
      kick: (peer, code) => kicked.set(peer, code),
    },
    { table, cap, now: () => 1000, since: 42 },
  );
  const last = <T extends ServerMessage['t']>(peer: string, t: T) =>
    (inbox.get(peer) ?? []).filter((m) => m.t === t).at(-1) as Extract<ServerMessage, { t: T }> | undefined;
  const hello = (peer: string, name: string, extra: object = {}) =>
    host.message(peer, { t: 'hello', hello: { v: NET.protocol, name, mode: 'link', rom: USA, ...extra } });
  const prove = (peer: string, wrong = false) => {
    const ranges = last(peer, 'challenge')?.ranges ?? [];
    host.message(peer, {
      t: 'proof',
      digests: ranges.map((r) => (wrong ? '0'.repeat(64) : sha(rom.subarray(r.offset, r.offset + r.length)))),
    });
  };
  return { host, inbox, kicked, last, hello, prove };
}

test('peers learn who hosts, prove their cartridge, then join the room', () => {
  const s = setup();
  s.host.connect('peer-a');
  assert.equal(s.last('peer-a', 'host')?.room.id, 'castle');
  assert.equal(s.last('peer-a', 'host')?.since, 42);
  s.hello('peer-a', 'Ana');
  assert.equal(s.last('peer-a', 'welcome'), undefined, 'not before the ROM proof');
  s.prove('peer-a');
  assert.equal(s.last('peer-a', 'welcome')?.you.name, 'Ana');
  assert.equal(s.host.info().size, 1);
});

test('the hosting player skips the proof (its own cartridge is already loaded)', () => {
  const s = setup();
  s.hello(LOCAL_PEER, 'Host');
  assert.equal(s.last(LOCAL_PEER, 'welcome')?.you.name, 'Host');
});

test('rejections: wrong proof, version, unsupported ROM, bad name, full room', () => {
  const s = setup(1);
  s.hello('a', 'Ana');
  s.prove('a', true);
  assert.equal(s.kicked.get('a'), 'rom_proof_failed');
  s.hello('b', 'Bea', { v: NET.protocol + 1 });
  assert.equal(s.kicked.get('b'), 'version_mismatch');
  s.hello('c', 'Cid', { rom: 'deadbeef' });
  assert.equal(s.kicked.get('c'), 'unsupported_rom');
  s.hello('d', '<script>');
  assert.equal(s.kicked.get('d'), 'bad_hello');
  s.hello(LOCAL_PEER, 'Host');
  s.hello('e', 'Eve');
  assert.equal(s.kicked.get('e'), 'room_full');
});

test('duplicate names get a number; leaving frees the slot', () => {
  const s = setup();
  s.hello(LOCAL_PEER, 'Link');
  s.hello('p', 'link');
  s.prove('p');
  assert.equal(s.last('p', 'welcome')?.you.name, 'link 2');
  s.host.disconnect('p');
  assert.equal(s.host.info().size, 1);
});

test('game messages only flow after joining', () => {
  const s = setup();
  s.hello(LOCAL_PEER, 'Host');
  s.host.message('stranger', { t: 'chat', text: 'spam before hello' });
  assert.equal(s.last(LOCAL_PEER, 'chat'), undefined);
  s.hello('p', 'Pal');
  s.prove('p');
  s.host.message('p', { t: 'chat', text: 'hi host' });
  assert.equal(s.last(LOCAL_PEER, 'chat')?.text, 'hi host');
});
