// Change-only streams: the server remembers what a recipient last received and sends just the
// entries that changed (plus the ids that disappeared), with a full keyframe now and then so a
// client that missed something always converges.

export interface Delta<T> {
  players: T[];
  gone: string[];
  full?: boolean;
}

export const encodeItems = <T extends { id: string }>(items: T[]) =>
  new Map(items.map((item) => [item.id, JSON.stringify(item)]));

export class DeltaStream<T extends { id: string }> {
  private sent = new Map<string, string>();
  private lastFullAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly keyframeMs: number) {}

  /**
   * The message to send for the current `items`, or undefined when nothing changed. Pass
   * `encoded` (from encodeItems) when the same items go to many recipients.
   */
  next(items: T[], now: number, encoded: Map<string, string> = encodeItems(items)): Delta<T> | undefined {
    const current = encoded;
    if (now - this.lastFullAt >= this.keyframeMs) {
      this.sent = current;
      this.lastFullAt = now;
      return { players: items, gone: [], full: true };
    }
    const players = items.filter((item) => this.sent.get(item.id) !== current.get(item.id));
    const gone = [...this.sent.keys()].filter((id) => !current.has(id));
    this.sent = current;
    return players.length || gone.length ? { players, gone } : undefined;
  }

  /** Forces the next call to send a full keyframe (e.g. a new subscriber). */
  reset() {
    this.lastFullAt = Number.NEGATIVE_INFINITY;
  }
}

/** Client side: folds a delta into the known set. */
export function applyDelta<T extends { id: string }>(known: Map<string, T>, delta: Delta<T>): Map<string, T> {
  if (delta.full) known.clear();
  for (const id of delta.gone) known.delete(id);
  for (const item of delta.players) known.set(item.id, item);
  return known;
}
