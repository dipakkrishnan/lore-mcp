#!/bin/sh
set -eu

UV_VERSION=0.12.5
PYTHON_VERSION=3.12.14
ARCH=aarch64-apple-darwin

PACKAGING="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$PACKAGING/../../.." && pwd)"
OUT="$PACKAGING/out"

mkdir -p "$OUT"
if [ ! -x "$OUT/uv" ] || [ "$("$OUT/uv" --version | cut -d' ' -f2)" != "$UV_VERSION" ]; then
  curl -fsSL "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$ARCH.tar.gz" |
    tar -xz -C "$OUT" --strip-components 1 "uv-$ARCH/uv"
fi

rm -rf "$OUT/wheels"
"$OUT/uv" build --wheel -o "$OUT/wheels" "$ROOT"
"$OUT/uv" export --directory "$ROOT" --frozen --no-dev --no-hashes --no-emit-project -o "$OUT/requirements.txt"
"$OUT/uv" run --python "$PYTHON_VERSION" --managed-python --no-project --with pip \
  python -m pip wheel --quiet --wheel-dir "$OUT/wheels" -r "$OUT/requirements.txt"
rm -f "$OUT/wheels/.gitignore" "$OUT/requirements.txt"

if [ -n "${LORE_SIGN_IDENTITY:-}" ]; then
  SIGN_DIR="$(mktemp -d)"
  trap 'rm -rf "$SIGN_DIR"' EXIT HUP INT TERM
  for WHEEL in "$OUT"/wheels/*macosx*.whl; do
    UNPACKED="$SIGN_DIR/$(basename "$WHEEL" .whl)"
    mkdir "$UNPACKED"
    unzip -q "$WHEEL" -d "$UNPACKED"
    BINARY="$(find "$UNPACKED" -type f \( -name '*.so' -o -name '*.dylib' \) -print -quit)"
    if [ -n "$BINARY" ]; then
      RECORD="$(find "$UNPACKED" -path '*.dist-info/RECORD' -print -quit)"
      find "$UNPACKED" -type f \( -name '*.so' -o -name '*.dylib' \) -print | while IFS= read -r BINARY; do
        codesign --force --options runtime --timestamp --sign "$LORE_SIGN_IDENTITY" "$BINARY"
        RELATIVE="${BINARY#"$UNPACKED/"}"
        HASH="$(openssl dgst -sha256 -binary "$BINARY" | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
        SIZE="$(wc -c < "$BINARY" | tr -d ' ')"
        awk -F, -v path="$RELATIVE" -v hash="sha256=$HASH" -v size="$SIZE" \
          'BEGIN { OFS="," } $1 == path { $2=hash; $3=size } { print }' "$RECORD" > "$RECORD.tmp"
        mv "$RECORD.tmp" "$RECORD"
      done
      rm -f "$WHEEL"
      (cd "$UNPACKED" && zip -q -X -r "$WHEEL" .)
    fi
    rm -rf "$UNPACKED"
  done
  rm -rf "$SIGN_DIR"
  trap - EXIT HUP INT TERM
fi

WINDUP_VERSION="$(basename "$OUT"/wheels/windup-*.whl | cut -d- -f2)"
echo "windup==$WINDUP_VERSION" > "$OUT/overrides.txt"
BUILD_ID="$(cd "$OUT/wheels" && cksum ./*.whl | cksum | awk '{print $1}')"
[ -n "$BUILD_ID" ]
printf '{"python": "%s", "build": "%s"}\n' "$PYTHON_VERSION" "$BUILD_ID" > "$OUT/runtime.json"
