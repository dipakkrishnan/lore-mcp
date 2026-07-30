---
id: XC-004
title: Resolve where the payment gate runs for a deployed node
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [DEP-001, DEP-002, DEP-003, MON-002, MON-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

The two MVP designs contradict each other at exactly one seam, found in design
review (2026-07-30) and deliberately left unresolved rather than papered over.

`docs/enable-payments.md` enforces payment **in-process**: the x402 gate wraps the
`answer` tool inside `lore serve`. `docs/node-deployment.md` deploys a **handler
over an exported bundle** — a deployed node does not run `lore serve` at all. So a
*paid deployed node* has no designed home for its payment gate:

- **Lambda**: plausible — the Python `x402`/`cdp` stack can ship inside the
  function — but nobody has verified it, and the gate's settings-backed config
  (`MON-002`) assumes a local `$LORE_HOME` that a Lambda doesn't have.
- **Cloudflare Worker**: the Python stack does not run there, period. A paid
  Worker means a JavaScript payment gate — a second payment implementation
  nobody has scoped.

Until this is resolved, both docs gate their payment-touching requirements on it,
and the paid portions of `DEP-002`/`DEP-003` must not start.

## Proposed approach

An investigation producing a decision, not code. Evaluate, in rough order of
promise:

1. **Coinbase's own TypeScript x402 tooling.** The x402 ecosystem is TS-first;
   if official middleware runs on Workers, the "second implementation" may be an
   integration rather than a build — potentially making Cloudflare the *easier*
   paid path, inverting the current assumption. Verify what actually exists and
   what it requires before weighing anything else.
2. **Python gate inside Lambda.** Package `x402`/`cdp` with the function; solve
   config (env vars from Secrets Manager rather than `$LORE_HOME` settings);
   measure cold-start cost.
3. **Paid = local-serve only for the MVP.** Deployed nodes are free, monetized
   nodes run at home behind a tunnel. Simplest honest scope if 1 and 2
   disappoint.

Deliverable: a recorded decision with rationale, plus edits bringing
`docs/node-deployment.md`, `docs/enable-payments.md`, `DEP-002`, `DEP-003`, and
`MON-002`/`MON-003` into line with it.

## Acceptance criteria

- [ ] A written decision exists naming where the gate runs per provider (or that
      paid-deployed is deferred), with the rationale and what was actually
      verified — not assumed — about the TS x402 tooling and Lambda packaging
- [ ] Both design docs' "open problem"/"unresolved" callouts are replaced with
      the decision
- [ ] The paid-path scoping in `DEP-002` and `DEP-003` is updated to match
- [ ] If paid-deployed is deferred, the docs say "deployed nodes are free-only"
      explicitly rather than leaving the seam implicit

## Notes

Filed from design review of the 2026-07-30 full-service-onboarding transposition
(Shane: investigate rather than resolve). The review's other findings were applied
directly; this one was judged to need real verification — especially of the
TypeScript x402 ecosystem — before any scoping decision would be trustworthy.

Cross-cutting because it moves requirements in two components at once
(deployment and monetization); resolving it inside either folder would hide the
contradiction from the other.
