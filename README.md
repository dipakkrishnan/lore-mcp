# Lore MCP

**Private memory for personal agents, with optional paid sharing.**

Lore keeps agent memory on your computer. You can use it privately, or approve
specific publications for other agents to buy. Your private library is never
exposed to buyers.

## Install

Installed the Lore plugin first? Tell the agent **“Onboard me to Lore.”** It will
explain the local runtime, ask permission, install it, and verify it for you.

For a standalone install, inspect [`install.sh`](./install.sh), then run the current
release:

```sh
curl -fsSL https://raw.githubusercontent.com/dipakkrishnan/lore-mcp/v0.1.0/install.sh | sh
```

The installer bootstraps [uv](https://docs.astral.sh/uv/) and a compatible Python when
needed, places Lore under `~/.local/share/lore`, links the `lore` command into
`~/.local/bin`, and starts the guided setup. It never reads conversation transcripts
during initial import.

```sh
lore help                     # show the end-user workflow
lore setup                    # import native memory; then onboard with an agent
lore onboarding               # how far onboarding got, and the next step
lore sync                     # import new or changed memory files
lore capture apply -          # validated private write path used by capture agents
lore review                   # keep private / discard
lore review launch --status private  # revisit a prior decision
lore search "failed launch"   # SQLite full-text recall
lore price 0.50               # advertise a fixed per-publication price
lore status
lore node deploy --wallet 0x… # deploy at the configured price; rerun after price changes
lore blueprint show            # see the shape of your lore, once captured
```

### Agent plugins

The installer already copies Lore's owner-facing skills into Claude and Codex. To
install the same workflows as a marketplace plugin instead, install Lore with the
command above, then add this repository's marketplace.

Claude Code:

```text
/plugin marketplace add dipakkrishnan/lore-mcp
/plugin install lore@lore-marketplace
/reload-plugins
```

Codex CLI:

```sh
codex plugin marketplace add dipakkrishnan/lore-mcp
codex plugin add lore@lore-marketplace
```

Restart the Codex app to browse Lore in its Plugins directory, or start a new
Claude or Codex session after installation. The plugin packages only the four
owner workflows; repository-maintenance skills are not included. The `lore`
command remains the local, owner-controlled runtime.

Set `LORE_HOME` to use a location other than `~/.lore`. Lore also respects
`CODEX_HOME` and `CLAUDE_HOME` when discovering agent data.

## Agent-assisted synthesis

After `lore setup`, tell Claude or Codex **“Onboard me to Lore.”** The installed
skill drafts a profile from your agent history, asks you to correct it, and sets
up recurring synthesis. The selected agent turns imported memories into topic
files and an `INDEX.md` index.

Codex uses its local automation definition. Claude uses a macOS LaunchAgent that first
runs `lore sync`, then invokes `claude -p` with the saved prompt and narrow permissions.
Remote Claude routines cannot read local files. Keep the Mac awake when a local
Claude task is scheduled.

## Personal content capture

Tell Claude or Codex **"Capture this in Lore"**, then dictate, paste, point it at
a local file, or drag in a PDF or image. The host agent reads the material and
the `lore-capture` skill proposes bounded memories with private source
references, lets you correct them, and saves only what you approve. Lore does
not keep a copy of the file itself — only the memory text you approve, which
may quote from it. It may then offer to draft a publication, but
publishing remains a separate review and approval step.
The validated `lore capture apply -` command owns local writes; the skill never
edits SQLite directly or sends private captures to the paid MCP surface.

## Guided onboarding

The `lore-onboard` skill runs first-time setup in a Claude or Codex session:

1. Choose how you want Lore organized and how much detail it should keep. This
   becomes your blueprint; view it with `lore blueprint show`.
2. Correct the suggested synthesis profile, then choose the agent and schedule
   for recurring synthesis.

When you are ready to charge for publications, the `lore-enable-payments` skill
walks you through setting a payout address, deploying a node, and testing a
payment. You can stop before enabling payments.

The blueprint controls the shape of your library. The profile controls what the
synthesis task looks for.

Onboarding spans a CLI import, an agent conversation, and a scheduler, so it is built to
be interrupted. `lore onboarding` reports each step from the artifact that proves it done
and names the one command that moves you forward; `lore status` carries the short version.
The skill records answers as they are given with `lore onboarding save`, so a session that
dies mid-interview resumes instead of restarting.

## Backlog

Planned and in-flight work on Lore itself is tracked as a git-versioned backlog under
`docs/backlog/`, organized by component with per-item metadata (priority, effort, status,
blockers). See `docs/backlog/README.md` for the schema and how to manage it.

## How it works

1. `lore sync` imports supported agent memories into a local SQLite database.
2. A scheduled agent turns useful imports into topic-based memory files.
3. You review memories and decide what stays private or is discarded.
4. An agent may draft a publication, but only you can approve it.
5. A deployed node lists approved publications and accepts payment for them.

Lore remains useful as a private memory library even if you never publish or
charge for anything.

```text
buyer task
    ↓
marketplace search
    ↓
discover() ───────→ full catalog of approved teasers
    ↓
choose zero, one, multiple, or all ids
    ↓
get(id) ──────────→ price quote for one publication
    ↓                       ↓
local retrieval ←── verified payment
    ↓
owner-approved publication
```

## Public MCP surface

The public surface has two tools:

- `discover()` — free; returns the full catalog of owner-approved teasers.
- `get(id)` — paid when policy requires it; returns exactly one publication.

A buyer may choose zero, one, multiple, or every advertised id, calling `get`
once per selection. Publication ids contain a checksum: a damaged copy is
rejected before payment. Use ids from a current catalog; a publication revoked
between `discover` and `get` can still be billed because settlement precedes lookup.

### Run the MCP server

The implemented server exposes those two tools using MCP protocol version
`2025-11-25`:

```sh
# Local agent configuration (newline-delimited stdio)
lore serve

# Stateless Streamable HTTP for local agents that prefer it
lore serve --transport http --host 127.0.0.1 --port 8765
```

Register the local server with either supported agent:

```sh
codex mcp add lore -- lore serve
claude mcp add --scope user lore -- lore serve
```

`discover` returns only owner-approved advertisement fields. `get` reads only
active publications the owner explicitly approved; no memory is reachable over MCP,
whatever its status. HTTP binds to loopback by default. Binding another interface requires
`--token` or `LORE_MCP_TOKEN`.

The paid deployment boundary is a Cloudflare Worker in the owner's own
account, deployed with `lore node deploy`:

```text
buyer agent → owner's Worker (x402 payment gate) → owner-approved content
```

The Worker source ships inside this package (`lore/node/`), so deploying never
needs this repository. Lore owns local retrieval and disclosure policy; the
Worker owns the payment exchange, verification, and settlement, and the
owner's machine only ever pushes approved publications outward — no tunnel, no
inbound path to the private library. The deployed node serves only the
owner-approved publications `lore push` maintains in its edge database.

## Buying from a node

Buying needs no Lore install and no Coinbase/CDP account — CDP is the
seller's settlement facilitator, not the buyer's. A buyer runs
[`bridge/`](bridge/README.md), a local MCP server that fronts the seller's
node and holds the paying key; the agent sees `discover` and `get` as
ordinary tools and payment happens between them. Clone this repository, then:

```sh
npm --prefix bridge install

# Claude Code
claude mcp add lore-buyer -- npm --prefix /path/to/lore-mcp/bridge run start -- --node https://<host>/mcp --network eip155:8453 --max-usd 0.05

# Codex CLI
codex mcp add lore-buyer -- npm --prefix /path/to/lore-mcp/bridge run start -- --node https://<host>/mcp --network eip155:8453 --max-usd 0.05
```

Match `--network` to the node (`discover` reports it; `eip155:84532` is Base
Sepolia for test nodes). On first run the bridge self-provisions a throwaway
signing key at `~/.x402-bridge/key.env` and logs its address — fund that
address with USDC on the node's network, only ever with what you are willing
to spend. The bridge refuses any charge off its configured network or beyond
`--max-usd`.

## Privacy boundary

Enforced in code today:

- only owner-approved, active publications ever reach the edge — `lore push`
  exports `publications WHERE active=1` and nothing else, so private memory
  cannot be served by construction;
- approval requires an attended interactive session (a TTY gate agents
  cannot drive), and every publication must cite the real private memories
  it derives from — provenance buyers never see;
- revocation takes effect locally at once and is pushed to the edge, with a
  persistent `lore status` reminder if the push fails;
- the free surface advertises only owner-approved teasers, topics, and
  day-truncated freshness.

Drafting skills ask agents to handle third-party and confidential information,
but this is guidance rather than a code-level validator.

Not yet implemented: per-buyer and per-topic limits, protection against
repeated queries that reconstruct private material, pre-retrieval and
post-generation policy checks, and an owner-visible audit log.

## Local data

```text
~/.lore/
├── lore.db                 # SQLite records and FTS5 index
├── automation/
│   ├── profile.json        # owner-provided synthesis guidance
│   └── synthesis-prompt.md # shared prompt run by the selected executor
├── memories/
│   ├── INDEX.md            # semantic index
│   └── <topic>.md          # synthesized topic memory
├── node/                   # deployable Worker source staged by `lore node deploy`
│   └── .buyer.env          # test-buyer key, self-provisioned by `npm run pay`, never overwritten
└── blueprint/
    ├── blueprint.json      # captured shape of your lore (persona, axis, topics)
    └── lore-map.md         # human-readable rendering of the blueprint
```

Source memory remains in the agent's directory. Lore stores its imported copy,
review state, and source path locally. Updating a source file refreshes the
indexed text without resetting the owner's disclosure decision.

## Development

```sh
uv sync --extra dev
uv run --extra dev ruff check lore tests
uv run --extra dev ruff format --check lore tests
uv run --extra dev mypy lore
uv run pytest                     # the Python suite
uv run pytest tests/test_cli.py   # one module's tests, in isolation
uv run python tests/gate.py       # every check, with the coverage floor enforced
uv run lore --help
```

`uv.lock` is committed, so contributors and CI resolve the same project setup.
The curl installer remains independent of `uv` for end users.

The Worker in `lore/node/` has its own checks, run from that directory:

```sh
cp .dev.vars.example .dev.vars   # set LORE_WALLET to any valid address
npm ci
npm run lint
npm run types && npm run check
npm test                         # Workerd component tests with a mocked facilitator
npm run dev                      # MCP at http://localhost:8787/mcp
npm run smoke                    # free discover + unpaid x402 challenge
```

CI runs Python and Node lint, tests, compiler checks, and the Worker smoke test.
It does not currently run the local coverage floor or `tests/node/`.

Evaluate the configured proxy against approved local publications without a
payment or deployment:

```sh
./lore-test.sh "What would you advise here?"   # uses ANTHROPIC_API_KEY from your environment
```

The evaluator uses the production Pi agent inside workerd and a temporary D1
database, prints its answer, citations, token cost, and duration, then deletes
the temporary state. The model call is real and incurs provider charges.

### The gate

`tests/gate.py` runs the Python suite with a 90% per-file statement and branch
coverage floor. It also type-checks, bundles, and tests the Worker.

The Worker checks need dependencies installed:

```sh
npm --prefix lore/node install && npm --prefix tests/node install
```

Without the Node dependencies, the Worker part is skipped. Pass
`--require-node` to make missing dependencies a failure.

## Status

The local CLI, memory import, search, review, synthesis, MCP server, publication
flow, and x402 payments are implemented. Test deployments use Base Sepolia;
Base mainnet requires an explicit opt-in. Repeated-query protection, remote
identity, and marketplace discovery are not yet implemented.

## Related infrastructure

- [Model Context Protocol](https://modelcontextprotocol.io/)
