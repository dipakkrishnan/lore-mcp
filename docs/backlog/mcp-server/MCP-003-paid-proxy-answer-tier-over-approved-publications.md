---
id: MCP-003
title: Add a paid agentic answer tier over approved publications
priority: P2
effort: L
component: mcp-server
status: in-review
related: [MCP-001, MCP-002, EVAL-002, CAP-001, ONB-001, MON-009, MON-014, BP-001]
blockers: [MCP-001, EVAL-002, MON-009]
dependencies: []
github_issue: null
created: 2026-08-02
updated: 2026-08-17
---

## Problem

The catalog surface (manifest-first `discover`, paid `get`) sells the owner's
raw publications, but the scarcest asset in someone's lore is not the
documents — it is the judgment: what an 80/20 version of the owner would
emphasize, dismiss, or apply to the buyer's specific question. Today a buying
agent must synthesize that itself from fetched content, with none of the
owner's weighting, and must guess the right publications from teasers (the
vocabulary gap EVAL-002 names). There is no way to buy an answer *from* the
owner's experience, only the material behind it.

## Proposed approach

Full design: `docs/answer-tier.md`. Summary of the decided shape:

- **A real agent, not a single prompt.** A tool-calling agent on the
  Cloudflare Agents SDK (Durable Object — the `agents` package the Worker
  already uses), given a read-only **memory-view toolset** over D1:
  `memory_view(public_id)` and `memory_search(query)`. The catalog is included
  in the initial prompt. Loop: coverage check →
  gather (multi-hop) → draft in the owner's voice → self-critique → cite.
  Budgets (tool calls, model turns, wall clock, cost) enforced in code. No
  container or filesystem at this tier; Workflows/Containers are future tiers
  behind the same contract.
- **Memory boundary (hard constraint, unchanged):** the answer-time agent
  reads approved publications only — never private memories. Buyers are
  adversarial strangers paying pennies per question; the read boundary is
  the anti-extraction defense. The owner-approved **public persona preamble**
  (distinct from the private blueprint, BP-001) is a new disclosed artifact
  shipped by `lore push`.
- **Two-tool async contract:** `answer(question)` is paid, settles at
  submission, and returns a ticket; `result(ticket)` is a free idempotent poll.
  `discover` advertises the answer price and retention disclosure, and the
  buyer judges teaser coverage without charging the seller for a model call.
- **Data model** (see design doc §4): `answer_tickets` (verbatim question,
  price, status), `answers` (text, validated citations, and per-answer
  model/token/cost telemetry), and
  node settings for `persona_preamble` + `answer_price_usd` +
  `answer_enabled`. The question log doubles as the owner's demand signal
  for what to publish next.

## Acceptance criteria

- [ ] A buying agent can pay for `answer(question)` and, via `result`,
      receive a synthesized answer citing publication ids, at a price set
      independently of the per-publication fetch price.
- [ ] The answer path provably reads only active publications — the agent's
      only data access is the memory-view toolset; no code path from the
      agent to the memories table or the private blueprint.
- [ ] `discover` quotes the answer price and discloses question retention;
      uncovered paid questions complete as `refused` rather than confabulating.
- [ ] The persona preamble served at answer time is a distinct,
      owner-approved artifact — the tier stays disabled until the owner
      approves one and sets a price.
- [ ] Every stored answer records model, tokens, and cost, and measured cost
      clears the configured answer price.
- [ ] Every cited id resolves to an active publication at answer time.
- [ ] The tier does not ship until the EVAL-002 phase-2 harness judges
      answer and refusal quality (owner-voiced and grounded vs.
      generic-model-with-citations).

## Notes

From the 2026-08-01/02 vision discussion (manifest-first catalog as substrate,
this tier as the oracle on top); reshaped 2026-08-16/17: agent-not-prompt,
ticket contract, memory-view toolset, and the memory-boundary decision are
recorded in `docs/answer-tier.md`. The reputational risk remains the design
driver — a wrong proxy answer is the owner being wrong, for money — hence
citations, honest coverage refusal, and the eval gate.

Blockers updated 2026-08-17: `MCP-001` (manifest) stays a blocker — the
agent's `catalog()` tool is the manifest query `discover` already runs, which
presumes MCP-001's owner-approved manifest exists and is stable, and MCP-001
is still `in-progress` (blocked on XC-002). `EVAL-002` remains the quality
gate (its phase 2). `MON-009` added: the answer tier needs its own price and
the pricing-unit decision, which pulls that item onto this critical path.
`MON-014` (bridge keep-alive for long-running paid calls) is required for
buyers to actually survive the latency but is independently shippable, so it
is related, not a blocker.

Deliberately deferred: web-search tool for the agent (quality lever, but adds
cost/latency/injection surface — revisit when EVAL-002 shows grounding
failures publications can't fix); refunds for post-payment refusals (needs a
pre-settlement hook from the x402 wrapper — same ponytail as `get`'s
revocation race); Tier 2/3 runtimes (Workflows, Containers with the Claude
Agent SDK) — the contract is designed so they slot in without breaking
buyers.
