#!/bin/bash
# Seed a scratch Lore home with two memories and two drafts, then drive the renderer as one persona.
# Scenarios: seller | provision | store | jobs | fresh | feedback | listing | sources
set -euo pipefail
scenario="${1:-seller}"
desktop_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$desktop_dir/../.." && pwd)"
root="$(mktemp -d "${TMPDIR:-/tmp}/lore-edge.XXXXXX")"
mkdir -p "$root/home" "$root/user-data"
export LORE_HOME="$root/home" LORE_DESKTOP_USER_DATA="$root/user-data" LORE_SKIP_SCHEDULE=1 LORE_EDGE_OUT="$root"
# A fresh home stays empty: that persona checks what an owner sees before anything is kept.
[[ "$scenario" == "fresh" ]] || (
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
 first = store.start_job('push', timeout_minutes=60)
 store.finish_job(first, 'succeeded', summary='pushed', count=17)
 grown = store.start_job('push', timeout_minutes=60)
 store.finish_job(grown, 'succeeded', summary='pushed', count=19)
 done = store.start_job('capture', timeout_minutes=720)
 store.finish_job(done, 'succeeded', summary='captured', cost_usd=0.42)
 bad = store.start_job('push', timeout_minutes=60)
 store.finish_job(bad, 'failed', summary='edge_write_failed')
 gone = store.start_job('synthesis', timeout_minutes=60)
 store.finish_job(gone, 'incomplete', summary='not_reported')
 # No pid: this seeding process is about to exit, and a row it owned would be
 # conceded on the very next read. The long deadline keeps it Running.
 store.start_job('deploy', timeout_minutes=720)
from lore import automation
automation.save_profile({'executor': 'codex', 'cadence': 'daily', 'hour': 21})")
fi
if [[ "$scenario" == "sources" ]]; then
  # APP-120: one folder Lore reads, one it cannot, and one the owner adds from
  # the app. Seeded through STO-003's `lore sources` CLI, so this scenario only
  # runs once that has landed.
  mkdir -p "$root/notes" "$root/locked" "$root/more"
  for note in pricing hiring launch; do
    printf -- '---\ndate: 2026-08-14\n---\nA note about %s that is long enough for Lore to keep it.\n' "$note" > "$root/notes/$note.md"
  done
  printf 'too short\n' > "$root/notes/scrap.md"
  printf -- 'A locked note that is long enough for Lore to keep it.\n' > "$root/locked/one.md"
  printf -- 'A note in the folder the owner adds from the app, long enough to keep.\n' > "$root/more/first.md"
  printf -- 'A second note in that folder, also long enough to be kept.\n' > "$root/more/second.md"
  (cd "$repo_root" && uv run lore sources add --folder "$root/notes" --json >/dev/null)
  (cd "$repo_root" && uv run lore sources add --folder "$root/locked" --json >/dev/null)
  # CAP-005: a blog, served from this machine so the scenario never leaves it.
  # The feed reader speaks http(s) only, so a real origin is the only way in; it
  # stays up for the whole run because every `sources read` fetches it again.
  mkdir -p "$root/feed"
  cp "$repo_root/tests/fixtures/feeds/rss.xml" "$root/feed/rss.xml"
  python3 -c "
import functools, http.server
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory='$root/feed')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
open('$root/feed/port', 'w').write(str(server.server_address[1]))
server.serve_forever()" 2>/dev/null &
  feed_server=$!
  trap 'kill "$feed_server" 2>/dev/null || true' EXIT
  while [[ ! -s "$root/feed/port" ]]; do sleep 0.1; done
  (cd "$repo_root" && uv run lore sources add "--feed=http://127.0.0.1:$(cat "$root/feed/port")/rss.xml" --label "Notes on Systems" --json >/dev/null)
  # CAP-006: the zip each product emails, built from the fixtures. The Claude one
  # is the row already there; the ChatGPT one is what the stubbed file panel
  # hands the owner's own connect flow.
  python3 -c "
import zipfile
for product in ('chatgpt', 'claude'):
    with zipfile.ZipFile('$root/' + product + '-export.zip', 'w') as archive:
        archive.write('$repo_root/tests/fixtures/exports/' + product + '/conversations.json', 'conversations.json')"
  (cd "$repo_root" && uv run lore sources add "--export=$root/claude-export.zip" --json >/dev/null)
  # A folder this process cannot open raises the same PermissionError macOS
  # raises when it has not granted the read, which is the state under test.
  chmod 000 "$root/locked"
  (cd "$repo_root" && uv run lore sources read --json >/dev/null)
fi
if [[ "$scenario" == "listing" ]]; then
  # APP-119: a live store and a setup name, the two things the marketplace row needs.
  (cd "$repo_root" && uv run python -c "import json, time
from lore import blueprint
from lore.store import Store
with Store() as store:
 store.set_setting('node_url', 'https://store.example/mcp')
 store.set_setting('node_live', {'url': 'https://store.example/mcp', 'checked_at': time.time(), 'live': {'state': 'online', 'network': 'eip155:8453', 'price_usd': 0.01, 'payout': '0x' + 'a' * 40}, 'ids': []})
blueprint.blueprint_path().parent.mkdir(parents=True, exist_ok=True)
blueprint.blueprint_path().write_text(json.dumps({'name': 'Edge Seller'}))")
fi
if [[ "$scenario" == "store" ]]; then
  (cd "$repo_root" && uv run python -c "import time
from lore.store import Store
with Store() as store:
 store.set_setting('node_url', 'https://store.example/mcp')
 store.set_setting('node_live', {'url': 'https://store.example/mcp', 'checked_at': time.time(), 'live': {'state': 'online', 'network': 'eip155:84532', 'price_usd': 0.02, 'payout': '0x' + 'a' * 40}, 'ids': []})")
  (cd "$desktop_dir" && node --input-type=module -e "import { resolve } from 'node:path'; import { SessionManager } from '@earendil-works/pi-coding-agent';
const session = SessionManager.create(process.env.LORE_HOME, resolve(process.env.LORE_HOME, '.pi/sessions/deploy'));
session.appendMessage({ role: 'user', content: 'OLD COMPLETED DEPLOY', timestamp: 1 });
session.appendCustomEntry('lore.task', { version: 1, kind: 'deploy', title: 'Open your store', state: 'done', phase: 'Finished' });")
fi
echo "Screenshots land in $root"
"$desktop_dir/node_modules/.bin/electron" "$desktop_dir/support/edge.cjs" "$scenario" 2>/dev/null | grep -E "^(PASS|FAIL|ERROR)"
