import { type Cartridge, prove } from '../rom/rom.js';
import { type ClientMessage, type Hello, NET, type ServerMessage } from '../shared/index.js';
import { type Link, LinkBase } from './link.js';
import { decodeCode, encodeCode, iceGathered, localSdp, RTC_CONFIG } from './rtc.js';

/** Hosts send every guest a keyframe at least every NET.keyframeMs; silence past this means gone. */
const HOST_SILENCE_MS = NET.keyframeMs + 10_000;

/** This browser joins a friend's room by pasting their invite code and sending back a reply. */
export class GuestLink extends LinkBase implements Link {
  readonly role = 'guest';
  room = '';
  hostName?: string;
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private watchdog?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly hello: Omit<Hello, 'v'>,
    private readonly cart: Cartridge,
  ) {
    super();
    this.setStatus('searching', 'need_invite');
  }

  /** Turns the host's invite code into the reply code to send back. Throws CodeError. */
  async join(invite: string, address?: string): Promise<string> {
    const { sdp, name } = await decodeCode('invite', invite);
    this.leaveHost();
    this.hostName = name;
    this.room = name ?? '';
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    pc.ondatachannel = (e) => this.attach(e.channel);
    pc.onconnectionstatechange = () => {
      // Failing before the channel ever opened means the address was unreachable; after, the host left.
      if (pc === this.pc && pc.connectionState === 'failed')
        this.hostGone(this.channel ? 'host_gone' : 'connect_failed');
    };
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await iceGathered(pc);
    this.setStatus('searching', 'waiting_accept');
    return encodeCode('reply', localSdp(pc, address), this.hello.name);
  }

  private attach(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onmessage = (e) => {
      try {
        void this.receive(JSON.parse(String(e.data)) as ServerMessage);
      } catch {
        /* ignore malformed frames */
      }
    };
    channel.onclose = () => {
      if (channel === this.channel) this.hostGone('host_gone');
    };
  }

  private raw(msg: ClientMessage) {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(msg));
  }

  private async receive(msg: ServerMessage) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.hostGone('host_gone'), HOST_SILENCE_MS);
    if (msg.t === 'host') {
      if (msg.v !== NET.protocol) return this.setStatus('offline', 'version_mismatch');
      this.setStatus('verifying');
      this.raw({ t: 'hello', hello: { ...this.hello, v: NET.protocol } });
      return;
    }
    if (msg.t === 'challenge') {
      this.raw({ t: 'proof', digests: await prove(this.cart, msg.ranges) });
      return;
    }
    if (msg.t === 'error') this.setStatus('offline', msg.code);
    this.emit(msg);
  }

  private leaveHost() {
    clearTimeout(this.watchdog);
    const { pc } = this;
    this.pc = undefined;
    this.channel = undefined;
    pc?.close();
  }

  private hostGone(reason: string) {
    this.leaveHost();
    // Clear other players from the screen; a new invite code reconnects.
    this.emit({ t: 'near', players: [], gone: [], full: true });
    this.emit({ t: 'roster', players: [], gone: [], full: true });
    this.setStatus('offline', reason);
  }

  send(msg: ClientMessage) {
    if (this.status !== 'online' || this.channel?.readyState !== 'open') return false;
    this.channel.send(JSON.stringify(msg));
    return true;
  }

  close() {
    this.leaveHost();
    this.setStatus('offline');
  }
}
