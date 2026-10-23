// QR codes for invites: drawing them, and reading one with the camera so codes never need to be
// typed. Everything runs on this device; nothing is sent anywhere.
import { renderSVG } from 'uqr';
import { t } from '../i18n.js';
import { codeFromText } from '../net/rtc.js';
import { h, label } from './dom.js';

/** A QR code of the text, black on white (what phone cameras read best). */
export function qrCode(text: string): HTMLElement {
  const el = h('div', { class: 'qr', role: 'img', ariaLabel: 'QR' });
  el.innerHTML = renderSVG(text, { ecc: 'L', border: 2 });
  return el;
}

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (opts: { formats: string[] }) => Detector;

/** Native BarcodeDetector where the browser has one, otherwise jsQR (loaded only when needed). */
async function decoder(): Promise<(video: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | undefined>> {
  const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (Native) {
    const detector = new Native({ formats: ['qr_code'] });
    return async (video) => (await detector.detect(video).catch(() => []))[0]?.rawValue;
  }
  const jsQR = (await import('jsqr')).default;
  return async (video, canvas) => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !canvas.width) return undefined;
    ctx.drawImage(video, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data;
  };
}

/**
 * Opens the camera full screen until a QR code is read (resolves with its text) or the player
 * cancels (resolves undefined). Throws when there is no camera or permission was refused.
 */
export async function scanQr(): Promise<string | undefined> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  const video = h('video', { class: 'scan-video', muted: true, playsInline: true, autoplay: true });
  video.srcObject = stream;
  const canvas = h('canvas', { class: 'hidden' });
  const decode = await decoder();
  return new Promise((resolve) => {
    let done = false;
    const finish = (text?: string) => {
      if (done) return;
      done = true;
      for (const track of stream.getTracks()) track.stop();
      overlay.remove();
      resolve(text);
    };
    const cancel = h('button', { class: 'btn', type: 'button', onclick: () => finish() }, label(t.controls.close));
    const overlay = h(
      'div',
      { class: 'scan' },
      h('p', {}, t.invite.scanHelp),
      h('div', { class: 'scan-frame' }, video),
      cancel,
      canvas,
    );
    document.body.append(overlay);
    const tick = async () => {
      if (done) return;
      const text = video.readyState >= 2 ? await decode(video, canvas) : undefined;
      if (text) finish(text);
      else setTimeout(() => void tick(), 150);
    };
    void video.play().then(tick, tick);
  });
}

/** A "Scan" button that fills a code box from a QR code and then runs `then`. */
export function scanButton(target: HTMLTextAreaElement, onError: (msg: string) => void, then?: () => void) {
  const btn = h('button', { class: 'btn small', type: 'button' }, label(t.invite.scan, {}, 1));
  btn.onclick = async () => {
    try {
      const text = await scanQr();
      if (!text) return;
      target.value = codeFromText(text);
      then?.();
    } catch {
      onError(t.invite.noCamera);
    }
  };
  return btn;
}
