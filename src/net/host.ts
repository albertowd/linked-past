import { type ClientMessage, type Hello, LOCAL_PEER, NET, type ServerMessage } from '../shared/index.js';
import type { FromWorker, ToWorker } from './hostWorker.js';
import { type Link, LinkBase } from './link.js';
import { decodeCode, encodeCode, iceGathered, localSdp, RTC_CONFIG } from './rtc.js';

export type InviteState = 'waiting' | 'connecting' | 'connected' | 'closed' | 'failed';

export interface Invite {
  readonly id: string;
  readonly code: string;
  state: InviteState;
  guestName?: string;
  /** Paste the friend's reply code. Throws CodeError for malformed codes. */
  accept(reply: string): Promise<void>;
  cancel(): void;
  onChange(fn: () => void): void;
}

/** This browser hosts the room: the World runs in a worker, friends connect with invite codes. */
export class HostLink extends LinkBase implements Link {
  readonly role = 'host';
  private readonly worker: Worker;
  private readonly channels = new Map<string, RTCDataChannel>();
  readonly invites: Invite[] = [];
  private readonly inviteListeners = new Set<() => void>();

  constructor(
    readonly room: string,
    private readonly hello: Omit<Hello, 'v'>,
  ) {
    super();
    this.worker = new Worker(new URL('./hostWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.fromWorker(e.data);
    this.post({ k: 'start', room, since: Date.now() });
    this.post({ k: 'msg', peer: LOCAL_PEER, msg: { t: 'hello', hello: { ...hello, v: NET.protocol } } });
  }

  onInvites(fn: () => void) {
    this.inviteListeners.add(fn);
    return () => this.inviteListeners.delete(fn);
  }

  private invitesChanged() {
    for (const fn of this.inviteListeners) fn();
  }

  /** Creates a one-use invite: a code for one friend, completed by their reply code. */
  async invite(address?: string): Promise<Invite> {
    const id = crypto.randomUUID();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const channel = pc.createDataChannel('game', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc);
    const code = await encodeCode('invite', localSdp(pc, address), this.hello.name);
    const listeners = new Set<() => void>();
    const invite: Invite = {
      id,
      code,
      state: 'waiting',
      accept: async (reply) => {
        const { sdp, name } = await decodeCode('reply', reply);
        invite.guestName = name;
        set('connecting');
        await pc.setRemoteDescription({ type: 'answer', sdp });
      },
      cancel: () => {
        pc.close();
        set('closed');
      },
      onChange: (fn) => listeners.add(fn),
    };
    const set = (state: InviteState) => {
      invite.state = state;
      for (const fn of listeners) fn();
      this.invitesChanged();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') set('failed');
    };
    channel.onopen = () => {
      set('connected');
      this.channels.set(id, channel);
      this.post({ k: 'connect', peer: id });
    };
    channel.onmessage = (e) => {
      try {
        this.post({ k: 'msg', peer: id, msg: JSON.parse(String(e.data)) as ClientMessage });
      } catch {
        /* ignore malformed frames */
      }
    };
    channel.onclose = () => {
      this.channels.delete(id);
      this.post({ k: 'disconnect', peer: id });
      if (invite.state === 'connected') set('closed');
    };
    this.invites.push(invite);
    this.invitesChanged();
    return invite;
  }

  private post(m: ToWorker) {
    this.worker.postMessage(m);
  }

  private fromWorker(m: FromWorker) {
    if (m.peer === LOCAL_PEER) {
      if (m.k === 'send') this.emit(m.msg);
      else this.setStatus('offline', m.code);
      return;
    }
    const channel = this.channels.get(m.peer);
    if (m.k === 'send' && channel?.readyState === 'open') channel.send(JSON.stringify(m.msg satisfies ServerMessage));
    else if (m.k === 'kick') setTimeout(() => channel?.close(), 500); // let the error message arrive first
  }

  send(msg: ClientMessage) {
    // Hello goes out in the constructor; game messages wait for our own welcome like a guest's.
    if (this.status !== 'online') return false;
    this.post({ k: 'msg', peer: LOCAL_PEER, msg });
    return true;
  }

  close() {
    for (const channel of this.channels.values()) channel.close();
    for (const invite of this.invites) invite.cancel();
    this.worker.terminate();
    this.setStatus('offline');
  }
}
