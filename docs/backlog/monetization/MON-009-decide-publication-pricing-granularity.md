---
id: MON-009
title: Decide pricing granularity beyond one global publication price
priority: P2
effort: M
component: monetization
status: in-review
related: [MON-002, MON-003, MCP-001, MCP-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-02
updated: 2026-08-26
---

## Problem

The POC deploys one owner-configured price for every publication. That is clear
and safe, but it assumes every publication has equal value and makes a buyer who
wants a whole knowledge base pay once per id. Before expanding the pricing
model, Lore needs to choose what is actually sold: one publication, a mutable
topic, or an explicit group of publication ids.

## Proposed approach

Keep the global price for the POC and use real buyer behavior to decide whether
another unit is needed. The likely next step is an optional per-publication
override with the global price as its default: it preserves the current atomic
contract of one advertised id, one payment, and one returned artifact.

Treat topics as discovery metadata, not products. Topic membership changes over
time, which makes it unclear what a prior purchase entitled the buyer to receive.
If buyers want several ids at once, add an explicit, versioned bundle with a
fixed member list and bundle price. Bundles enable discounts and "buy all"
without turning a mutable taxonomy into a payment contract, but require rules
for partial failure, duplicate ownership, publication revocation, and updates.

## Acceptance criteria

- [ ] A decision record chooses the pricing unit and states whether a global
      default remains available.
- [ ] Every offering exposes its exact price before payment, and the advertised
      price, payment requirement, and buyer spend cap derive from one value.
- [ ] The contract defines what happens when content changes or is revoked after
      purchase.
- [ ] Any multi-publication option defines membership/versioning, partial
      failure, and how already-owned publications affect the price.
- [ ] The decision is informed by initial POC evidence: buyer selection counts,
      multi-id demand, and seller pricing effort.

## Notes

Current recommendation: global default, then optional per-publication overrides.
Keep topics non-commercial; add explicit bundles only after real multi-buy demand.
This avoids speculative checkout machinery while leaving a clean path to buying
all of an owner's publications.

**Prioritization pass 2026-08-03:** demoted `P2` → `P3`. Acceptance criterion 5
requires the decision to be "informed by initial POC evidence: buyer selection
counts, multi-id demand, and seller pricing effort" — evidence that doesn't
exist yet with no live buyers against a standing deployment. Left `in-review`
rather than promoted; revisit once `MON-008`/`XC-008` are producing real usage
data.

**2026-08-17 — pulled onto the answer-tier critical path.** `MCP-003` (now the
agentic answer tier, `docs/answer-tier.md`) lists this item as a blocker: an
answer is backed by a 5–15-call agent loop whose inference cost the seller
pays, so it cannot inherit the single per-publication `PRICE_USD` — at the
current $0.01 it would be underwater. Minimum decision this item now owes
before `MCP-003` ships: a separate `answer_price_usd`, set by the owner, with
per-answer cost telemetry (stored on each answer) proving price clears cost.
The broader bundle/per-publication questions can still wait for POC evidence.

**Prioritization pass 2026-08-26:** corrected priority `P3` → `P2` — this item
blocks `MCP-003`, which is itself `P2`; a blocker should not outrank lower
than what it blocks. Not promoted to `ready`: acceptance criterion 5 still
needs POC usage data that doesn't exist yet, per the 2026-08-03 note above.
The narrower "minimum decision" this item now owes (a separate
`answer_price_usd` plus cost telemetry, described in the 2026-08-17 note)
reads like it could be split into its own smaller, immediately-ready item —
flagging that as a suggestion for `backlog-ideate` rather than doing it here,
since prioritization doesn't create items.
