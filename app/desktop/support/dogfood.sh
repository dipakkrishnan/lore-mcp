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
    # Real $HOME on purpose: overriding it makes macOS treat safeStorage's
    # Keychain lookup as an unrecognized identity, which triggers a
    # SecurityAgent authorization prompt that never gets shown/answered here
    # and hangs sign-in forever (APP-038). LORE_HOME and
    # LORE_DESKTOP_USER_DATA already isolate everything this app itself
    # reads or writes, so this is not a namespacing loss for Lore's own
    # state — only for the bash-sandbox scoping the setup/deploy tasks
    # derive from $HOME (owner dirs like .codex, .wrangler, .npmrc), which
    # a dogfood:new pass now shares with the real user's home.
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
