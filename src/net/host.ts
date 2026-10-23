import { type ClientMessage, type Hello, LOCAL_PEER, NET, type ServerMessage } from '../shared/index.js';
import type { FromWorker, ToWorker } from './hostWorker.js';
import { type Link, LinkBase } from './link.js';
import { decodeCode, encodeCode, iceGathered, localSdp, RTC_CONFIG } from './rtc.js';

export type GuestState = 'waiting' | 'connected' | 'closed' | 'failed';

/** One friend being let in: their request answered, waiting for them to read the answer code. */
export interface Admission {
  readonly id: string;
  readonly answer: string;
  readonly guestName?: string;
  state: GuestState;
  cancel(): void;
  onChange(fn: () => void): void;
}

/** This browser hosts the room: the World runs in a worker, friends connect with codes. */
export class HostLink extends LinkBase implements Link {
  readonly role = 'host';
  private readonly worker: Worker;
  private readonly channels = new Map<string, RTCDataChannel>();
  readonly admissions: Admission[] = [];
  private roomCodePromise?: Promise<string>;

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

  /** The room's code: the same for every friend for as long as this room is open. */
  roomCode(): Promise<string> {
    this.roomCodePromise ??= encodeCode('room', '', this.hello.name);
    return this.roomCodePromise;
  }

  /** Answers a friend's request code. Throws CodeError for malformed codes. */
  async admit(request: string, address?: string): Promise<Admission> {
    const { sdp, name } = await decodeCode('request', request);
    const id = crypto.randomUUID();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await iceGathered(pc);
    const listeners = new Set<() => void>();
    const admission: Admission = {
      id,
      answer: await encodeCode('answer', localSdp(pc, address), this.hello.name),
      guestName: name,
      state: 'waiting',
      cancel: () => {
        pc.close();
        set('closed');
      },
      onChange: (fn) => listeners.add(fn),
    };
    const set = (state: GuestState) => {
      admission.state = state;
      for (const fn of listeners) fn();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') set('failed');
    };
    // The guest opens the channel, since it made the offer.
    pc.ondatachannel = ({ channel }) => {
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
        if (admission.state === 'connected') set('closed');
      };
      if (channel.readyState === 'open') channel.onopen(new Event('open'));
    };
    this.admissions.push(admission);
    return admission;
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
    for (const admission of this.admissions) admission.cancel();
    this.worker.terminate();
    this.setStatus('offline');
  }
}
