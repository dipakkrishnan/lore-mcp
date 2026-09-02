#!/bin/bash
# Seed a scratch Lore home with two memories and two drafts, then drive the renderer as one persona.
set -euo pipefail
scenario="${1:-seller}"
desktop_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$desktop_dir/../.." && pwd)"
root="$(mktemp -d "${TMPDIR:-/tmp}/lore-edge.XXXXXX")"
mkdir -p "$root/home" "$root/user-data"
export LORE_HOME="$root/home" LORE_DESKTOP_USER_DATA="$root/user-data" LORE_SKIP_SCHEDULE=1 LORE_EDGE_OUT="$root"
(
  cd "$repo_root"
  echo '[{"title":"Hire management before rapid growth","content":"Add the management layer before the next ten engineers join, not after.","project":"team scaling"},{"title":"Price the first tier low","content":"A low first price gets the first ten buyers; raise it once there are receipts.","project":"pricing"}]' | uv run lore capture apply - >/dev/null
  echo '[{"title":"Hire management before rapid growth","teaser":"When to add managers in a fast-growing team.","content":"Add the management layer before the next ten engineers join, not after.","kind":"claim","topic":"team scaling","provenance":[1]},{"title":"Price the first tier low","teaser":"How to set a first price.","content":"A low first price gets the first ten buyers; raise it once there are receipts.","kind":"claim","topic":"pricing","provenance":[2]}]' | uv run lore publication draft - >/dev/null
)
echo "Screenshots land in $root"
"$desktop_dir/node_modules/.bin/electron" "$desktop_dir/support/edge.cjs" "$scenario" 2>/dev/null | grep -E "^(PASS|FAIL|ERROR)"
