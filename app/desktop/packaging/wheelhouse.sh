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

WINDUP_VERSION="$(basename "$OUT"/wheels/windup-*.whl | cut -d- -f2)"
echo "windup==$WINDUP_VERSION" > "$OUT/overrides.txt"
BUILD_ID="$(ls "$OUT/wheels" | sort | shasum | cut -d' ' -f1)"
printf '{"python": "%s", "build": "%s"}\n' "$PYTHON_VERSION" "$BUILD_ID" > "$OUT/runtime.json"
