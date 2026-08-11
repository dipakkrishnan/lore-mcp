# Lore MCP

**Portable, private, monetizable context for personal agents.**

Lore MCP is a local-first memory layer that lets any personal agent build a durable understanding of its owner—and lets the owner decide when other agents may pay to query that understanding.

> Your agents build your lore. You decide who can access it.

## Install

Lore uses Python 3.10+, SQLite, Git, and [uv](https://docs.astral.sh/uv/). Inspect
[`install.sh`](./install.sh), then install the current release:

```sh
curl -fsSL https://raw.githubusercontent.com/dipakkrishnan/lore-mcp/v0.1.0/install.sh | sh
```

The installer places Lore under `~/.local/share/lore`, links the `lore` command
into `~/.local/bin`, and starts the guided setup. It never reads conversation
transcripts during initial import.

```sh
lore help                     # show the end-user workflow
lore setup                    # import native memory; then onboard with an agent
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

Native memory is deliberately selective, so Lore asks one agent to revisit remembered
and owner-approved context and synthesize durable judgments:

After `lore setup`, tell Claude or Codex **“Onboard me to Lore.”** The installed skill
drafts your profile from agent history, asks you to correct it, and configures one
synthesis executor, cadence, and optional model. Codex and Claude memories remain
independent input sources; the selected executor writes topic-based memories plus an
`INDEX.md` semantic index. Its first run analyzes useful history and can delegate a
large cold-start corpus to subagents.

Codex uses its local automation definition. Claude uses a macOS LaunchAgent that first
runs `lore sync`, then invokes `claude -p` with the saved prompt and narrow permissions.
Remote Claude routines cannot read local memory files. Keep the Mac awake when a local
Claude task is due.

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

The `lore-onboard` skill (`plugins/lore/skills/lore-onboard/SKILL.md`) runs the whole first-time setup
as one conversation inside a Claude or Codex session, in two phases:

1. **Persona interview → blueprint.** Pick an archetype — Storyteller, elementary
   schoolteacher, college professor, business executive, or wise sage — and it seeds how
   your lore is organized (chronological, by theme, by project, or by knowledge), how deep
   it goes, and how you like to tell it. Captured with `lore blueprint apply`; view it any
   time with `lore blueprint show`.
2. **Profile → automation.** The skill then reads your existing agent memory, drafts a
   synthesis profile you correct rather than authoring from blank prompts, installs the
   recurring synthesis task, and lets its first run process useful history. The blueprint
   from phase 1 steers where it reads deeply. Captured with `lore profile`.

When you are ready to charge for publications, the `lore-enable-payments` skill
(`plugins/lore/skills/lore-enable-payments/SKILL.md`) walks you from a self-custody payout address
to a deployed node and a proven test-network payment — with free as a first-class
place to stop.

The blueprint (shape) and the profile (what steers synthesis) stay separate artifacts. See
`docs/gamified-onboarding.md` for the persona design.

## Backlog

Planned and in-flight work on Lore itself is tracked as a git-versioned backlog under
`docs/backlog/`, organized by component with per-item metadata (priority, effort, status,
blockers). See `docs/backlog/README.md` for the schema and how to manage it.

## The idea

People are beginning to use agents across coding, research, communication, planning, and everyday life. Those agents encounter valuable context: preferences, relationships, decisions, project histories, failed approaches, hard-won know-how, and the reasons behind past choices.

Today that context is fragmented across tools or disappears at the end of a session. Lore MCP gives agents one owner-controlled place to preserve and retrieve it.

The memory is useful privately first. Some of it may also be valuable to someone else's agent. When it is, the owner can sell a bounded, approved publication through MCP rather than sharing the underlying library.

```text
agent activity
      ↓
raw memories
      ↓
consolidated lore
      ↓
private recall or permissioned paid publications
```

## Why “lore”?

Memory is what was stored. Lore is the context assembled from it:

- what happened;
- how something evolved;
- who was involved;
- why a decision was made;
- what failed and under which conditions;
- what is informally understood but absent from official records.

“What’s the lore there?” is already a natural way to ask for the history and context behind something. Lore MCP makes that question addressable by agents.

## Principles

### Local first

Raw sources and private memory stay on infrastructure controlled by the owner. A paid caller receives one approved publication, not library access.

### Agent agnostic

Lore should accrue independently of whichever personal agent wins. Codex, Claude Code, Pi, Hermes, and future agents should be able to read and write the same memory through MCP and portable skills.

### Useful before monetized

The owner should benefit from better continuity, recall, and personalization even if nobody ever purchases a publication.

### Human-owned policy

Agents may propose memories, consolidate them, and draft publications. Only the
owner may approve a publication, and only publications are externally readable.

### Bounded publications, not raw access

The commercial unit is one bounded publication explicitly approved by the owner. Raw notes, conversations, and documents are not exposed by default.

### Existing payment rails

Lore MCP does not build a payments network. Payment negotiation, verification,
metering, and settlement belong to whatever gateway sits in front of the HTTP
route. Lore's own responsibility stops at deciding what may be disclosed.

## How it works

### 1. Accumulate

Personal agents write observations, preferences, episodes, decisions, and provenance into a local staging area.

### 2. Consolidate

A context-janitor skill periodically turns noisy activity into durable lore, resolving duplication and preserving links to supporting sources.

### 3. Govern

Memories are private. Disclosure is a separate, explicit act: the owner approves
a bounded publication, which is the only thing an external caller can reach.

### 4. Advertise

The node publishes a coarse capability manifest—topics, recency, kinds of experience, and disclosure limits—without publishing the underlying memory or a searchable private index.

### 5. Discover

Discovery happens at two levels:

1. Agent and plugin marketplaces help a buyer find potentially relevant Lore MCP endpoints.
2. A free `discover` call returns a node's full catalog — owner-approved teasers grouped by topic, with ids, freshness, and price. The buying agent reads it and decides what is worth fetching; there is no server-side search to guess vocabulary against.

### 6. Fetch and settle

A buyer calls `get` with a publication id chosen from the catalog. If payment is required, the gateway in front of the route
answers with the price and payment requirements; the buyer authorizes and retries.
After verification, the node returns that owner-approved publication.

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

## Initial MCP surface

The public surface has two tools:

- `discover()` — free; returns the full catalog of owner-approved teasers.
- `get(id)` — paid when policy requires it; returns exactly one publication.

A buyer may choose zero, one, multiple, or every advertised id, calling `get`
once per selection. Publication ids contain a checksum: a damaged copy is
rejected before payment. Use ids from a current catalog; a publication revoked
between `discover` and `get` can still be billed because settlement precedes lookup.

Private owner-facing operations such as remembering, forgetting, consolidating, reviewing, and changing policy can be added only as the local memory implementation requires them.

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

## Monetization

Each `get` buys one publication at the fixed price shown by `discover`. A buyer
may choose any subset of the catalog, including all of it, and pays separately
for each selection. Damaged ids fail validation before payment. Per-publication
pricing or bundles can be added if one fixed price becomes a measured constraint.

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

A gateway can enforce access and verify payment at the edge; it does not decide
what private context is safe to release. Lore MCP must enforce that boundary
locally.

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

Convention today, in the drafting skills rather than validators: explicit
handling of third-party and confidential information.

Not yet implemented: per-buyer and per-topic limits, protection against
repeated queries that reconstruct private material, pre-retrieval and
post-generation policy checks, and an owner-visible audit log.

## First version

The smallest useful prototype is:

1. a local memory store;
2. one context-janitor skill usable by multiple agents;
3. a capability manifest;
4. `discover` and `get` MCP tools;
5. a payment boundary — shipped as the x402 Worker deployed by `lore node deploy`;
6. a simple disclosure policy and audit trail.

It does not need a new personal agent, hosted raw-memory service, proprietary payment rail, or standalone marketplace. Existing agent marketplaces can provide initial distribution while the protocol proves that agents will pay for useful personal context.

## The bet

Personal agents will become more valuable as they accumulate context. That context belongs to the person who generated it. If another agent benefits from querying it, the owner should be able to grant controlled access and receive payment without surrendering the underlying library.

Lore MCP is the connective layer between personal memory, agent discovery, owner-controlled disclosure, and machine-native payment.

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

CI (`.github/workflows/tests.yml`) reports six separate checks: Python lint,
Python unit tests, Node lint, Node compiler checks, Node component tests, and
the Worker smoke test. Each runs the same local command against a placeholder
wallet where the Worker requires one, so failures are immediately attributable
to a single stage. CI does not currently run `tests/gate.py`'s coverage floor
or the `tests/node/` unit tests below — see the gate section for what that
means in practice.

### The gate

`tests/gate.py` is the single command that has to pass locally before either
side of the repo is trusted. It covers both languages and exits non-zero if
either does.

**Python (`lore/`)** — runs the suite under coverage and fails if **any** file
falls below 90% on statement coverage *or* branch coverage. That per-file,
per-metric check is the point: coverage.py's `fail_under` (kept in
`pyproject.toml` as a cheap outer guard) only sees one global combined number,
behind which a file at 96% statements and 70% branches hides. Coverage measures
`lore/` only; test code never counts toward the percentage. CI's Python unit
job runs the suite but not under this coverage floor — an uncovered regression
in `lore/` currently only fails locally, not in CI.

**Worker (`lore/node/`)** — type-checks it (`tsc --noEmit`), bundles it
(`wrangler deploy --dry-run`, so a break shows up here rather than halfway
through someone's `lore node deploy`), and runs the unit tests in `tests/node/`
(below). There is no coverage floor on the Worker; see `docs/backlog/` XC-013
for what its own test suite (in `lore/node/test/`, run by CI as "Node component
tests") does and does not cover.

The Worker checks need dependencies installed:

```sh
npm --prefix lore/node install && npm --prefix tests/node install
```

Without them the gate reports the Worker section as SKIPPED and still passes, so
a Python-only change never requires a Node toolchain. `--require-node` turns
that skip into a failure; nothing in CI passes that flag today.

### Test layout

`tests/` holds one file per module in `lore/`, named after it, plus
`tests/test_skill_contract.py` (which pins `skills/` and the README against the
real parser) and `tests/helpers.py` for the shared fixtures. Each file passes on
its own, so a failure names its owning component.

`tests/node/` holds unit tests over two of the Worker's leaf modules —
`src/price.ts` (the dollars→USDC-base-units conversion) and `src/wallet.ts`
(the fail-closed payout guard) — and is deliberately its own npm package rather
than a folder inside `lore/node/`: `lore/node/package.json` ships inside the
wheel and every dependency listed there gets installed on an owner's machine by
`lore node deploy`. They run in workerd via `@cloudflare/vitest-pool-workers`,
same as `lore/node/test/`'s own component suite (which exercises the Worker's
actual request path end to end against a mocked facilitator — see MON-010 —
rather than these two modules in isolation).

Python tests are `unittest.TestCase`-based and pytest collects them as-is, so
`python -m unittest discover -s tests` still works if you prefer it.

The implementation uses only the Python standard library: `argparse`, `sqlite3`,
`subprocess`, and `http.server`. There is no application framework, vector
database, or MCP SDK to install. `pytest` and `coverage` are dev-only
dependencies in the `dev` group, which `uv run` includes by default; `ruff` is
a separate `dev` extra, which `uv run` only picks up with `--extra dev`.

## Status

The local CLI, agent-memory import, FTS5 search, review flow, assisted synthesis,
basic stdio/HTTP MCP server, x402 payment enforcement (the Worker deployed by
`lore node deploy` — Base Sepolia by default, Base mainnet behind an explicit
opt-in secret), and publications serving from the deployed node (`lore push`)
are implemented; real purchases have settled on Base mainnet. Repeated-query
extraction protection, remote identity, and marketplace discovery remain
future work.

## Related infrastructure

- [Model Context Protocol](https://modelcontextprotocol.io/)
