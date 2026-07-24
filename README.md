# Lore MCP

**Portable, private, monetizable context for personal agents.**

Lore MCP is a local-first memory layer that lets any personal agent build a durable understanding of its owner—and lets the owner decide when other agents may pay to query that understanding.

> Your agents build your lore. You decide who can access it.

## Install

Lore has no runtime dependencies beyond Python 3.10+ and SQLite (included with
Python). Inspect [`install.sh`](./install.sh), then install the current release:

```sh
curl -fsSL https://raw.githubusercontent.com/dipakkrishnan/lore-mcp/main/install.sh | sh
```

The installer places Lore under `~/.local/share/lore`, links the `lore` command
into `~/.local/bin`, and starts the guided setup. It never reads conversation
transcripts during initial import.

```sh
lore help                     # show the end-user workflow
lore setup                    # import memory and configure synthesis
lore sync                     # import new or changed memory files
lore review                   # private / external / discard
lore review launch --status private  # revisit a prior decision
lore search "failed launch"   # SQLite full-text recall
lore price 0.50               # advertise a fixed answer price
lore status
lore blueprint show            # see the shape of your lore, once captured
```

Set `LORE_HOME` to use a location other than `~/.lore`. Lore also respects
`CODEX_HOME` and `CLAUDE_HOME` when discovering agent data.

## Agent-assisted synthesis

Native memory is deliberately selective, so Lore can ask each agent to revisit
its remembered and owner-approved context and synthesize durable judgments:

```sh
lore setup
```

Setup asks about your work, valuable experience, preferences, retention boundaries,
agents, cadence, and optional model choices. It writes agent-specific prompts under
`~/.lore/automation/`, then messages each installed agent headlessly. The agent creates
or updates its native scheduled task, verifies it exists, and exits. This is a one-time
setup call; Lore does not stay resident or own the recurring schedule.

Use a local Scheduled task in the Codex desktop app or a **Local** task under
Claude Desktop's Routines. Once installed, the native scheduler owns execution,
permissions, run history, and retries. Each run uses the agent's native memory,
writes a Markdown candidate under `~/.lore/memories/<agent>/`, and imports it as
pending context. Lore does not use agent CLIs as recurring runners, install cron jobs,
or edit either agent's native memory.

Remote Claude routines cannot read local memory files, so choose **Local** for this
workflow. Keep the machine and desktop app running when a local task is due.

## Guided onboarding

The `lore-onboard` skill (`skills/lore-onboard/SKILL.md`) runs the whole first-time setup
as one conversation inside a Claude or Codex session, in two phases:

1. **Persona interview → blueprint.** Pick an archetype — Storyteller, elementary
   schoolteacher, college professor, business executive, or wise sage — and it seeds how
   your lore is organized (chronological, by theme, by project, or by knowledge), how deep
   it goes, and how you like to tell it. Captured with `lore blueprint apply`; view it any
   time with `lore blueprint show`.
2. **Profile → automation.** The skill then reads your existing agent memory, drafts a
   synthesis profile you correct rather than authoring from blank prompts, installs the
   recurring synthesis task, and backfills past sessions. The blueprint from phase 1 steers
   where it reads deeply. Captured with `lore profile`.

The blueprint (shape) and the profile (what steers synthesis) stay separate artifacts. See
`docs/gamified-onboarding.md` for the persona design.

## The idea

People are beginning to use agents across coding, research, communication, planning, and everyday life. Those agents encounter valuable context: preferences, relationships, decisions, project histories, failed approaches, hard-won know-how, and the reasons behind past choices.

Today that context is fragmented across tools or disappears at the end of a session. Lore MCP gives agents one owner-controlled place to preserve and retrieve it.

The memory is useful privately first. Some of it may also be valuable to someone else's agent. When it is, the owner can expose a policy-filtered answer through a paid MCP call rather than sharing the underlying library.

```text
agent activity
      ↓
raw memories
      ↓
consolidated lore
      ↓
private recall or permissioned paid answers
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

Raw sources and private memory stay on infrastructure controlled by the owner. A paid caller receives an approved answer, not library access.

### Agent agnostic

Lore should accrue independently of whichever personal agent wins. Codex, Claude Code, Pi, Hermes, and future agents should be able to read and write the same memory through MCP and portable skills.

### Useful before monetized

The owner should benefit from better continuity, recall, and personalization even if nobody ever purchases an answer.

### Human-owned policy

Agents may propose memories, consolidate them, and classify their sensitivity. The owner remains the authority over retention and external disclosure.

### Derived answers, not raw access

The commercial unit is a task-specific answer derived from private context. Raw notes, conversations, and documents are not exposed by default.

### Existing payment rails

Lore MCP does not build a payments network. It is designed to use Cloudflare's Monetization Gateway and x402 for payment negotiation, verification, metering, and settlement.

## How it works

### 1. Accumulate

Personal agents write observations, preferences, episodes, decisions, and provenance into a local staging area.

### 2. Consolidate

A context-janitor skill periodically turns noisy activity into durable lore, resolving duplication and preserving links to supporting sources.

### 3. Govern

Owner-defined policy classifies lore as private, usable for derived answers, approval-required, or prohibited from external use.

### 4. Advertise

The node publishes a coarse capability manifest—topics, recency, kinds of experience, and disclosure limits—without publishing the underlying memory or a searchable private index.

### 5. Discover

Discovery happens at two levels:

1. Agent and plugin marketplaces help a buyer find potentially relevant Lore MCP endpoints.
2. A free `discover` call asks a particular node whether it can help with a task and returns only safe relevance metadata.

### 6. Answer and settle

A buyer calls `answer`. If payment is required, Cloudflare returns an HTTP `402 Payment Required` response containing the x402 payment requirements. The buyer authorizes payment and retries; after verification, the local node produces a policy-filtered answer.

```text
buyer task
    ↓
marketplace search
    ↓
discover(query) ──→ safe relevance metadata
    ↓
answer(query) ────→ HTTP 402 + price
    ↓                       ↓
local retrieval ←── verified payment
    ↓
policy-filtered answer
```

## Initial MCP surface

The public surface can begin with two tools:

- `discover(query)` — free; describes whether the node can help without revealing private context.
- `answer(query)` — paid when policy requires it; returns a derived answer with provenance and disclosure limits.

Private owner-facing operations such as remembering, forgetting, consolidating, reviewing, and changing policy can be added only as the local memory implementation requires them.

### Run the MCP server

The implemented server exposes those two tools using MCP protocol version
`2025-11-25`:

```sh
# Local agent configuration (newline-delimited stdio)
lore serve

# Stateless Streamable HTTP for a tunnel or reverse proxy
lore serve --transport http --host 127.0.0.1 --port 8765
```

Register the local server with either supported agent:

```sh
codex mcp add lore -- lore serve
claude mcp add --scope user lore -- lore serve
```

`discover` returns only safe relevance metadata. `answer` searches only memories
the owner marked `external`; pending, private, and discarded records cannot be
returned. HTTP binds to loopback by default. Binding another interface requires
`--token` or `LORE_MCP_TOKEN`.

The intended paid deployment boundary is:

```text
buyer agent → Cloudflare → Monetization Gateway / x402 → tunnel → Lore /mcp
```

Lore owns local retrieval and disclosure policy. Cloudflare sits in front of
the HTTP MCP route and owns the `402 Payment Required` exchange, verification,
metering, and settlement. Do not expose the origin through a second route that
bypasses the gateway. As of July 2026, Cloudflare's Monetization Gateway is an
announced early-access product; Lore documents the boundary but does not pretend
that enrollment or payment policy can already be automated. See Cloudflare's
[announcement](https://blog.cloudflare.com/monetization-gateway/).

## Monetization

For a fixed-price answer, x402 already acts as the quote: the first request receives a `402` response with the price and payment instructions.

Dynamic pricing is useful when the value or cost depends on the query. Possible inputs include:

- breadth and complexity;
- evidence volume;
- firsthand versus secondhand knowledge;
- freshness and rarity;
- commercial sensitivity;
- exclusivity;
- owner reputation and market demand.

A buyer should be able to specify a maximum budget. The node can either quote an exact amount before answering or use an x402 authorization that settles actual usage up to the approved cap.

Pricing should initially be transparent and predictable. Opaque price discrimination would undermine trust before the market has earned it.

## Privacy boundary

Cloudflare can enforce access and verify payment at the edge; it does not decide what private context is safe to release. Lore MCP must enforce that boundary locally.

The minimum safeguards are:

- pre-retrieval and post-generation policy checks;
- provenance for derived claims;
- per-buyer and per-topic limits;
- protection against repeated queries that reconstruct private material;
- explicit handling of third-party and confidential information;
- revocable permissions and an owner-visible audit log.

## First version

The smallest useful prototype is:

1. a local memory store;
2. one context-janitor skill usable by multiple agents;
3. a capability manifest;
4. `discover` and `answer` MCP tools;
5. a Cloudflare/x402 payment boundary;
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
│   ├── claude-prompt.md
│   └── codex-prompt.md
├── memories/
│   ├── claude/             # Claude-generated synthesis
│   └── codex/              # Codex-generated synthesis
└── blueprint/
    ├── blueprint.json      # captured shape of your lore (persona, axis, topics)
    └── lore-map.md         # human-readable rendering of the blueprint
```

Source memory remains in the agent's directory. Lore stores its imported copy,
review state, and source path locally. Updating a source file refreshes the
indexed text without resetting the owner's disclosure decision.

## Development

```sh
uv sync
uv run python -m unittest discover -s tests -v
uv run lore --help
```

`uv.lock` is committed, so contributors and CI resolve the same project setup.
The curl installer remains independent of `uv` for end users.

The implementation uses only the Python standard library: `argparse`, `sqlite3`,
`subprocess`, and `http.server`. There is no application framework, vector
database, or MCP SDK to install.

## Status

The local CLI, agent-memory import, FTS5 search, review flow, assisted synthesis,
and basic stdio/HTTP MCP server are implemented. Payment enforcement, repeated-
query extraction protection, remote identity, and marketplace discovery remain
future work.

## Related infrastructure

- [Cloudflare Monetization Gateway](https://blog.cloudflare.com/monetization-gateway/)
- [x402](https://www.x402.org/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
