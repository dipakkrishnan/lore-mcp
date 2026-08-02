---
id: MCP-003
title: Add a paid proxy answer tier over approved publications
priority: P2
effort: L
component: mcp-server
status: in-review
related: [MCP-001, MCP-002, EVAL-002, CAP-001, ONB-001]
blockers: [MCP-001, EVAL-002]
dependencies: []
github_issue: null
created: 2026-08-02
updated: 2026-08-02
---

## Problem

The catalog surface (manifest-first `discover`, fetch-by-id) sells the owner's
raw publications, but the scarcest asset in someone's lore is not the
documents — it is the judgment: what an 80/20 version of the owner would
emphasize, dismiss, or apply to the buyer's specific question. Today a buying
agent must synthesize that itself from fetched content, with none of the
owner's weighting. There is no way to buy an answer *from* the owner's
experience, only the material behind it — "go through my agent before you
reach me" has no tool.

## Proposed approach

A third, premium-priced MCP tool on top of the catalog: `answer(question)`
runs a model call over the owner's **approved publications only**, prompted
with the owner's blueprint persona (from `lore-onboard`), and returns a
synthesized answer in the owner's voice. Hard constraints, by design not
option:

- The proxy never reads private memories. Synthesis over private material
  happens at publish time, where the owner approves the derived claims; the
  answer-time model sees only what any buyer could already fetch.
- Every answer cites the publication ids it drew from, so the buyer can
  `get` and verify (and the citation is an upsell).
- The proxy refuses before payment when the manifest shows no coverage for
  the question — the bounded, indexed corpus makes "my lore doesn't cover
  this" a check the model can actually make.

The improvement loop is owner-side capture only: more dictation (CAP-001),
more imported documents, more session context (ONB-001), better synthesis.
No buyer feedback mechanism is proposed.

## Acceptance criteria

- [ ] A buying agent can pay for `answer(question)` and receive a synthesized
      answer citing publication ids, at a price above the per-publication
      fetch price.
- [ ] The answer path provably reads only active publications — no code path
      from the proxy prompt to the memories table.
- [ ] A question with no manifest coverage is refused without charging.
- [ ] The tier does not ship until the EVAL-002 harness judges proxy answers
      (owner-voiced and grounded vs. generic-model-with-citations).

## Notes

From the 2026-08-01/02 vision discussion on simplifying the tool surface:
manifest-first catalog is the substrate (MCP-001), this tier is the oracle on
top. The reputational risk is the design driver — a wrong proxy answer is the
owner being wrong, for money — hence citations + refusal as requirements.
Blocked on MCP-001 (needs the manifest for the coverage check and ids for
citations) and on EVAL-002 (the quality gate). Open questions: where the
model call runs (Workers AI vs. API key, cost per answer must clear the
price), and whether `answer` keeps that name while the catalog's fetch tool
takes `get`.
