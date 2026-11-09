#!/bin/sh
# The first download (APP-291): a disk image that opens on "drag Lore to Applications". The zip beside it stays,
# since update.electronjs.org only serves zips. dmgbuild is pure Python, so it runs on any Node, unlike appdmg.
# Usage: dmg.sh <Lore.app> <out.dmg>. Signed with LORE_SIGN_IDENTITY and notarized with APPLE_API_KEY when set.
set -eu

PACKAGING="$(cd "$(dirname "$0")" && pwd)"
OUT="$PACKAGING/out"
APP="$1"
DMG="$2"

"$PACKAGING/../node_modules/.bin/electron" "$PACKAGING/dmg-background.cjs" "$OUT/dmg-background.png"
rm -f "$DMG"
"$OUT/uv" tool run --quiet --from dmgbuild==1.6.7 dmgbuild -s "$PACKAGING/dmg.py" \
  -D app="$APP" -D background="$OUT/dmg-background.png" -D icon="$OUT/icon.icns" Lore "$DMG"

if [ -n "${LORE_SIGN_IDENTITY:-}" ]; then
  codesign --sign "$LORE_SIGN_IDENTITY" --timestamp "$DMG"
fi
if [ -n "${APPLE_API_KEY:-}" ]; then
  xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
  xcrun stapler staple "$DMG"
fi
