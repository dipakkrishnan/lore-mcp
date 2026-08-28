#!/bin/bash
set -euo pipefail

desktop_dir="$(cd "$(dirname "$0")/.." && pwd)"
app="$desktop_dir/out/Lore-darwin-arm64/Lore.app/Contents/MacOS/Lore"

if [[ ! -x "$app" ]]; then
  echo "Lore.app is missing. Build it first: npm --prefix app/desktop run package" >&2
  exit 1
fi

case "${1:-}" in
  new)
    dogfood_root="${LORE_DOGFOOD_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/lore-dogfood-new.XXXXXX")}"
    mkdir -p "$dogfood_root/home" "$dogfood_root/lore" "$dogfood_root/user-data"
    echo "Fresh-user sandbox: $dogfood_root"
    echo "Pass: sign in → set up → capture → inspect → publish → quit and relaunch."
    echo "To test persistence, quit Lore and rerun:"
    echo "LORE_DOGFOOD_ROOT='$dogfood_root' npm --prefix app/desktop run dogfood:new"
    HOME="$dogfood_root/home" \
      LORE_HOME="$dogfood_root/lore" \
      LORE_DESKTOP_USER_DATA="$dogfood_root/user-data" \
      "$app"
    ;;
  current)
    echo "Launching Lore with your current library, sign-in, and task history."
    echo "Pass: verify the summary → resume a paused task → capture something worth keeping."
    "$app"
    ;;
  *)
    echo "Usage: $0 new|current" >&2
    exit 2
    ;;
esac
