#!/bin/sh
# Bundle npm so `lore node deploy` works on a Mac with no developer tools.
# No standalone Node ships (APP-044): bin/node is a shim onto Electron's
# embedded runtime (ELECTRON_RUN_AS_NODE=1), which runs npm and wrangler.
set -eu

NODE_VERSION=24.20.0
ARCH=darwin-arm64

OUT="$(cd "$(dirname "$0")" && pwd)/out"
NODE="$OUT/node"

mkdir -p "$OUT"
if [ -x "$NODE/bin/node" ] && grep -qs "npm from node-v$NODE_VERSION" "$NODE/bin/node" && [ -f "$NODE/lib/electron-as-node.cjs" ]; then
  exit 0
fi
rm -rf "$NODE"
mkdir -p "$NODE"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$ARCH.tar.gz" |
  tar -xz -C "$NODE" --strip-components 1 \
    "node-v$NODE_VERSION-$ARCH/bin" "node-v$NODE_VERSION-$ARCH/lib/node_modules/npm"
rm -rf "$NODE/bin/node" "$NODE/bin/corepack" "$NODE/lib/node_modules/npm/docs" "$NODE/lib/node_modules/npm/man"

cat > "$NODE/lib/electron-as-node.cjs" <<'PRELOAD'
// Under ELECTRON_RUN_AS_NODE the script arrives via argv, exactly like
// `electron .` — but process.defaultApp is unset, so yargs (wrangler's CLI
// parser) assumes a bundled Electron app and drops only argv[0], leaving the
// script path as a stray positional argument. Declare the truth.
process.defaultApp = true;
PRELOAD

{
  printf '#!/bin/sh\n# npm from node-v%s; Electron supplies the runtime (APP-044).\n' "$NODE_VERSION"
  cat <<'SHIM'
dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
export ELECTRON_RUN_AS_NODE=1
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require \"$dir/../lib/electron-as-node.cjs\""
for electron in "$dir/../../../MacOS/Lore" "$dir/../../../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"; do
  [ -x "$electron" ] && exec "$electron" "$@"
done
echo "node: no Electron binary near $dir" >&2
exit 1
SHIM
} > "$NODE/bin/node"
chmod +x "$NODE/bin/node"
