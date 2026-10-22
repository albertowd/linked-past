#!/bin/sh
# Builds the snes9x WebAssembly core into public/core.
# Uses Docker when available, otherwise a local emsdk (`source emsdk_env.sh` first).
set -e
cd "$(dirname "$0")/.."
OUT="$PWD/public/core"
mkdir -p "$OUT"
if command -v emcc >/dev/null 2>&1; then
  REF=$(sed -n 's/^ARG SNES9X_REF=//p' emulator/Dockerfile)
  [ -d emulator/snes9x-src ] || git clone https://github.com/libretro/snes9x.git emulator/snes9x-src
  git -C emulator/snes9x-src checkout -q "$REF"
  make -C emulator -j"$(getconf _NPROCESSORS_ONLN)" OUT_DIR=out
  cp emulator/out/linked-past-core.js emulator/out/linked-past-core.wasm "$OUT/"
else
  docker build -t linked-past-core emulator
  docker run --rm --user "$(id -u):$(id -g)" -v "$OUT:/out" linked-past-core
fi
echo "core ready in $OUT"
