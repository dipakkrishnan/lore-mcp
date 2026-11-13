---
id: EVAL-002
title: Evaluate paid value from the buyer's side of the MCP surface
priority: P2
effort: M
component: evals
status: in-review
related: [EVAL-001, MCP-001, MCP-003, MON-009, MON-017, XC-008]
blockers: [MON-008, MON-017]
dependencies: ["A QA-only answer-model API key with a bounded spend budget"]
github_issue: null
created: 2026-07-30
updated: 2026-11-12
---

## Problem

EVAL-001 evaluates the owner's local memory pipeline. It does not answer the
buyer's question: after seeing only a public catalog, was a paid publication or
proxy answer worth its advertised price? Protocol tests can prove settlement
without catching a misleading teaser, generic proxy voice, unsupported answer,
invalid citation, or answer whose inference cost exceeds its price.

## Proposed approach

Use one buyer harness against seeded approved publications. The buyer sees only
`discover` and asks in vocabulary different from the catalog. Evaluate two
separate products:

1. `discover` → paid `get(id)`: teaser honesty and usefulness of the purchased
   publication.
2. `discover` → paid `answer(question)` → free `result(ticket)`: groundedness,
   owner-proxy fidelity, refusal honesty, active citations, and observed unit
   economics.

Run deterministic local cases first, then a bounded manual/release run against
the standing Base Sepolia QA node once `MON-008` is live. Record the settlement
receipt plus the answer job's price, status, model cost, tokens, calls, and
latency. Do not add reviews, refunds, dashboards, dynamic pricing, or a buyer UI
to this evaluation item.

## Acceptance criteria

- [x] Local `discover` → `get` cases include buyer phrasing outside the owner's
      vocabulary and catch a teaser that promises content the publication lacks.
- [ ] A deployed QA run completes paid `get`, returns the seeded publication,
      and records its Base Sepolia settlement receipt.
- [ ] A deployed QA run completes paid `answer`, polls free `result`, and
      returns an owner-voiced answer grounded in active publication ids.
- [ ] An uncovered paid question completes as `refused` without invented
      claims; retention and no-refund disclosures were visible before payment.
- [ ] Every completed answer's cited ids are active and the judge prefers its
      grounding and owner-specific judgment over a generic model given only the
      question.
- [ ] The report records `price_usd`, `cost_usd`, outcome, tokens, tool calls,
      and duration for complete, refused, and failed jobs; the tested answer
      price clears observed model cost with stated margin.
- [ ] No candidate or judge receives private memories, the private blueprint,
      seller credentials, or buyer key material.

## Notes

The local buyer harness (`evals/buyer.py`) already covers a relevant match, a
vocabulary gap, and a deliberately misleading teaser through the real local MCP
surface. The node answer eval covers the real Pi path and cost/citation capture
without payment. What remains is the combined buyer, Worker, model, and testnet
settlement proof against QA; do not seed the owner's production catalog with
fixtures.

**Backlog audit (2026-11-12), moved to in-review:** The local buyer harness
(evals/buyer.py, PRs #103 and #107) covers the first criterion. Every other
criterion needs a deployed Base Sepolia QA node and a QA-only answer-model
key. No QA node has ever deployed, because the qa environment has no secrets
(MON-016), and no work has happened since 2026-08-21. It should leave in-
progress. It can go back to ready once MON-016 is done and a bounded answer-
model key exists.

**Prioritization (2026-11-12):** Priority P2 (was P1). Stays in-review.
Before it can be ready: Blocker MON-008 is still in-review, and MON-016 (qa
secrets) is the real gate and should probably be listed as a blocker. A
bounded QA answer-model key is still needed. Re-check whether a Base Sepolia
settlement receipt is still the right proof now that card-on-bid
(MON-051/054) and real-money stores (MON-025) shipped.
