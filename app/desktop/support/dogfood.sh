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
    mkdir -p "$dogfood_root/lore" "$dogfood_root/user-data"
    echo "Fresh-user sandbox: $dogfood_root"
    echo "Pass: sign in → set up → capture → inspect → publish → quit and relaunch."
    echo "To test persistence, quit Lore and rerun:"
    echo "LORE_DOGFOOD_ROOT='$dogfood_root' npm --prefix app/desktop run dogfood:new"
    # Keep real $HOME for Keychain and onboarding history reads, but never
    # replace the owner's live synthesis schedule from a disposable sandbox.
    LORE_HOME="$dogfood_root/lore" \
      LORE_DESKTOP_USER_DATA="$dogfood_root/user-data" \
      LORE_SKIP_SCHEDULE=1 \
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
