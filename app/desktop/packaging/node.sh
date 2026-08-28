#!/bin/sh
# Bundle Node.js so `lore node deploy` works on a Mac with no developer tools:
# the app's Node runs npm and wrangler, nothing on the owner's PATH is assumed.
set -eu

NODE_VERSION=24.20.0
ARCH=darwin-arm64

OUT="$(cd "$(dirname "$0")" && pwd)/out"
NODE="$OUT/node"

mkdir -p "$OUT"
if [ -x "$NODE/bin/node" ] && [ "$("$NODE/bin/node" --version)" = "v$NODE_VERSION" ]; then
  exit 0
fi
rm -rf "$NODE"
mkdir -p "$NODE"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$ARCH.tar.gz" |
  tar -xz -C "$NODE" --strip-components 1 \
    "node-v$NODE_VERSION-$ARCH/bin" "node-v$NODE_VERSION-$ARCH/lib/node_modules/npm"
rm -rf "$NODE/bin/corepack" "$NODE/lib/node_modules/npm/docs" "$NODE/lib/node_modules/npm/man"
