#!/bin/bash
# Seed a scratch Lore home with two memories and two drafts, then drive the renderer as one persona.
# Scenarios: seller | provision | store | jobs | fresh | feedback | listing | obsidian | connectors | faq | sell | cards | sales | extras | settings
set -euo pipefail
scenario="${1:-seller}"
desktop_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$desktop_dir/../.." && pwd)"
root="$(mktemp -d "${TMPDIR:-/tmp}/lore-edge.XXXXXX")"
mkdir -p "$root/home" "$root/user-data"
export LORE_HOME="$root/home" LORE_DESKTOP_USER_DATA="$root/user-data" LORE_SKIP_SCHEDULE=1 LORE_EDGE_OUT="$root"
# Usage events from a walk go nowhere: a closed local port, refused at once.
export LORE_USAGE_URL="http://127.0.0.1:9/events"
# A fresh home stays empty: that persona checks what an owner sees before anything is kept. So
# does the connectors one: a seller with no agents, whose first memories come from their apps.
[[ "$scenario" == "fresh" || "$scenario" == "connectors" ]] || (
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
if [[ "$scenario" == "sales" ]]; then
  # MON-037: a store with one piece for sale and one card sale already in its ledger. The node's
  # wrangler is a stand-in that answers from files the scenario rewrites as new sales arrive.
  (cd "$repo_root" && uv run python -c "
import json, os
from lore.store import Store
out = os.environ['LORE_EDGE_OUT']
with Store() as store:
 store.set_setting('node_url', 'https://edge-store.invalid/mcp')
 store.add_publication(title='Live demos beat cold decks', content='paid text', topic='launches', teaser='What beat a cold deck', provenance=[1])
 piece = store.list_publications()[0].public_id
json.dump([{'kind': 'publication', 'item_id': piece, 'title': 'Live demos beat cold decks', 'price_usd': 3.0, 'network': 'stripe', 'payer': '', 'tx': 'pi_old', 'sold_at': '2026-10-01T12:00:00Z'}], open(f'{out}/sales.json', 'w'))
json.dump([{'item_id': piece, 'views': 42}], open(f'{out}/views.json', 'w'))
open(f'{out}/piece', 'w').write(piece)")
  mkdir -p "$LORE_HOME/node/node_modules/.bin"
  printf '#!/bin/sh\ncase "$*" in *page_views*) printf "[{\\"results\\": []}, {\\"results\\": %%s}]" "$(cat "$LORE_EDGE_OUT/views.json")";; *) printf "[{\\"results\\": %%s}]" "$(cat "$LORE_EDGE_OUT/sales.json")";; esac\n' > "$LORE_HOME/node/node_modules/.bin/wrangler"
  chmod +x "$LORE_HOME/node/node_modules/.bin/wrangler"
fi
if [[ "$scenario" == "listing" ]]; then
  # XC-036: a live store, a setup name, a push that always succeeds, and an empty public list.
  mkdir -p "$root/home/node" "$root/bin"
  echo '{}' > "$root/home/node/wrangler.jsonc"
  printf '#!/bin/sh\nexit 0\n' > "$root/bin/npx" && chmod +x "$root/bin/npx"
  echo '{"sellers":[]}' > "$root/marketplace.json"
  export PATH="$root/bin:$PATH" LORE_MARKETPLACE_URL="file://$root/marketplace.json"
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
if [[ "$scenario" == "extras" ]]; then
  # A piece already for sale from before samples existed, and new free parts an agent drafted for it.
  (cd "$repo_root" && uv run python -c "
from lore.store import Store
with Store() as store:
 store.add_publication(title='Live demos beat cold decks', content='Three demos, seven trials; the deck got nothing.', topic='launches', teaser='What beat a cold deck', provenance=[1])"
  echo '[{"publication_id":1,"sample":"We had two weeks and a deck we were proud of.","useful_if":"you are launching a developer tool"}]' | uv run lore publication extras draft - >/dev/null)
fi
if [[ "$scenario" == "settings" ]]; then
  # A store on real money with every Settings row filled: cards on, paid answers, listed, and two
  # pieces already for sale with new free parts waiting, one with a sample and one without.
  echo '{"sellers":[{"node":"https://lore-edge.example.workers.dev/mcp"}]}' > "$root/marketplace.json"
  export LORE_MARKETPLACE_URL="file://$root/marketplace.json"
  (cd "$repo_root" && uv run python -c "import time
from lore.store import Store
with Store() as store:
 store.set_setting('node_url', 'https://lore-edge.example.workers.dev/mcp')
 store.set_setting('node_live', {'url': 'https://lore-edge.example.workers.dev/mcp', 'checked_at': time.time(), 'live': {'state': 'online', 'network': 'eip155:8453', 'price_usd': 1.0, 'payout': '0x0c270534cfcecc9224edb903ef5dd70410d08166'}, 'ids': []})
 store.set_setting('price_usd', 1.0)
 store.set_setting('answer_enabled', True)
 store.set_setting('answer_price_usd', 0.1)
 store.set_setting('stripe_account', 'acct_1EdgeSeller')
 store.set_setting('listed_name', 'Edge Seller')
 store.add_publication(title='Live demos beat cold decks', content='Three demos, seven trials; the deck got nothing.', topic='launches', teaser='What beat a cold deck', provenance=[1])
 store.add_publication(title='Raise prices after the tenth buyer', content='We doubled at ten buyers and lost none.', topic='pricing', teaser='When to raise a first price', provenance=[2])"
  echo '[{"publication_id":1,"sample":"We had two weeks and a deck we were proud of.","useful_if":"you are launching a developer tool","not_useful_if":"you sell through a sales team"},{"publication_id":2,"sample":"","useful_if":"you have your first paying customers","not_useful_if":""}]' | uv run lore publication extras draft - >/dev/null)
fi
if [[ "$scenario" == "obsidian" ]]; then
  # APP-124: a vault Obsidian knows about, so Connect has something to offer without a path.
  mkdir -p "$root/obsidian" "$root/Edge Vault"
  printf '# One\n\nA first lesson long enough to be worth keeping.\n' > "$root/Edge Vault/one.md"
  printf '# Two\n\nA second lesson long enough to be worth keeping.\n' > "$root/Edge Vault/two.md"
  printf '{"vaults":{"e1":{"path":"%s","ts":1,"open":true}}}' "$root/Edge Vault" > "$root/obsidian/obsidian.json"
  export OBSIDIAN_HOME="$root/obsidian"
fi
if [[ "$scenario" == "connectors" ]]; then
  # One app of each shape the catalog knows: a vault to choose (and a stale one to fail on), a
  # newsletter to address, an export to import.
  mkdir -p "$root/obsidian" "$root/Edge Vault"
  printf '# One\n\nA first lesson long enough to be worth keeping.\n' > "$root/Edge Vault/one.md"
  printf '# Two\n\nA second lesson long enough to be worth keeping.\n' > "$root/Edge Vault/two.md"
  printf '{"vaults":{"e1":{"path":"%s","ts":2,"open":true},"s1":{"path":"%s","ts":1}}}' "$root/Edge Vault" "$root/Stale Vault" > "$root/obsidian/obsidian.json"
  cp "$repo_root/tests/fixtures/exports/chatgpt/conversations.json" "$root/chatgpt.json"
  cp "$repo_root/tests/fixtures/feeds/substack.xml" "$root/substack.xml"
  cp "$repo_root/tests/fixtures/feeds/medium.xml" "$root/medium.xml"
  cp "$repo_root/tests/fixtures/feeds/rss.xml" "$root/blog.xml"
  # No Claude Code or Codex on this Mac, whatever the machine running the walk has.
  export OBSIDIAN_HOME="$root/obsidian" CLAUDE_HOME="$root/claude" CODEX_HOME="$root/codex"
  # CAP-009: Granola's server stood in for by a local one that asks no sign-in, and a keyring that
  # keeps nothing, so the owner's Keychain is never touched. The walk stops it to see the app fail.
  port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
  (cd "$repo_root" && exec uv run python tests/fixtures/granola.py "$port" >"$root/granola.log" 2>&1) &
  export LORE_EDGE_GRANOLA_PID=$! LORE_GRANOLA_SERVER="http://127.0.0.1:$port/mcp" PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring
  trap 'kill "$LORE_EDGE_GRANOLA_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$port/mcp" && break; sleep 0.5; done
fi
echo "Screenshots land in $root"
"$desktop_dir/node_modules/.bin/electron" "$desktop_dir/support/edge.cjs" "$scenario" 2>/dev/null | grep -E "^(PASS|FAIL|ERROR)"
