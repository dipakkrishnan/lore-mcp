---
id: XC-102
title: Unit-test the relay and checkout rules that only fetch reaches
priority: P2
effort: S
component: cross-cutting
status: ready
related: [XC-099, XC-098]
blockers: [XC-099]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

`feedback-relay` and `checkout` are already fast (vitest 3.0 s and 1.1 s;
their CI jobs are mostly `npm ci`), but several of their rules are reached
only through the Worker's `fetch` handler, so they are asserted by HTTP shape
and never measured. Relay: the `/report` content-type check, the two-step
body-size cap and the error mapping (`src/index.ts:60-115`), the `/events`
handler (24-42), and the window maths in `FeedbackQuota.take`
(`quota.ts:43-73`), reachable only through the Durable Object. Checkout:
`storeOrigin` (`index.ts:21-29`), the HMAC `token` and `owns` (105-119), the
`paid` rule in `verify` (87), the card minimum and cents rounding (54, 68),
test-key gating (57), the Stripe form fields in `createSession`
(`stripe.ts:41-60`) and event filtering in `webhook()` (`webhooks.ts:39+`).
`relay.test.ts:61` calls `worker.fetch` with a fake env, but `index.ts`
re-exports `FeedbackQuota`, whose module imports `cloudflare:workers`, so the
file cannot load in plain node.

## Proposed approach

Move each rule to a leaf module (`relay/src/report-rules.ts`,
`relay/src/quota-window.ts`; `checkout/src/origin.ts`, `checkout/src/token.ts`,
`checkout/src/pricing.ts`, `checkout/src/events.ts`) with no
`cloudflare:workers` import, called from where it lived, and table-test each
in XC-099's node project. Keep the existing workerd tests unchanged as the
proof the moves were pure. This is a coverage item, not a speed one.

## Acceptance criteria

- [ ] Each rule named in Problem has a table test in its Worker's
      `test/unit/`, running in the node project.
- [ ] Both `index.ts` files still export only `default`; existing workerd
      tests pass unchanged.
- [ ] XC-098's coverage line for each Worker rises on this PR, with the
      before and after numbers in Notes.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream C4 of the test-pyramid plan.
