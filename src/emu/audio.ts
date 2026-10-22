// Streams emulator audio (32040 Hz stereo int16) into an AudioWorklet that resamples to the device rate.

const WORKLET = `
class LinkedPastAudio extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = options.processorOptions.inputRate / sampleRate;
    this.buf = new Float32Array(65536);
    this.read = 0; this.write = 0; this.pos = 0;
    this.port.onmessage = (e) => {
      const s = e.data;
      for (let i = 0; i < s.length; i++) {
        this.buf[this.write] = s[i];
        this.write = (this.write + 1) & 65535;
      }
    };
  }
  available() { return ((this.write - this.read) & 65535) >> 1; }
  process(_in, outputs) {
    const [l, r] = outputs[0];
    for (let i = 0; i < l.length; i++) {
      if (this.available() < 2) { l[i] = r[i] = 0; continue; }
      const f = this.pos;
      const a = this.read, b = (this.read + 2) & 65535;
      l[i] = this.buf[a] + (this.buf[b] - this.buf[a]) * f;
      r[i] = this.buf[a + 1] + (this.buf[(b + 1) & 65535] - this.buf[a + 1]) * f;
      this.pos += this.ratio;
      while (this.pos >= 1) { this.pos -= 1; this.read = (this.read + 2) & 65535; }
    }
    // Drop backlog so latency stays bounded if the emulator ran ahead.
    if (this.available() > 8192) this.read = (this.write - 4096 * 2) & 65535;
    return true;
  }
}
registerProcessor('linked-past-audio', LinkedPastAudio);
`;

export class AudioOut {
  private ctx?: AudioContext;
  private node?: AudioWorkletNode;
  muted = false;

  constructor(private readonly inputRate: number) {}

  /** Must be called from a user gesture (browser autoplay rules). */
  async start() {
    if (this.ctx) return void this.ctx.resume();
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.node = new AudioWorkletNode(this.ctx, 'linked-past-audio', {
      outputChannelCount: [2],
      processorOptions: { inputRate: this.inputRate },
    });
    this.node.connect(this.ctx.destination);
  }

  push(samples: Int16Array) {
    if (!this.node || this.muted || samples.length === 0) return;
    const f = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) f[i] = samples[i] / 32768;
    this.node.port.postMessage(f, [f.buffer]);
  }
}
