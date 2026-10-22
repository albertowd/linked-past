// Typed wrapper around the snes9x WebAssembly core (emulator/frontend.cpp).

interface CoreModule {
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAP16: Int16Array;
  _malloc(n: number): number;
  _free(p: number): void;
  _hw_init(): number;
  _hw_load_rom(p: number, n: number): number;
  _hw_run_frame(): void;
  _hw_reset(): void;
  _hw_set_input(port: number, mask: number): void;
  _hw_framebuffer(): number;
  _hw_fb_width(): number;
  _hw_fb_height(): number;
  _hw_audio_read(p: number, max: number): number;
  _hw_sample_rate(): number;
  _hw_fps(): number;
  _hw_wram(): number;
  _hw_vram(): number;
  _hw_oam(): number;
  _hw_cgram(): number;
  _hw_sram(): number;
  _hw_sram_size(): number;
  _hw_obj_name_base(): number;
  _hw_bg_sc_base(bg: number): number;
  _hw_bg_name_base(bg: number): number;
  _hw_state_size(): number;
  _hw_state_save(): number;
  _hw_state_load(p: number, n: number): number;
}

export const BUTTON = {
  B: 0,
  Y: 1,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  A: 8,
  X: 9,
  L: 10,
  R: 11,
} as const;
export type Button = keyof typeof BUTTON;

const AUDIO_CHUNK = 2048;

export class Core {
  private constructor(
    private readonly m: CoreModule,
    readonly fps: number,
    readonly sampleRate: number,
    private readonly audioPtr: number,
  ) {}

  static async create(rom: Uint8Array): Promise<Core> {
    // The core is a static asset in public/core; importing it through a runtime function keeps
    // Vite from trying to bundle or transform the emscripten glue.
    const url = new URL(`${import.meta.env.BASE_URL}core/linked-past-core.js`, location.href).href;
    const load = new Function('u', 'return import(u)') as (
      u: string,
    ) => Promise<{ default: (opts: object) => Promise<CoreModule> }>;
    const factory = (await load(url)).default;
    const m = await factory({ print: () => {}, printErr: (s: string) => console.debug('[core]', s) });
    m._hw_init();
    const p = m._malloc(rom.length);
    m.HEAPU8.set(rom, p);
    // The core keeps its own copy of the ROM, so the buffer can be released.
    const ok = m._hw_load_rom(p, rom.length);
    m._free(p);
    if (!ok) throw new Error('The emulator could not load this ROM.');
    return new Core(m, m._hw_fps(), m._hw_sample_rate(), m._malloc(AUDIO_CHUNK * 4));
  }

  runFrame(mask: number) {
    this.m._hw_set_input(0, mask);
    this.m._hw_run_frame();
  }

  reset() {
    this.m._hw_reset();
  }

  /** RGBA pixels of the last frame; valid until the next runFrame. */
  frame(): { width: number; height: number; pixels: Uint8ClampedArray } {
    const width = this.m._hw_fb_width();
    const height = this.m._hw_fb_height();
    const p = this.m._hw_framebuffer();
    return { width, height, pixels: new Uint8ClampedArray(this.m.HEAPU8.buffer, p, width * height * 4) };
  }

  /** Drains buffered stereo samples (interleaved int16). */
  drainAudio(): Int16Array {
    const n = this.m._hw_audio_read(this.audioPtr, AUDIO_CHUNK);
    return this.m.HEAP16.slice(this.audioPtr >> 1, (this.audioPtr >> 1) + n * 2);
  }

  // Views are re-created on every call: memory growth replaces the underlying buffer.
  wram = () => this.m.HEAPU8.subarray(this.m._hw_wram(), this.m._hw_wram() + 0x20000);
  vram = () => this.m.HEAPU8.subarray(this.m._hw_vram(), this.m._hw_vram() + 0x10000);
  oam = () => this.m.HEAPU8.subarray(this.m._hw_oam(), this.m._hw_oam() + 544);
  cgram = () => this.m.HEAPU16.subarray(this.m._hw_cgram() >> 1, (this.m._hw_cgram() >> 1) + 256);
  objNameBase = () => this.m._hw_obj_name_base();
  bgScreenBase = (bg: number) => this.m._hw_bg_sc_base(bg);
  bgNameBase = (bg: number) => this.m._hw_bg_name_base(bg);

  sram(): Uint8Array {
    const p = this.m._hw_sram();
    return this.m.HEAPU8.subarray(p, p + this.m._hw_sram_size());
  }

  loadSram(data: Uint8Array) {
    const sram = this.sram();
    sram.set(data.subarray(0, sram.length));
  }

  saveState(): Uint8Array {
    const p = this.m._hw_state_save();
    return this.m.HEAPU8.slice(p, p + this.m._hw_state_size());
  }

  loadState(data: Uint8Array): boolean {
    const p = this.m._malloc(data.length);
    this.m.HEAPU8.set(data, p);
    const ok = this.m._hw_state_load(p, data.length) === 1;
    this.m._free(p);
    return ok;
  }
}
