import { bgr555, type LinkSnapshot, type PlayerView, type PoseData, unpackPixels } from '../shared/index.js';
import { ctx2d } from '../ui/dom.js';
import type { PixelFont } from '../ui/font.js';

interface Remote {
  view: PlayerView;
  x: number; // smoothed position
  y: number;
  seenAt: number;
}

const NAME_COLORS = { link: '#78f878', zelda: '#f8a0d0' } as const;
const SNAP_DISTANCE = 64;
const GHOST_ALPHA = 110; // of 255

function renderPose(p: PoseData, ghost: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = p.w;
  c.height = p.h;
  const img = new ImageData(p.w, p.h);
  const px = unpackPixels(p.px, p.w * p.h);
  for (let i = 0; i < px.length; i++) {
    const v = px[i];
    if (!(v & 15)) continue;
    const [r, g, b] = bgr555(p.pals[v >> 4]?.[v & 15] ?? 0x7fff);
    // Ghosts (cutscenes, menus, hidden tab) keep their look but are see-through.
    img.data.set([r, g, b, ghost ? GHOST_ALPHA : 255], i * 4);
  }
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}

/** Eases the drawn position toward the latest network position; far jumps snap. */
function smooth(r: Remote) {
  const { x, y } = r.view;
  if (Math.hypot(x - r.x, y - r.y) > SNAP_DISTANCE) {
    r.x = x;
    r.y = y;
  } else {
    r.x += (x - r.x) * 0.35;
    r.y += (y - r.y) * 0.35;
  }
}

/** Draws other players on top of the game screen, in the game's own pixel space. */
export class Overlay {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly poses = new Map<string, PoseData>();
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  private readonly requested = new Set<string>();
  private readonly remotes = new Map<string, Remote>();
  private readonly tags = new Map<string, HTMLCanvasElement>();

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly font: PixelFont,
    private readonly requestPose: (hash: string) => void,
  ) {
    this.ctx = ctx2d(canvas);
  }

  addPose(p: PoseData) {
    this.poses.set(p.hash, p);
    this.requested.delete(p.hash);
  }

  setNear(players: PlayerView[]) {
    const now = performance.now();
    const seen = new Set<string>();
    for (const v of players) {
      seen.add(v.id);
      const r = this.remotes.get(v.id);
      if (r) {
        r.view = v;
        r.seenAt = now;
      } else this.remotes.set(v.id, { view: v, x: v.x, y: v.y, seenAt: now });
      if (v.pose && !this.poses.has(v.pose) && !this.requested.has(v.pose)) {
        this.requested.add(v.pose);
        this.requestPose(v.pose);
      }
    }
    for (const id of this.remotes.keys()) if (!seen.has(id)) this.remotes.delete(id);
  }

  /** Players near the local one, for trade/target lists. */
  nearby(): PlayerView[] {
    return [...this.remotes.values()].map((r) => r.view);
  }

  private sprite(hash: string, ghost: boolean) {
    const key = `${hash}${ghost ? 'g' : ''}`;
    let s = this.sprites.get(key);
    const pose = this.poses.get(hash);
    if (!s && pose) {
      s = renderPose(pose, ghost);
      if (this.sprites.size > 4000) this.sprites.clear();
      this.sprites.set(key, s);
    }
    return s && pose ? { s, pose } : undefined;
  }

  private tag(v: PlayerView) {
    const key = `${v.name}|${v.mode}`;
    let t = this.tags.get(key);
    if (!t) {
      t = this.font.canvas(v.name, { color: NAME_COLORS[v.mode] });
      this.tags.set(key, t);
    }
    return t;
  }

  draw(me: LinkSnapshot | undefined, myZone: string) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!me) return;
    const list = [...this.remotes.values()].filter((r) => r.view.zone === myZone).sort((a, b) => a.y - b.y);
    for (const r of list) {
      smooth(r);
      const sx = Math.round(r.x - me.cameraX);
      const sy = Math.round(r.y - me.cameraY);
      const margin = 32;
      if (sx < -margin || sy < -margin || sx > canvas.width + margin || sy > canvas.height + margin) continue;
      this.drawPlayer(r.view, sx, sy);
    }
  }

  private drawPlayer(v: PlayerView, sx: number, sy: number) {
    const { ctx } = this;
    const art = v.pose ? this.sprite(v.pose, v.ghost) : undefined;
    if (art) {
      ctx.drawImage(art.s, sx + art.pose.ox, sy + art.pose.oy);
    } else {
      // Pose not received yet: a simple marker where Link stands.
      ctx.fillStyle = v.ghost ? 'rgba(200,220,255,0.5)' : NAME_COLORS[v.mode];
      ctx.fillRect(sx + 4, sy + 4, 8, 16);
    }
    const tag = this.tag(v);
    ctx.globalAlpha = v.ghost ? 0.6 : 1;
    ctx.drawImage(tag, Math.round(sx + 8 - tag.width / 2), sy - 12);
    ctx.globalAlpha = 1;
  }
}
