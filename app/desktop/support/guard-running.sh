#!/bin/bash
# Packaging replaces Lore.app in place. A copy still running from that bundle
# keeps loading modules from the new files and fails with import errors.
set -euo pipefail

desktop_dir="$(cd "$(dirname "$0")/.." && pwd)"
bundle="${LORE_GUARD_BUNDLE:-$desktop_dir/out/Lore-darwin-arm64/Lore.app}"

if pgrep -f "$bundle/Contents/MacOS/" >/dev/null 2>&1; then
  echo "Lore is running from $bundle." >&2
  echo "Quit it first (Lore > Quit Lore), then run the package step again." >&2
  exit 1
fi
