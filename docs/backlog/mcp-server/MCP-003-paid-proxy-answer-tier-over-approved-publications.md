---
id: MCP-003
title: Add a paid agentic answer tier over approved publications
priority: P2
effort: L
component: mcp-server
status: completed
related: [MCP-001, MCP-002, EVAL-002, CAP-001, ONB-001, MON-015, MON-017, APP-035, BP-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-02
updated: 2026-08-28
---

## Problem

The catalog surface (manifest-first `discover`, paid `get`) sells the owner's
approved publications. It did not let a buyer ask a question in their own
words and buy the owner's weighting across that corpus. The answer tier adds
that second product without widening disclosure to private memories.

## Proposed approach

Implemented design: `docs/answer-tier.md`. The delivered shape is:

- **A real agent, not a single prompt.** Pi core runs inside the Cloudflare
  `McpAgent` scheduled task with a read-only **memory-view toolset** over D1:
  `memory_view(public_id)` and `memory_search(query)`. The catalog is included
  in the initial prompt. Six model turns and a three-minute deadline bound the
  run. No container, filesystem, or coding-agent CLI is present at this tier.
- **Memory boundary (hard constraint, unchanged):** the answer-time agent
  reads approved publications only — never private memories. Buyers are
  adversarial strangers paying pennies per question; the read boundary is
  the anti-extraction defense. The owner-approved **public proxy charter**
  (distinct from the private blueprint, BP-001) is a new disclosed artifact
  shipped by `lore push`.
- **Two-tool async contract:** `answer(question)` is paid, settles at
  submission, and returns a ticket; `result(ticket)` is a free idempotent poll.
  `discover` advertises the answer price and retention disclosure, and the
  buyer judges teaser coverage without charging the seller for a model call.
- **Data model** (see design doc §4): one `answer_jobs` row holds the verbatim
  question, price, status, answer/refusal, validated citations, model, tokens,
  `cost_usd`, tool calls, duration, and timestamps. Node settings hold
  `proxy_preamble`, `answer_price_usd`, and `answer_enabled`.
- **Recovery:** each completed model turn is checkpointed in D1 with bounded
  retention; a fresh Worker invocation resumes the same ticket without another
  payment.

## Acceptance criteria

- [x] A buying agent can pay for `answer(question)` and, via `result`,
      receive an answer from the owner's AI proxy citing publication ids, at a price set
      independently of the per-publication fetch price.
- [x] The answer path provably reads only active publications — the agent's
      only data access is the memory-view toolset; no code path from the
      agent to the memories table or the private blueprint.
- [x] `discover` quotes the answer price and discloses question retention;
      uncovered paid questions complete as `refused` rather than confabulating.
- [x] The proxy charter served at answer time is a distinct,
      owner-approved artifact — the tier stays disabled until the owner
      approves one and sets a price.
- [x] Every stored answer records model, tokens, cost, tool calls, and duration
      so `EVAL-002` can judge unit economics.
- [x] Every cited id resolves to an active publication at answer time.
- [x] A fresh Worker invocation can resume a running ticket from its bounded D1
      checkpoint without creating another ticket or payment.

## Notes

Implemented in PR #104 (`d72ae838`); cost/citation evaluation tightened in
PR #107 and D1 checkpoint recovery landed in PR #108. The Worker now exposes
`discover`, paid `get`, optional paid `answer`, and free `result`.

Completion here means the bounded MCP implementation exists and its component
tests pass. `EVAL-002` separately owns buyer value, proxy fidelity, refusal
quality, and observed margin against a deployed QA node. `MON-017` owns the
remaining pre-payment provider-readiness defect. `APP-035` owns optional
seller-side Desktop controls after user validation.

Deliberately deferred: web-search tool for the agent (quality lever, but adds
cost/latency/injection surface — revisit when EVAL-002 shows grounding
failures publications can't fix); refunds for post-payment refusals (needs a
pre-settlement hook from the x402 wrapper — same ponytail as `get`'s
revocation race); Tier 2/3 runtimes (Workflows, Containers with the Claude
Agent SDK) — the contract is designed so they slot in without breaking
buyers.
