import type { ClientMessage, ServerMessage } from '../shared/index.js';

export type LinkStatus = 'connecting' | 'searching' | 'verifying' | 'online' | 'offline';

/** How the game session talks to the room, whether this browser hosts it or joined it. */
export interface Link {
  readonly role: 'host' | 'guest';
  readonly room: string;
  readonly status: LinkStatus;
  /** False when the message could not go out yet (not connected / not verified). */
  send(msg: ClientMessage): boolean;
  onMessage(fn: (m: ServerMessage) => void): () => void;
  onStatus(fn: (s: LinkStatus, detail?: string) => void): () => void;
  close(): void;
}

export abstract class LinkBase {
  private readonly messageFns = new Set<(m: ServerMessage) => void>();
  private readonly statusFns = new Set<(s: LinkStatus, detail?: string) => void>();
  status: LinkStatus = 'connecting';
  private detail?: string;

  onMessage(fn: (m: ServerMessage) => void) {
    this.messageFns.add(fn);
    return () => this.messageFns.delete(fn);
  }

  onStatus(fn: (s: LinkStatus, detail?: string) => void) {
    this.statusFns.add(fn);
    fn(this.status, this.detail);
    return () => this.statusFns.delete(fn);
  }

  protected emit(msg: ServerMessage) {
    if (msg.t === 'welcome') this.setStatus('online');
    for (const fn of this.messageFns) fn(msg);
  }

  protected setStatus(s: LinkStatus, detail?: string) {
    this.status = s;
    this.detail = detail;
    for (const fn of this.statusFns) fn(s, detail);
  }
}
