#!/bin/sh
set -eu

PACKAGING="$(cd "$(dirname "$0")" && pwd)"
OUT="$PACKAGING/out"
ICONSET="$OUT/icon.iconset"

mkdir -p "$ICONSET"
"$PACKAGING/../node_modules/.bin/electron" "$PACKAGING/icon.cjs" "$OUT/icon.png"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$OUT/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$OUT/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT/icon.icns"
rm -rf "$ICONSET" "$OUT/icon.png"
