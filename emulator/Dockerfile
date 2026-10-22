# Reproducible build of the WebAssembly SNES core.
#   docker build -t linked-past-core emulator && docker run --rm -v "$PWD/public/core:/out" linked-past-core
FROM emscripten/emsdk:3.1.74
ARG SNES9X_REF=fae2fea08f74180759ef540ee94259213f503480
WORKDIR /src
RUN git clone https://github.com/libretro/snes9x.git snes9x-src \
 && git -C snes9x-src checkout ${SNES9X_REF}
COPY Makefile frontend.cpp ./
RUN make -j"$(nproc)" OUT_DIR=/build
# Copy out as an unprivileged user; build-core.sh passes the host uid/gid via --user.
USER 1000:1000
CMD ["sh", "-c", "cp /build/linked-past-core.js /build/linked-past-core.wasm /out/"]
