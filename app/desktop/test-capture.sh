#!/bin/bash
set -euo pipefail

desktop_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$desktop_dir/../.." && pwd)"
lore_test_home="$(mktemp -d "${TMPDIR:-/tmp}/lore-desktop-capture.XXXXXX")"
app_pid=""

cleanup() {
  if [[ -n "$app_pid" ]]; then kill "$app_pid" 2>/dev/null || true; fi
  rm -rf "$lore_test_home"
}
trap cleanup EXIT

LORE_HOME="$lore_test_home" "$desktop_dir/node_modules/.bin/electron" "$desktop_dir" &
app_pid="$!"

echo "In Lore, capture one synthetic lesson, approve its exact wording, and allow the save command once."
read -r -p "Press Return after Lore confirms the private save. "

(
  cd "$repo_root"
  LORE_HOME="$lore_test_home" uv run lore desktop-state
) | node -e '
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const snapshot = JSON.parse(input);
  if (snapshot.library.counts.private < 1) throw new Error("no private memory was captured");
  console.log(`PASS: ${snapshot.library.counts.private} private memory captured through Electron`);
});
'
