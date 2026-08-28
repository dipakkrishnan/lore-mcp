#!/bin/sh
# Build whisper.cpp (one static binary, Metal embedded) and fetch the English
# base model, so dictation is transcribed on this Mac with nothing to enable.
set -eu

WHISPER_TAG=b4938
MODEL=ggml-base.en.bin

PACKAGING="$(cd "$(dirname "$0")" && pwd)"
OUT="$PACKAGING/out/whisper"
SRC="$PACKAGING/out/whisper-src"

mkdir -p "$OUT"
if [ ! -x "$OUT/whisper-cli" ] || [ "$(cat "$OUT/version" 2>/dev/null)" != "$WHISPER_TAG" ]; then
  rm -rf "$SRC"
  git clone --quiet --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp "$SRC"
  cmake -S "$SRC" -B "$SRC/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF >/dev/null
  cmake --build "$SRC/build" --config Release --target whisper-cli -j >/dev/null
  cp "$SRC/build/bin/whisper-cli" "$OUT/whisper-cli"
  echo "$WHISPER_TAG" > "$OUT/version"
  rm -rf "$SRC"
fi
if [ ! -f "$OUT/$MODEL" ]; then
  curl -fsSL "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL" -o "$OUT/$MODEL.part"
  mv "$OUT/$MODEL.part" "$OUT/$MODEL"
fi
