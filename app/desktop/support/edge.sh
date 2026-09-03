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
if [[ "$scenario" == "jobs" ]]; then
  # One run of every shape Today has to render, including one still going and
  # one that started and never reported finishing.
  (cd "$repo_root" && uv run python -c "
from lore.store import Store
with Store() as store:
 done = store.start_job('capture', timeout_minutes=720)
 store.finish_job(done, 'succeeded', summary='captured', cost_usd=0.42)
 bad = store.start_job('push', timeout_minutes=60)
 store.finish_job(bad, 'failed', summary='edge_write_failed')
 gone = store.start_job('synthesis', timeout_minutes=60)
 store.finish_job(gone, 'incomplete', summary='not_reported')
 # No pid: this seeding process is about to exit, and a row it owned would be
 # conceded on the very next read. The long deadline keeps it Running.
 store.start_job('deploy', timeout_minutes=720)")
fi
if [[ "$scenario" == "store" ]]; then
  (cd "$repo_root" && uv run python -c "import time
from lore.store import Store
with Store() as store:
 store.set_setting('node_url', 'https://store.example/mcp')
 store.set_setting('node_live', {'url': 'https://store.example/mcp', 'checked_at': time.time(), 'live': {'state': 'online', 'network': 'eip155:84532', 'payout': '0x' + 'a' * 40}, 'ids': []})")
  (cd "$desktop_dir" && node --input-type=module -e "import { resolve } from 'node:path'; import { SessionManager } from '@earendil-works/pi-coding-agent';
const session = SessionManager.create(process.env.LORE_HOME, resolve(process.env.LORE_HOME, '.pi/sessions/deploy'));
session.appendMessage({ role: 'user', content: 'OLD COMPLETED DEPLOY', timestamp: 1 });
session.appendCustomEntry('lore.task', { version: 1, kind: 'deploy', title: 'Open your store', state: 'done', phase: 'Finished' });")
fi
echo "Screenshots land in $root"
"$desktop_dir/node_modules/.bin/electron" "$desktop_dir/support/edge.cjs" "$scenario" 2>/dev/null | grep -E "^(PASS|FAIL|ERROR)"
