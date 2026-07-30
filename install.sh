#!/bin/sh
set -eu

REPOSITORY="dipakkrishnan/lore-mcp"
VERSION="${LORE_VERSION:-main}"
INSTALL_DIR="${LORE_INSTALL_DIR:-$HOME/.local/share/lore}"
BIN_DIR="${LORE_BIN_DIR:-$HOME/.local/bin}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

command -v python3 >/dev/null 2>&1 || { echo "Lore needs Python 3.10 or newer." >&2; exit 1; }
command -v uv >/dev/null 2>&1 || {
  echo "Lore needs uv: https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
}
command -v git >/dev/null 2>&1 || { echo "Lore needs git." >&2; exit 1; }
python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' || {
  echo "Lore needs Python 3.10 or newer." >&2
  exit 1
}

if [ -n "${LORE_SOURCE_DIR:-}" ]; then
  SOURCE_DIR="$LORE_SOURCE_DIR"
else
  command -v curl >/dev/null 2>&1 || { echo "Lore needs curl." >&2; exit 1; }
  command -v tar >/dev/null 2>&1 || { echo "Lore needs tar." >&2; exit 1; }
  echo "Downloading Lore $VERSION..."
  curl -fsSL "https://github.com/$REPOSITORY/archive/$VERSION.tar.gz" -o "$TMP_DIR/lore.tar.gz"
  tar -xzf "$TMP_DIR/lore.tar.gz" -C "$TMP_DIR"
  SOURCE_DIR="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
fi

mkdir -p "$BIN_DIR"
UV_TOOL_DIR="$INSTALL_DIR" UV_TOOL_BIN_DIR="$BIN_DIR" uv tool install --force --reinstall "$SOURCE_DIR"
for skill_dir in "$SOURCE_DIR"/skills/*/; do
  [ -d "$skill_dir" ] || continue
  skill="$(basename "$skill_dir")"
  rm -rf "$HOME/.agents/skills/$skill" "$HOME/.claude/skills/$skill"
  mkdir -p "$HOME/.agents/skills/$skill" "$HOME/.claude/skills/$skill"
  cp -R "$skill_dir." "$HOME/.agents/skills/$skill/"
  cp -R "$skill_dir." "$HOME/.claude/skills/$skill/"
done

echo "Installed Lore at $BIN_DIR/lore"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add $BIN_DIR to PATH to run Lore from any terminal." ;;
esac

if [ "${LORE_SKIP_SETUP:-0}" != "1" ]; then
  "$BIN_DIR/lore" setup --yes
fi
