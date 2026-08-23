#!/bin/sh
set -eu

PACKAGING="$(cd "$(dirname "$0")" && pwd)"
OUT="$PACKAGING/out"
ICONSET="$OUT/icon.iconset"

mkdir -p "$ICONSET"
qlmanage -t -s 1024 -o "$OUT" "$PACKAGING/icon.svg" >/dev/null 2>&1
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$OUT/icon.svg.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$OUT/icon.svg.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT/icon.icns"
rm -rf "$ICONSET" "$OUT/icon.svg.png"
