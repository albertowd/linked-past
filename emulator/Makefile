# Builds snes9x + frontend.cpp into an ES module WebAssembly core (run inside emscripten/emsdk).
CORE_DIR := snes9x-src
OUT_DIR ?= out

include $(CORE_DIR)/libretro/Makefile.common

DEFINES := -D__LIBRETRO__ -DHAVE_STRINGS_H -DHAVE_STDINT_H -DRIGHTSHIFT_IS_SAR -DNDEBUG
COMMON  := -O3 -fno-strict-aliasing $(DEFINES) $(INCFLAGS)
CFLAGS  := $(COMMON)
CXXFLAGS := $(COMMON) -std=c++17 -fno-rtti -fno-exceptions -Wno-everything

OBJECTS := $(SOURCES_CXX:.cpp=.o) $(SOURCES_C:.c=.o) frontend.o

EXPORTS := _hw_init,_hw_alloc,_hw_free,_hw_load_rom,_hw_run_frame,_hw_reset,_hw_set_input,_hw_framebuffer,_hw_fb_width,_hw_fb_height,_hw_audio_read,_hw_sample_rate,_hw_fps,_hw_wram,_hw_vram,_hw_oam,_hw_cgram,_hw_sram,_hw_sram_size,_hw_obj_name_base,_hw_obj_name_select,_hw_obj_size_select,_hw_bg_sc_base,_hw_bg_name_base,_hw_state_size,_hw_state_save,_hw_state_load,_malloc,_free

LDFLAGS := -O3 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createLinkedPastCore \
	-sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB \
	-sFILESYSTEM=1 -sEXPORTED_FUNCTIONS=$(EXPORTS) \
	-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16,HEAP16,HEAPU32

all: $(OUT_DIR)/linked-past-core.js

$(OUT_DIR)/linked-past-core.js: $(OBJECTS)
	mkdir -p $(OUT_DIR)
	em++ $(LDFLAGS) -o $@ $(OBJECTS)

%.o: %.cpp
	em++ $(CXXFLAGS) -c $< -o $@

%.o: %.c
	emcc $(CFLAGS) -c $< -o $@

frontend.o: frontend.cpp
	em++ $(CXXFLAGS) -I$(CORE_DIR)/libretro -c $< -o $@

clean:
	rm -f $(OBJECTS) $(OUT_DIR)/linked-past-core.*
