// Minimal libretro frontend for the snes9x core, compiled together with it to WebAssembly.
// Exposes video/audio/input plus direct access to WRAM, SRAM, VRAM, OAM and CGRAM so the
// browser client can read game state (positions, modules) and write it (damage, trades).
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <emscripten/emscripten.h>

#include "libretro.h"
#include "snes9x.h"
#include "memmap.h"
#include "ppu.h"

#define MAX_W 512
#define MAX_H 478
#define AUDIO_CAP 16384 // stereo frames

static uint32_t framebuffer[MAX_W * MAX_H];
static unsigned fb_width = 256, fb_height = 224;
static int16_t audio_ring[AUDIO_CAP * 2];
static unsigned audio_write = 0, audio_read = 0;
static uint16_t joypad[2] = {0, 0};
static bool pixel_rgb565 = true;
static uint8_t *state_buf = nullptr;
static size_t state_cap = 0;

static void log_cb(enum retro_log_level, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vfprintf(stderr, fmt, ap);
  va_end(ap);
}

static bool env_cb(unsigned cmd, void *data) {
  switch (cmd) {
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: {
      auto fmt = *(enum retro_pixel_format *)data;
      pixel_rgb565 = fmt == RETRO_PIXEL_FORMAT_RGB565;
      return fmt == RETRO_PIXEL_FORMAT_RGB565 || fmt == RETRO_PIXEL_FORMAT_XRGB8888;
    }
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
      ((struct retro_log_callback *)data)->log = log_cb;
      return true;
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
      *(const char **)data = "/tmp";
      return true;
    case RETRO_ENVIRONMENT_GET_CAN_DUPE:
      *(bool *)data = true;
      return true;
    case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
      return true;
    case RETRO_ENVIRONMENT_GET_AUDIO_VIDEO_ENABLE:
      *(int *)data = 3;
      return true;
    default:
      return false;
  }
}

static void video_cb(const void *data, unsigned width, unsigned height, size_t pitch) {
  if (!data) return;
  if (width > MAX_W) width = MAX_W;
  if (height > MAX_H) height = MAX_H;
  fb_width = width;
  fb_height = height;
  for (unsigned y = 0; y < height; y++) {
    uint32_t *dst = framebuffer + y * width;
    if (pixel_rgb565) {
      const uint16_t *src = (const uint16_t *)((const uint8_t *)data + y * pitch);
      for (unsigned x = 0; x < width; x++) {
        uint16_t c = src[x];
        uint32_t r = (c >> 11) & 0x1f, g = (c >> 5) & 0x3f, b = c & 0x1f;
        r = (r << 3) | (r >> 2);
        g = (g << 2) | (g >> 4);
        b = (b << 3) | (b >> 2);
        dst[x] = 0xff000000u | (b << 16) | (g << 8) | r; // RGBA in little-endian memory
      }
    } else {
      const uint32_t *src = (const uint32_t *)((const uint8_t *)data + y * pitch);
      for (unsigned x = 0; x < width; x++) {
        uint32_t c = src[x];
        dst[x] = 0xff000000u | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff);
      }
    }
  }
}

static size_t audio_batch_cb(const int16_t *data, size_t frames) {
  for (size_t i = 0; i < frames; i++) {
    unsigned next = (audio_write + 1) % AUDIO_CAP;
    if (next == audio_read) break; // ring full, drop
    audio_ring[audio_write * 2] = data[i * 2];
    audio_ring[audio_write * 2 + 1] = data[i * 2 + 1];
    audio_write = next;
  }
  return frames;
}

static void audio_cb(int16_t l, int16_t r) {
  int16_t s[2] = {l, r};
  audio_batch_cb(s, 1);
}

static void input_poll_cb(void) {}

static int16_t input_state_cb(unsigned port, unsigned device, unsigned, unsigned id) {
  if (port > 1 || device != RETRO_DEVICE_JOYPAD) return 0;
  if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return (int16_t)joypad[port];
  return (joypad[port] >> id) & 1;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE int hw_init(void) {
  retro_set_environment(env_cb);
  retro_set_video_refresh(video_cb);
  retro_set_audio_sample(audio_cb);
  retro_set_audio_sample_batch(audio_batch_cb);
  retro_set_input_poll(input_poll_cb);
  retro_set_input_state(input_state_cb);
  retro_init();
  return 1;
}

EMSCRIPTEN_KEEPALIVE uint8_t *hw_alloc(size_t size) { return new uint8_t[size]; }
EMSCRIPTEN_KEEPALIVE void hw_free(uint8_t *ptr) { delete[] ptr; }

EMSCRIPTEN_KEEPALIVE int hw_load_rom(const uint8_t *data, size_t size) {
  struct retro_game_info info = {"rom.sfc", data, size, nullptr};
  if (!retro_load_game(&info)) return 0;
  retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
  return 1;
}

EMSCRIPTEN_KEEPALIVE void hw_run_frame(void) { retro_run(); }
EMSCRIPTEN_KEEPALIVE void hw_reset(void) { retro_reset(); }
EMSCRIPTEN_KEEPALIVE void hw_set_input(unsigned port, unsigned mask) {
  if (port < 2) joypad[port] = (uint16_t)mask;
}

EMSCRIPTEN_KEEPALIVE uint32_t *hw_framebuffer(void) { return framebuffer; }
EMSCRIPTEN_KEEPALIVE unsigned hw_fb_width(void) { return fb_width; }
EMSCRIPTEN_KEEPALIVE unsigned hw_fb_height(void) { return fb_height; }

// Copies up to max_frames buffered stereo frames into out; returns the count copied.
EMSCRIPTEN_KEEPALIVE unsigned hw_audio_read(int16_t *out, unsigned max_frames) {
  unsigned n = 0;
  while (n < max_frames && audio_read != audio_write) {
    out[n * 2] = audio_ring[audio_read * 2];
    out[n * 2 + 1] = audio_ring[audio_read * 2 + 1];
    audio_read = (audio_read + 1) % AUDIO_CAP;
    n++;
  }
  return n;
}

EMSCRIPTEN_KEEPALIVE double hw_sample_rate(void) {
  struct retro_system_av_info av;
  retro_get_system_av_info(&av);
  return av.timing.sample_rate;
}

EMSCRIPTEN_KEEPALIVE double hw_fps(void) {
  struct retro_system_av_info av;
  retro_get_system_av_info(&av);
  return av.timing.fps;
}

EMSCRIPTEN_KEEPALIVE uint8_t *hw_wram(void) { return Memory.RAM; }
EMSCRIPTEN_KEEPALIVE uint8_t *hw_vram(void) { return Memory.VRAM; }
EMSCRIPTEN_KEEPALIVE uint8_t *hw_oam(void) { return PPU.OAMData; }
EMSCRIPTEN_KEEPALIVE uint16_t *hw_cgram(void) { return PPU.CGDATA; }
EMSCRIPTEN_KEEPALIVE uint8_t *hw_sram(void) { return (uint8_t *)retro_get_memory_data(RETRO_MEMORY_SAVE_RAM); }
EMSCRIPTEN_KEEPALIVE size_t hw_sram_size(void) { return retro_get_memory_size(RETRO_MEMORY_SAVE_RAM); }

// OBJ configuration needed to decode sprites from VRAM: name base (word addr), name select, size select.
EMSCRIPTEN_KEEPALIVE unsigned hw_obj_name_base(void) { return PPU.OBJNameBase; }
EMSCRIPTEN_KEEPALIVE unsigned hw_obj_name_select(void) { return PPU.OBJNameSelect; }
EMSCRIPTEN_KEEPALIVE unsigned hw_obj_size_select(void) { return PPU.OBJSizeSelect; }

// Background layer configuration (byte addresses in VRAM) so the client can decode BG3 HUD tiles.
EMSCRIPTEN_KEEPALIVE unsigned hw_bg_sc_base(unsigned bg) { return bg < 4 ? PPU.BG[bg].SCBase << 1 : 0; }
EMSCRIPTEN_KEEPALIVE unsigned hw_bg_name_base(unsigned bg) { return bg < 4 ? PPU.BG[bg].NameBase << 1 : 0; }

// Savestates: serialize into an internal buffer, return its pointer; size via hw_state_size.
EMSCRIPTEN_KEEPALIVE size_t hw_state_size(void) { return retro_serialize_size(); }
EMSCRIPTEN_KEEPALIVE uint8_t *hw_state_save(void) {
  size_t size = retro_serialize_size();
  if (size > state_cap) {
    delete[] state_buf;
    state_buf = new uint8_t[size];
    state_cap = size;
  }
  return retro_serialize(state_buf, size) ? state_buf : nullptr;
}
EMSCRIPTEN_KEEPALIVE int hw_state_load(const uint8_t *data, size_t size) {
  return retro_unserialize(data, size) ? 1 : 0;
}

}  // extern "C"
