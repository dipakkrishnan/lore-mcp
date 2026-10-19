#!/bin/bash
# Seed a scratch Lore home with two memories and two drafts, then drive the renderer as one persona.
# Scenarios: seller | provision | store | update | jobs | fresh | feedback | listing | obsidian | connectors | reading | schedule | checkin | quiet | automations | faq | sell | cards | sales | extras | settings | agents | today | firstrun
set -euo pipefail
scenario="${1:-seller}"
desktop_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$desktop_dir/../.." && pwd)"
root="$(mktemp -d "${TMPDIR:-/tmp}/lore-edge.XXXXXX")"
mkdir -p "$root/home" "$root/user-data"
export LORE_HOME="$root/home" LORE_STORE="$root/store" LORE_DESKTOP_USER_DATA="$root/user-data" LORE_SKIP_SCHEDULE=1 LORE_EDGE_OUT="$root"
# Usage events from a walk go nowhere: a closed local port, refused at once.
export LORE_USAGE_URL="http://127.0.0.1:9/events"
# APP-215: only the firstrun walk meets the first-run chat; every other walk starts past it, as an owner who skipped it.
[[ "$scenario" == "firstrun" ]] || echo '{"state":"skipped"}' > "$root/user-data/first-run.json"
# APP-225: a walk is drawn light, never as the Mac running it is set; LORE_EDGE_APPEARANCE=dark walks it dark.
echo "{\"appearance\":\"${LORE_EDGE_APPEARANCE:-light}\"}" > "$root/user-data/appearance.json"
# A fresh home stays empty: that persona checks what an owner sees before anything is kept. So
# does the connectors one: a seller with no agents, whose first memories come from their apps. And the agents one: an
# owner whose first memories are what their personal agent saves. And the today one, which seeds each stage itself.
[[ "$scenario" == "fresh" || "$scenario" == "connectors" || "$scenario" == "reading" || "$scenario" == "agents" || "$scenario" == "today" || "$scenario" == "firstrun" ]] || (
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
automation.save_profile({'executor': 'codex', 'cadence': 'weekly', 'hour': 21})")
  # AUT-010: the owner moved their Codex task to Sundays in Codex itself.
  mkdir -p "$root/codex/automations/lore-memory-synthesis"
  echo 'rrule = "FREQ=WEEKLY;BYDAY=SU;BYHOUR=21;BYMINUTE=0"' > "$root/codex/automations/lore-memory-synthesis/automation.toml"
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
 store.set_setting('node_selling', True)
 store.add_publication(title='Live demos beat cold decks', content='paid text', topic='launches', teaser='What beat a cold deck', provenance=[1])
 piece = store.list_publications()[0].public_id
 # APP-219: an owner with history: a run that stopped days ago at an agent's cost, and the same store update again and again.
 stale = store.start_job('capture', timeout_minutes=60)
 store.finish_job(stale, 'incomplete', title='What to Sell Today', summary='stopped', cost_usd=0.016121)
 store.db.execute('UPDATE owner_jobs SET started_at=?, finished_at=? WHERE id=?', ('2026-10-15T09:00:00+00:00', '2026-10-15T09:20:00+00:00', stale))
 store.db.commit()
 for _ in range(4):
  store.finish_job(store.start_job('push', timeout_minutes=60), 'succeeded', summary='pushed', count=13)
json.dump([{'kind': 'publication', 'item_id': piece, 'title': 'Live demos beat cold decks', 'price_usd': 3.0, 'network': 'stripe', 'payer': '', 'tx': 'pi_old', 'sold_at': '2026-10-01T12:00:00Z'}], open(f'{out}/sales.json', 'w'))
json.dump([{'item_id': piece, 'views': 42}], open(f'{out}/views.json', 'w'))
open(f'{out}/piece', 'w').write(piece)")
  # A thread that stopped days ago is history, not something to finish today.
  (cd "$desktop_dir" && node --input-type=module -e "import { readdirSync, readFileSync, writeFileSync } from 'node:fs'; import { resolve } from 'node:path'; import { SessionManager } from '@earendil-works/pi-coding-agent';
const dir = resolve(process.env.LORE_HOME, '.pi/sessions/capture');
const session = SessionManager.create(process.env.LORE_HOME, dir);
session.appendMessage({ role: 'user', content: 'OLD STOPPED CAPTURE', timestamp: 1 });
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
session.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'What did you learn?' }], api: 'anthropic-messages', provider: 'anthropic', model: 'edge', usage, stopReason: 'stop', timestamp: 2 });
session.appendCustomEntry('lore.task', { version: 1, kind: 'capture', title: 'Capture a memory', state: 'stopped', phase: 'Review the capture' });
const old = (line) => line && JSON.stringify({ ...JSON.parse(line), timestamp: '2026-10-15T09:00:00.000Z' });
for (const name of readdirSync(dir)) writeFileSync(resolve(dir, name), readFileSync(resolve(dir, name), 'utf8').split('\n').map(old).join('\n'));")
  mkdir -p "$LORE_STORE/node_modules/.bin"
  printf '#!/bin/sh\ncase "$*" in *page_views*) printf "[{\\"results\\": []}, {\\"results\\": %%s}]" "$(cat "$LORE_EDGE_OUT/views.json")";; *) printf "[{\\"results\\": %%s}]" "$(cat "$LORE_EDGE_OUT/sales.json")";; esac\n' > "$LORE_STORE/node_modules/.bin/wrangler"
  chmod +x "$LORE_STORE/node_modules/.bin/wrangler"
  : > "$LORE_STORE/.installed"
fi
if [[ "$scenario" == "listing" ]]; then
  # XC-036: a live store, a setup name, a push that always succeeds, and an empty public list.
  mkdir -p "$LORE_STORE" "$root/bin"
  echo '{}' > "$LORE_STORE/wrangler.jsonc"
  printf '#!/bin/sh\nexit 0\n' > "$root/bin/npx" && chmod +x "$root/bin/npx"
  echo '{"sellers":[]}' > "$root/marketplace.json"
  export PATH="$root/bin:$PATH" LORE_MARKETPLACE_URL="file://$root/marketplace.json"
  (cd "$repo_root" && uv run python -c "import json, time
from lore import blueprint
from lore.store import Store
with Store() as store:
 store.set_setting('node_url', 'https://store.example/mcp')
 store.set_setting('node_selling', True)
 store.set_setting('node_live', {'url': 'https://store.example/mcp', 'checked_at': time.time(), 'live': {'state': 'online', 'network': 'eip155:8453', 'price_usd': 0.01, 'payout': '0x' + 'a' * 40}, 'ids': []})
blueprint.blueprint_path().parent.mkdir(parents=True, exist_ok=True)
blueprint.blueprint_path().write_text(json.dumps({'name': 'Edge Seller'}))")
fi
if [[ "$scenario" == "store" ]]; then
  (cd "$repo_root" && uv run python -c "import time
from lore.store import Store
with Store() as store:
 store.set_setting('node_url', 'https://store.example/mcp')
 store.set_setting('node_selling', True)
 store.set_setting('node_live', {'url': 'https://store.example/mcp', 'checked_at': time.time(), 'live': {'state': 'online', 'network': 'eip155:84532', 'price_usd': 0.02, 'payout': '0x' + 'a' * 40}, 'ids': []})")
  (cd "$desktop_dir" && node --input-type=module -e "import { resolve } from 'node:path'; import { SessionManager } from '@earendil-works/pi-coding-agent';
const session = SessionManager.create(process.env.LORE_HOME, resolve(process.env.LORE_HOME, '.pi/sessions/deploy'));
session.appendMessage({ role: 'user', content: 'OLD COMPLETED DEPLOY', timestamp: 1 });
session.appendCustomEntry('lore.task', { version: 1, kind: 'deploy', title: 'Open your store', state: 'done', phase: 'Finished' });")
fi
if [[ "$scenario" == "update" ]]; then
  # APP-231: a store this Mac put online for sale before Lore kept which store it was: only its payout record says so.
  (cd "$repo_root" && uv run python -c "import time
from lore.store import Store
with Store() as store:
 store.set_setting('node_url', 'https://store.example/mcp')
 store.set_setting('node_selling', True)
 store.set_setting('node_live', {'url': 'https://store.example/mcp', 'checked_at': time.time() + 3600, 'live': {'state': 'online', 'network': 'eip155:84532', 'price_usd': None, 'payout': '0x' + 'a' * 40}, 'ids': []})")
  mkdir -p "$LORE_STORE"
  echo "{\"address\": \"0x$(printf 'a%.0s' {1..40})\", \"network\": \"test\"}" > "$LORE_STORE/payout.json"
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
  # pieces already for sale with new free parts waiting, one with a sample and one without. The store's update,
  # once confirmed, goes to a stand-in that always succeeds, never to Cloudflare.
  mkdir -p "$LORE_STORE" "$root/bin"
  echo '{}' > "$LORE_STORE/wrangler.jsonc"
  printf '#!/bin/sh\nexit 0\n' > "$root/bin/npx" && chmod +x "$root/bin/npx"
  export PATH="$root/bin:$PATH"
  echo '{"sellers":[{"node":"https://lore-edge.example.workers.dev/mcp"}]}' > "$root/marketplace.json"
  export LORE_MARKETPLACE_URL="file://$root/marketplace.json"
  (cd "$repo_root" && uv run python -c "import time
from lore.store import Store
with Store() as store:
 store.set_setting('node_url', 'https://lore-edge.example.workers.dev/mcp')
 store.set_setting('node_selling', True)
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
if [[ "$scenario" == "schedule" ]]; then
  # AUT-006: a seller with no Claude Code or Codex, whose rhythm Lore keeps. A vault connected two days
  # ago has a note written since, and Lore was closed at every 9 AM in between.
  mkdir -p "$root/Edge Vault"
  printf '# One\n\nA first lesson long enough to be worth keeping.\n' > "$root/Edge Vault/one.md"
  export OBSIDIAN_HOME="$root/obsidian" CLAUDE_HOME="$root/claude" CODEX_HOME="$root/codex"
  (cd "$repo_root" && uv run lore sources connect obsidian --json -- "$root/Edge Vault" >/dev/null)
  printf '# Two\n\nA second lesson, written after the vault was connected.\n' > "$root/Edge Vault/two.md"
  (cd "$repo_root" && uv run python -c "
from datetime import datetime, timedelta, timezone
from lore import automation
automation.save_profile({'executor': 'lore', 'cadence': 'daily', 'hour': 9})
automation.Routines(clock=lambda: datetime.now(timezone.utc) - timedelta(days=2)).adopt()")
fi
if [[ "$scenario" == "automations" ]]; then
  # APP-200: Lore keeps the reading rhythm, and the owner has one routine of their own.
  export CLAUDE_HOME="$root/claude" CODEX_HOME="$root/codex"
  (cd "$repo_root" && echo '{"executor": "lore", "cadence": "daily", "hour": 9}' | uv run lore profile - >/dev/null)
  (cd "$repo_root" && uv run lore automation add --cadence weekly --hour 18 --day 6 -- "Every Sunday, remember what I read this week" >/dev/null)
fi
if [[ "$scenario" == "checkin" || "$scenario" == "quiet" ]]; then
  # AUT-008: a connected vault, and an evening check-in turned on two days ago whose hour passed an hour ago, while
  # Lore was closed. The note read in since is its one new item; the stand-in model either finds it worth asking
  # about (checkin) or not (quiet). The check-in itself reads nothing.
  mkdir -p "$root/Edge Vault"
  printf '# One\n\nA first lesson long enough to be worth keeping.\n' > "$root/Edge Vault/one.md"
  export CLAUDE_HOME="$root/claude" CODEX_HOME="$root/codex"
  (cd "$repo_root" && uv run lore sources connect obsidian --json -- "$root/Edge Vault" >/dev/null)
  (cd "$repo_root" && uv run python -c "
from datetime import datetime, timedelta, timezone
from lore import automation
now = datetime.now(timezone.utc)
automation.Routines(clock=lambda: now - timedelta(days=2)).change('checkin', paused=False, cadence='daily', hour=(now - timedelta(hours=1)).astimezone().hour)")
  printf '# Pushed back on the Acme pricing call\n\nHeld the price; no reason written down.\n' > "$root/Edge Vault/two.md"
  (cd "$repo_root" && uv run lore sources read >/dev/null)
fi
if [[ "$scenario" == "connectors" || "$scenario" == "reading" ]]; then
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
if [[ "$scenario" == "today" ]]; then
  # APP-214: an empty home, no Claude Code or Codex, and a vault to connect at the last stage.
  mkdir -p "$root/Edge Vault"
  printf '# One\n\nA first lesson long enough to be worth keeping.\n' > "$root/Edge Vault/one.md"
  export CLAUDE_HOME="$root/claude" CODEX_HOME="$root/codex" OBSIDIAN_HOME="$root/obsidian"
fi
if [[ "$scenario" == "reading" ]]; then
  # APP-213: one memory Lore wrote before it kept who each came from.
  mkdir -p "$LORE_HOME/memories"
  printf '# An older lesson Lore wrote\n\nWritten before Lore kept who each memory came from, long enough to keep.\n' > "$LORE_HOME/memories/older-lesson.md"
  (cd "$repo_root" && uv run lore sync --source automation >/dev/null)
fi
if [[ "$scenario" == "firstrun" ]]; then
  # APP-215: a new owner with one Obsidian vault on this Mac; the rest is the agents walk's stand-in node and Claude Code.
  mkdir -p "$root/obsidian" "$root/Edge Vault"
  printf '# One\n\nA first lesson long enough to be worth keeping.\n' > "$root/Edge Vault/one.md"
  printf '{"vaults":{"e1":{"path":"%s","ts":1,"open":true}}}' "$root/Edge Vault" > "$root/obsidian/obsidian.json"
fi
if [[ "$scenario" == "agents" || "$scenario" == "firstrun" ]]; then
  # APP-207: the owner's node stood in for by tests/fixtures/inbox.py: its D1 a SQLite file, its /agent a local server,
  # and a keyring kept in a file, so the owner's Keychain is never touched. No store is online yet: the walk puts it
  # online through a stand-in deploy, which leaves the node's wrangler (the fixture's) and its address behind.
  export CLAUDE_HOME="$root/claude" CODEX_HOME="$root/codex" OBSIDIAN_HOME="$root/obsidian"
  # Claude Code is on this Mac, with one project's memory notes, and not yet connected.
  mkdir -p "$root/claude/projects/demo/memory"
  printf '# Ship the smallest change that proves it\n\nOne working path beats three half-built ones; cut scope until the first user can finish.\n' > "$root/claude/projects/demo/memory/scope.md"
  export LORE_EDGE_D1="$root/d1.sqlite" LORE_EDGE_KEYRING="$root/keyring.json" LORE_EDGE_REPO="$repo_root"
  export PYTHONPATH="$repo_root" PYTHON_KEYRING_BACKEND=tests.fixtures.inbox.Keyring
  port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
  (cd "$repo_root" && exec uv run python -m tests.fixtures.inbox serve --port "$port" >"$root/agent.log" 2>&1) &
  export LORE_EDGE_AGENT_PID=$! LORE_EDGE_AGENT_URL="http://127.0.0.1:$port"
  trap 'kill "$LORE_EDGE_AGENT_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do curl -s -o /dev/null "$LORE_EDGE_AGENT_URL/agent" && break; sleep 0.5; done
fi
echo "Screenshots land in $root"
# A walk that outlives its limit fails loudly, with a sample of Electron's main process, instead of hanging the run.
limit="${LORE_EDGE_LIMIT:-180}"
# The first-run walk relaunches the app five times.
[[ "$scenario" == "firstrun" && -z "${LORE_EDGE_LIMIT:-}" ]] && limit=300
"$desktop_dir/node_modules/.bin/electron" "$desktop_dir/support/edge.cjs" "$scenario" >"$root/walk.log" 2>/dev/null &
walk=$!
for _ in $(seq 1 "$limit"); do kill -0 "$walk" 2>/dev/null || break; sleep 1; done
timed_out=""
if kill -0 "$walk" 2>/dev/null; then
  main="$(pgrep -P "$walk" | head -1 || true)"
  [[ -n "$main" ]] && sample "$main" 3 -file "$root/hang.txt" >/dev/null 2>&1 || true
  [[ -n "$main" ]] && kill -9 "$main" 2>/dev/null || true
  kill -9 "$walk" 2>/dev/null || true
  timed_out="FAIL $scenario timed out (sample at $root/hang.txt)"
fi
# Fails on a walk that exits non-zero, says FAIL or ERROR, says nothing at all, or runs out of time.
code=0
wait "$walk" 2>/dev/null || code=$?
grep -E "^(PASS|FAIL|ERROR)" "$root/walk.log" || code=1
if grep -qE "^(FAIL|ERROR)" "$root/walk.log"; then code=1; fi
if [[ -n "$timed_out" ]]; then echo "$timed_out"; code=1; fi
exit "$code"
