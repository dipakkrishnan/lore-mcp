# Answer tier — design

Status: draft (2026-08-17). Backlog anchor: `MCP-003`. Companion items:
`MON-014` (bridge keep-alive), `EVAL-002` (quality gate), `MON-009` (pricing
unit).

The catalog surface (`discover` free, `get` paid) sells the owner's raw
publications. The answer tier sells the owner's **judgment**: a buyer asks a
question in their own words and gets a synthesized answer in the owner's
voice, grounded in — and citing — the owner's approved publications. This
document fixes the decisions that shape everything else: what the answer-time
agent may read, the MCP tool contract, the data model, and what the agent
actually is.

## 1. Product framing

Two buyer modes, only one of which exists today:

- **Corpus mode** (`get`, shipped): the buyer's agent picks publications from
  teasers and does its own synthesis. Value = the content.
- **Oracle mode** (`answer`, this design): the buyer's question doesn't map to
  one publication — it needs the owner's weighting applied across the corpus
  to the buyer's situation. Value = the judgment. It also absorbs the
  vocabulary-gap problem: the buyer no longer has to be a good librarian of
  someone else's library, because the mapping from buyer phrasing to owner
  corpus happens node-side, with full content visible.

The mental model is asynchronous, bounded, cheap consulting: the owner would
never take a 30-minute call for $0.25, but their published judgment can answer
that question a thousand times at that price. Early callers are
**human-directed** (a person tells their agent "ask this node"); autonomous
agent-initiated calls come later and depend on the trust primitives
(discovery, reviews, receipts) tracked separately in `XC-016` (buyer
discovery).

## 2. The memory boundary (decided)

**The answer-time agent reads approved publications only. It never reads
private memories.** This is `MCP-003`'s founding constraint and it survives
the move from "one prompt" to "real agent":

- The buyer is an adversarial stranger paying pennies per question. Private
  memory in the answer-time context turns N cheap questions into an
  extraction pump, and prompt-injected questions ("quote your source
  material") are table stakes. Anti-reconstruction machinery is unimplemented
  and hard; a provable read boundary is cheap.
- "My agent" is still mine without private memory at runtime: the persona,
  the skills, the published corpus, and the publish-time synthesis (where
  private memory's value legitimately flows in, behind the owner approval
  gate) are all the owner's.

Two consequences:

1. **The persona preamble is a new disclosed artifact.** The blueprint from
   `lore-onboard` is private by design (`BP-001`). The answer agent needs an
   owner-approved *public persona* — voice, emphasis, disclaimers — distinct
   from the blueprint, approved through the same gate publications go
   through, and shipped to the edge by `lore push`.
2. If private-memory-informed answers are ever wanted, that is a new
   per-topic disclosure decision the owner opts into explicitly — never a
   side effect of an infra choice.

## 3. Tool contract

Three tools. Payment settles at submission; the work is asynchronous; results
are fetched by ticket. This is deliberate: `paidTool` settles **before** the
handler runs, so "refuse without charging" must live in a free tool, and an
async ticket keeps the contract stable when answer latency grows from ~90s
(Tier 1) to tens of minutes (a future Tier 3).

### `can_answer(question)` — free

Coverage probe and price quote. Runs a cheap model pass over the manifest
(and, if needed, publication content) and returns:

```json
{
  "coverage": "yes | partial | no",
  "reason": "one-sentence honest basis for the verdict",
  "topics": ["topics the answer would draw from"],
  "price_usd": 0.25,
  "retention_disclosure": "Your question is retained by this node and visible to its owner."
}
```

This is the trust surface: a node that says "no" when it can't help is the
early reputation mechanism. `EVAL-002` phase 2 scores exactly this verdict
("would a buyer who paid after this feel cheated?").

### `answer(question)` — paid

Settles payment, creates a ticket, kicks off the agent, returns immediately:

```json
{ "ticket": "<opaque id>", "status": "running", "poll": "result", "estimate_seconds": 120 }
```

Post-payment the agent re-runs the coverage check; if it genuinely cannot
answer, the ticket completes as `refused` with the reason stored. No refund
path exists until the x402 wrapper exposes a pre-settlement hook (same
`ponytail` as `get`'s revocation race) — the free `can_answer` probe is what
makes this case rare and defensible.

### `result(ticket)` — free

Idempotent poll. Returns `running`, or the terminal record:

```json
{
  "status": "complete | refused | failed",
  "answer": "...",
  "cited_publication_ids": ["..."],
  "disclosure": "Answer synthesized from owner-approved publications; verify via get."
}
```

Citations are an upsell funnel into `get` (verify what I said, buy the
source), and every cited id is validated against active publications before
the answer is stored.

The `failed` outcome (budget or wall-clock exhaustion, or an agent error —
§5) has the same money contract as `refused`: the buyer paid at submission
and no automated refund exists until the x402 wrapper grows a pre-settlement
hook, so `result` returns `failed` with a plain reason and an explicit
no-refund note pointing at the node owner. Unlike `refused`, a failure is
the node's fault, not the question's — the stored reason and per-ticket
telemetry exist so the owner can see failures, fix them, and make it right
out of band.

## 4. Data model

All at the edge (D1), alongside the existing `publications` table. Nothing
here contains private memory.

### Inputs — `answer_tickets`

| column | notes |
|---|---|
| `ticket_id` | opaque public token, same checksum scheme as `public_id` (no sequence) |
| `question` | buyer's verbatim question |
| `payer` | wallet address from settlement (already public on-chain) |
| `price_usd`, `settlement_ref` | what was charged; tx reference if the wrapper surfaces it |
| `coverage_verdict` | verdict at submission time (`yes/partial/no`) |
| `status` | `running → complete \| refused \| failed` |
| `created_at`, `updated_at` | |

The question log is a product asset, not just plumbing: **unanswerable and
partially-covered questions are the owner's demand signal for what to publish
next.** `lore status` / a future `lore questions` should surface them to the
owner, closing the loop back into `lore-publish`. Because buyer questions may
contain buyer-sensitive context, the retention disclosure in `can_answer` is
mandatory, and questions are never republished or served to other buyers.

### Outputs — `answers`

| column | notes |
|---|---|
| `ticket_id` | FK |
| `answer` | final text, owner-voiced |
| `cited_publication_ids` | JSON array, validated against active publications |
| `refusal_reason` | set when `status = refused` |
| `model`, `input_tokens`, `output_tokens`, `cost_usd` | unit economics per answer — must be visible to prove price > cost (`MON-009`) |
| `tool_calls`, `duration_ms` | agent-loop telemetry |
| `trace` | private agent trace (tool calls + intermediate drafts) for owner debugging; never served to buyers |
| `completed_at` | |

### Owner-approved config — `node_settings` (or new `persona` row)

| key | notes |
|---|---|
| `persona_preamble` | the approved public persona (section 2); shipped by `lore push` |
| `answer_price_usd` | the answer tier's own price, distinct from the per-publication price (`MON-009`) |
| `answer_enabled` | owner opt-in flag; the tier is off until the persona is approved and a price set |

## 5. The agent (Tier 1 — ship this)

A simple tool-calling agent on the Cloudflare Agents SDK — the `agents`
package the Worker already uses (`McpAgent` is Durable-Object-backed). No
container, no filesystem, no CLI: the corpus is a bounded set of D1 rows, so
the agent gets a **memory-view toolset** over the database, analogous to a
built-in memory tool — a read-only view, not a general filesystem. It is
effectively a subagent with three tools:

| tool | implementation |
|---|---|
| `catalog()` | the manifest query `discover` already runs (topics, teasers, ids, freshness) |
| `read(id)` | full publication row by `public_id` (active publications only — the same rows `get` serves) |
| `search(query)` | FTS over title + content (D1 is SQLite; FTS5) — the vocabulary-gap workhorse |

Loop shape (Messages API calls from the DO; seller's Anthropic key in a
Worker secret, so the seller pays inference out of revenue):

1. **Coverage check** against the catalog — refuse honestly here, post-payment.
2. **Gather**: search + read the relevant publications (multi-hop; an answer
   may cross-reference several).
3. **Draft** in the persona voice, citing ids.
4. **Self-critique**: grounded only in what was read? Citations real and
   active? Would the persona actually say this? One revision pass.
5. Store the answer + telemetry; mark the ticket terminal.

Budgets, enforced in code not prompt: max tool calls (~15), max model turns
(~6), max wall-clock via DO alarm (fail the ticket as `failed`, not hang),
and a per-answer cost ceiling derived from `answer_price_usd`. Worker CPU
limits are on CPU time, not wall time awaiting `fetch`, so a 1–4 minute loop
is comfortably in bounds; ticket state lives in D1 so a retried alarm resumes
or fails cleanly.

**Future tools, deliberately not now:** web search (ground the buyer's
context, e.g. "given today's X, what would you do") raises answer quality but
adds cost, latency, and an injection surface — add it only once EVAL-002
shows grounding failures that publications alone can't fix. Same posture for
a filesystem: only needed if the agent must checkpoint context across steps
(Tier 3 below), not for corpus access.

## 6. Future tiers (designed-for, not built)

- **Tier 2 — Cloudflare Workflows**: durable multi-step execution with
  retries/sleeps, when a single answer becomes genuinely long-running. Slots
  in behind the same ticket contract.
- **Tier 3 — Cloudflare Containers**: literally the owner's agent — Claude
  Agent SDK / Claude Code with skills and a filesystem holding the pushed
  publication bundle + persona. Justified only when the corpus or the skills
  outgrow the memory-view toolset. The tool contract (section 3) does not
  change; only what runs behind `answer` does. The memory boundary (section
  2) still applies: the bundle in the container is publications + approved
  persona, never private memory.

## 7. Latency and MCP mechanics

- MCP clients default to ~60s per tool call but reset on **progress
  notifications**; streamable HTTP holds the connection fine. `answer`
  returns in seconds (ticket), so only `can_answer` and `result` need to be
  fast — they are.
- **The bridge is the weakest timeout in the chain** (`MON-014`): the
  x402-mcp-bridge must forward progress notifications / apply generous
  timeouts, or buyer clients die mid-call regardless of what the node does.
- Poll etiquette: `result` returns `estimate_seconds`; buyer agents poll on
  that cadence. Hosted clients (claude.ai remote MCP) are less forgiving than
  CLI clients — the ticket shape is what keeps them working.

## 8. Economics

An agent loop is 5–15 model calls per answer; per-answer inference cost is
real money. Constraints:

- `answer_price_usd` must clear measured `cost_usd` with margin — which is
  why cost telemetry is a first-class output column, and why the answer tier
  needs **its own price** rather than inheriting the per-publication
  `PRICE_USD`. That pulls `MON-009` onto this design's critical path.
- Cost levers, in order: smaller model for gather/coverage passes with the
  strongest model only for the voiced draft; two-pass retrieval instead of
  inlining; caps from section 5.

## 9. Ship gate

`MCP-003` does not ship until `EVAL-002` phase 2 judges: (a) `can_answer`
honesty — paid-after-yes buyers don't feel cheated; (b) answer quality —
owner-voiced and grounded beats generic-model-with-citations; (c) the
refusal path — uncovered questions refuse rather than confabulate. Phase 1
of `EVAL-002` (discover/get teaser honesty) is unblocked today and needs
none of this design.
