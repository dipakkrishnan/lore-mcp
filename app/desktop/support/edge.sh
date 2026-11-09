#!/bin/bash
# Seed a scratch Lore home with two memories and two drafts, then drive the renderer as one persona.
# Scenarios: seller | store | connectors | checkin | routines | settings | agents | firstrun
set -euo pipefail
scenario="${1:-seller}"
desktop_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$desktop_dir/../.." && pwd)"
root="$(mktemp -d "${TMPDIR:-/tmp}/lore-edge.XXXXXX")"
mkdir -p "$root/home" "$root/user-data"
export LORE_HOME="$root/home" LORE_STORE="$root/store" LORE_DESKTOP_USER_DATA="$root/user-data" LORE_SKIP_SCHEDULE=1 LORE_EDGE_OUT="$root"
# Usage events from a walk go nowhere: a closed local port, refused at once.
export LORE_USAGE_URL="http://127.0.0.1:9/events"
# Nor does a walk read the real bids board (APP-274): the look fails at once and the walk sees no matches.
export LORE_BIDS_URL="http://127.0.0.1:9/bids.json"
# APP-215: only the firstrun walk meets the first-run chat; every other walk starts past it, as an owner who skipped it.
[[ "$scenario" == "firstrun" ]] || echo '{"state":"skipped"}' > "$root/user-data/first-run.json"
# APP-225: a walk is drawn light, never as the Mac running it is set; LORE_EDGE_APPEARANCE=dark walks it dark.
echo "{\"appearance\":\"${LORE_EDGE_APPEARANCE:-light}\"}" > "$root/user-data/appearance.json"
# The connectors persona's home stays empty: a seller with no agents, whose first memories come from their apps. So
# does the agents one: an owner whose first memories are what their personal agent saves. (An empty Lore's own views
# are test/unit/renderer-empty-states.test.cjs since APP-269 retired the fresh walk.)
[[ "$scenario" == "connectors" || "$scenario" == "agents" || "$scenario" == "firstrun" ]] || (
  cd "$repo_root"
  echo '[{"title":"Hire management before rapid growth","content":"Add the management layer before the next ten engineers join, not after.","project":"team scaling"},{"title":"Price the first tier low","content":"A low first price gets the first ten buyers; raise it once there are receipts.","project":"pricing"}]' | uv run lore capture apply - >/dev/null
  echo '[{"title":"Hire management before rapid growth","teaser":"When to add managers in a fast-growing team.","content":"Add the management layer before the next ten engineers join, not after.","kind":"claim","topic":"team scaling","provenance":[1]},{"title":"Price the first tier low","teaser":"How to set a first price.","content":"A low first price gets the first ten buyers; raise it once there are receipts.","kind":"claim","topic":"pricing","provenance":[2]}]' | uv run lore publication draft - >/dev/null
)
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
 store.add_publication(title='Raise prices after the tenth buyer', content='We doubled at ten buyers and lost none.', topic='pricing', teaser='When to raise a first price', provenance=[2])
 # APP-270: one finished run, so Settings ends on its Activity section, scanned here since the jobs and sales walks went.
 store.finish_job(store.start_job('capture', timeout_minutes=60), 'succeeded', summary='captured')"
  echo '[{"publication_id":1,"sample":"We had two weeks and a deck we were proud of.","useful_if":"you are launching a developer tool","not_useful_if":"you sell through a sales team"},{"publication_id":2,"sample":"","useful_if":"you have your first paying customers","not_useful_if":""}]' | uv run lore publication extras draft - >/dev/null)
fi
if [[ "$scenario" == "routines" ]]; then
  # APP-270: Lore's own rhythm in one walk, which was three (schedule, reading, automations).
  # AUT-006: a seller with no Claude Code or Codex, whose rhythm Lore keeps. A vault connected two days
  # ago has a note written since, and Lore was closed at its reading hour each day in between. That hour is twelve
  # hours from now, so the walk never runs across it.
  mkdir -p "$root/Edge Vault"
  printf '# One\n\nA first lesson long enough to be worth keeping.\n' > "$root/Edge Vault/one.md"
  export OBSIDIAN_HOME="$root/obsidian" CLAUDE_HOME="$root/claude" CODEX_HOME="$root/codex"
  (cd "$repo_root" && uv run lore sources connect obsidian --json -- "$root/Edge Vault" >/dev/null)
  printf '# Two\n\nA second lesson, written after the vault was connected.\n' > "$root/Edge Vault/two.md"
  (cd "$repo_root" && uv run python -c "
from datetime import datetime, timedelta, timezone
from lore import automation
automation.save_profile({'executor': 'lore', 'cadence': 'daily', 'hour': (datetime.now().hour + 12) % 24})
# Only the reading is owed: it is two days old, and Lore's other routines are paused, so neither a weekly one's
# Sunday nor any hour the walk starts just short of is owed too (XC-123; tests/test_automation.py pins the clock).
# The walk turns them back on once the reading it owed has landed.
routines = automation.Routines()
for routine in routines.list():
    if routine['id'] != 'synthesis':
        routines.change(routine['id'], paused=True)
automation.Routines(clock=lambda: datetime.now(timezone.utc) - timedelta(days=2)).adopt()")
  # APP-200: the owner has one routine of their own, added now, so nothing of theirs is owed at launch.
  (cd "$repo_root" && uv run lore automation add --cadence weekly --hour 18 --day 6 -- "Every Sunday, remember what I read this week" >/dev/null)
  # APP-213: one memory Lore wrote before it kept who each came from.
  mkdir -p "$LORE_HOME/memories"
  printf '# An older lesson Lore wrote\n\nWritten before Lore kept who each memory came from, long enough to keep.\n' > "$LORE_HOME/memories/older-lesson.md"
  (cd "$repo_root" && uv run lore sync --source automation >/dev/null)
fi
if [[ "$scenario" == "checkin" ]]; then
  # AUT-008: a connected vault, and an evening check-in turned on two days ago whose hour passed an hour ago, while
  # Lore was closed. The note read in since is its one new item, and the stand-in model finds it worth asking about.
  # The check-in itself reads nothing.
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
fi
if [[ "$scenario" == "connectors" || "$scenario" == "routines" ]]; then
  # CAP-009: Granola's server stood in for by a local one that asks no sign-in, and a keyring that
  # keeps nothing, so the owner's Keychain is never touched. The connectors walk stops it to see the app fail.
  port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
  (cd "$repo_root" && exec uv run python tests/fixtures/granola.py "$port" >"$root/granola.log" 2>&1) &
  export LORE_EDGE_GRANOLA_PID=$! LORE_GRANOLA_SERVER="http://127.0.0.1:$port/mcp" PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring
  trap 'kill "$LORE_EDGE_GRANOLA_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$port/mcp" && break; sleep 0.5; done
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
# A CLI the app cancels mid-way (SIGTERM) writes its Python stack to cli-stack.log before it goes, so a connect that
# never finished says where it was (XC-111). The hook rides on PYTHONPATH, after any the scenario set.
mkdir -p "$root/pyhooks"
cat > "$root/pyhooks/sitecustomize.py" <<'PY'
import faulthandler, os, signal, sys
def _dump(signum, frame):
    with open(os.environ["LORE_CLI_STACK"], "a") as f:
        f.write(f"\n=== pid {os.getpid()} argv {sys.argv} got signal {signum}\n")
        faulthandler.dump_traceback(f, all_threads=True)
    os._exit(143)
signal.signal(signal.SIGTERM, _dump)
PY
export PYTHONPATH="$root/pyhooks${PYTHONPATH:+:$PYTHONPATH}" LORE_CLI_STACK="$root/cli-stack.log"
echo "Screenshots land in $root"
# A walk that outlives its limit fails loudly, with a sample of Electron's main process, instead of hanging the run.
limit="${LORE_EDGE_LIMIT:-180}"
# The first-run walk relaunches the app five times.
[[ "$scenario" == "firstrun" && -z "${LORE_EDGE_LIMIT:-}" ]] && limit=300
# The agents walk connects four agents, answers two sign-ins (XC-068) and waits out each save's reading (APP-233).
[[ "$scenario" == "agents" && -z "${LORE_EDGE_LIMIT:-}" ]] && limit=360
# The routines walk waits out three of the stand-in model's readings, each six seconds or more (APP-270: three walks in one).
[[ "$scenario" == "routines" && -z "${LORE_EDGE_LIMIT:-}" ]] && limit=300
# Electron's stderr is where the app says why a CLI call failed (state.cjs's `lore ... failed:` lines); it is kept
# beside the walk log and printed when the walk fails (XC-111).
"$desktop_dir/node_modules/.bin/electron" "$desktop_dir/support/edge.cjs" "$scenario" >"$root/walk.log" 2>"$root/app.log" &
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
grep -E "^(PASS|FAIL|ERROR)" "$root/walk.log" || { echo "FAIL $scenario said nothing"; code=1; }
if grep -qE "^(FAIL|ERROR)" "$root/walk.log"; then code=1; fi
if [[ -n "$timed_out" ]]; then echo "$timed_out"; code=1; fi
# A failed walk prints everything Electron said, and the head of the hang sample if it ran out of time (the main
# thread's stack is there; the whole sample runs to megabytes), so the log of a CI run whose files are gone by the
# time anyone reads it still holds what went wrong (XC-077).
if [[ "$code" != 0 ]]; then
  echo "--- $root/walk.log"
  cat "$root/walk.log"
  if [[ -s "$root/hang.txt" ]]; then echo "--- $root/hang.txt (first 120 lines)"; head -n 120 "$root/hang.txt"; fi
  # What the app and the walk's stand-in servers said, so a connect that failed can be read from CI alone.
  for said in app granola agent cli-stack; do
    if [[ -s "$root/$said.log" ]]; then echo "--- $root/$said.log (last 80 lines)"; tail -n 80 "$root/$said.log"; fi
  done
fi
exit "$code"
