#!/bin/sh
# Build the dictation helper (macOS speech recognition) into packaging/out.
set -eu
PACKAGING="$(cd "$(dirname "$0")" && pwd)"
OUT="$PACKAGING/out"
mkdir -p "$OUT"
if [ -x "$OUT/dictate" ] && [ ! "$PACKAGING/dictate.swift" -nt "$OUT/dictate" ]; then
  exit 0
fi
swiftc -O -o "$OUT/dictate" "$PACKAGING/dictate.swift" -framework Speech -framework AVFoundation
