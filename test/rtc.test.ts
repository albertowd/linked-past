import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CodeError, decodeCode, encodeCode, isIPv4, withAddress } from '../src/net/rtc.js';
import { NET } from '../src/shared/index.js';

const SDP = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'a=ice-ufrag:abcd',
  'a=candidate:1234 1 udp 2113937151 0f1e2d3c-aaaa-bbbb-cccc-1234567890ab.local 54321 typ host generation 0',
  'a=candidate:5678 1 udp 2113939711 9a8b7c6d-aaaa-bbbb-cccc-1234567890ab.local 60000 typ host generation 0',
  'a=end-of-candidates',
  '',
].join('\r\n');

test('codes round-trip and stay compact', async () => {
  const code = await encodeCode('invite', SDP, 'Hosty');
  assert.match(code, /^HWI\.[A-Za-z0-9_-]+$/);
  assert.ok(code.length < SDP.length, 'compressed');
  assert.deepEqual(await decodeCode('invite', code), { sdp: SDP, name: 'Hosty' });
  // Pasted with line breaks or spaces from a chat app still works.
  assert.equal((await decodeCode('invite', `  ${code.slice(0, 20)}\n${code.slice(20)} `)).sdp, SDP);
});

test('wrong, mixed-up and garbage codes are rejected', async () => {
  const reply = await encodeCode('reply', SDP);
  await assert.rejects(decodeCode('invite', reply), (e) => e instanceof CodeError && e.code === 'wrong_kind');
  await assert.rejects(decodeCode('invite', 'hello'), (e) => e instanceof CodeError && e.code === 'bad_code');
  await assert.rejects(decodeCode('invite', 'HWI.@@@@'), (e) => e instanceof CodeError && e.code === 'bad_code');
});

test('codes from another app version are refused', async () => {
  const original = NET.protocol;
  const code = await encodeCode('invite', SDP);
  (NET as { protocol: number }).protocol = original + 1;
  try {
    await assert.rejects(decodeCode('invite', code), (e) => e instanceof CodeError && e.code === 'version_mismatch');
  } finally {
    (NET as { protocol: number }).protocol = original;
  }
});

test('a typed address adds reachable candidates next to the hidden .local ones', () => {
  const out = withAddress(SDP, '26.12.34.56');
  const candidates = out.split('\r\n').filter((l) => l.startsWith('a=candidate:'));
  assert.equal(candidates.length, 4);
  assert.ok(candidates.some((l) => l.includes(' 26.12.34.56 54321 typ host')));
  assert.ok(candidates.some((l) => l.includes(' 26.12.34.56 60000 typ host')));
  assert.ok(out.indexOf('26.12.34.56') < out.indexOf('a=end-of-candidates'), 'kept inside the media section');
  assert.equal(withAddress(SDP, 'not-an-ip'), SDP);
  assert.equal(isIPv4('192.168.0.10'), true);
  assert.equal(isIPv4('300.1.1.1'), false);
});
