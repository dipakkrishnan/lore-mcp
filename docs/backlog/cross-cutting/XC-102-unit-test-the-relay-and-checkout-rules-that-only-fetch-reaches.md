---
id: XC-102
title: Unit-test the relay and checkout rules that only fetch reaches
priority: P2
effort: S
component: cross-cutting
status: completed
related: [XC-099, XC-098]
blockers: [XC-099]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-09
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

- [x] Each rule named in Problem has a table test in its Worker's
      `test/unit/`, running in the node project.
- [x] Both `index.ts` files still export only `default`; existing workerd
      tests pass unchanged.
- [x] XC-098's coverage line for each Worker rises on this PR, with the
      before and after numbers in Notes.
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream C4 of the test-pyramid plan.
- **Where each rule went** (the relay lives at `feedback-relay/`, not `relay/`):
  - Relay `src/report-rules.ts`: method, content-type, the two-step body cap
    (`refuseDeclaredLength` then `refuseBody`), JSON parsing, the error
    mapping (`failure`) and the `/events` body (`readEvents`: size cap,
    JSON, `parseBatch`). Tested in `test/unit/report-rules.test.ts`.
  - Relay `src/quota-window.ts`: `claim(now, current, windows)`, the window
    maths `FeedbackQuota.take` used to do inline; the Durable Object now reads
    rows, calls it, writes back. `quota.ts` re-exports `WINDOWS`, so
    `test/limit.test.ts` is untouched. Tested in `test/unit/quota-window.test.ts`.
  - Checkout `src/token.ts` (`token`, `owns`, now taking the secret rather
    than `env`), `src/pricing.ts` (`takesCards`, `cents`), `src/receipt.ts`
    (/verify's body and its `paid` rule), `src/events.ts` (`route`,
    `bidCharge`, `failureMessage`), and `sessionFields` exported from
    `src/stripe.ts` (with the fee as a parameter, so the fee-on branch is
    testable while `APPLICATION_FEE_CENTS` is 0). Tested in
    `test/unit/{token,pricing,receipt,events,session-fields}.test.ts`.
  - `storeOrigin` and test-key gating (`keyFits`) had already moved to the
    pure `src/store.ts` (MON-054) before this item was picked up, so they are
    tested in place in `test/unit/store.test.ts` rather than moved to
    `origin.ts`.
- **Premise change on criterion 2:** neither `index.ts` ever exported only
  `default` — the relay exports `FeedbackQuota` (Durable Object) and
  `SiteEvents` (XC-120 entrypoint), checkout exports `BidCards` (MON-054), all
  required by the runtime. Read as "export nothing new": both export lists are
  unchanged and no rule is exported from an entry module. No file under
  `test/` outside `test/unit/` changed; the workerd projects run the same 64
  (relay) and 64 (checkout) tests and pass.
- **Coverage (XC-098 line, `npm run test:coverage`, istanbul over both projects):**
  - feedback-relay: statements 100% (192/192) → 100% (211/211), branches
    98.63% (145/147) → **100% (166/166)**, functions 100% (31/31) → 100%
    (41/41), lines 100% (168/168) → 100% (177/177). The two branches that
    were never taken were `parseBatch`'s "no-property event sent with a
    property" (now a `readEvents` row) and `json`'s unused `status` default
    (removed: every caller passes a status).
  - checkout: statements 96.22% (306/318) → **96.95% (318/328)**, branches
    92.07% (279/303) → **95.43% (293/307)**, functions 100% (64/64) → 100%
    (70/70), lines 97.17% (241/248) → **97.67% (252/258)**. What remains
    uncovered is `bids.ts` and the three `catch` arms in `webhooks.ts`,
    outside this item.
- **Tests:** relay node project 24 → 82 tests (4 files, ~130 ms); checkout
  node project 7 → 124 tests (8 files, ~200 ms). Whole suites: relay 88 → 146
  (~1.8 s), checkout 71 → 188 (~1.2–1.7 s). CI already runs
  `npm run test:unit` in both component jobs (XC-099), so tests.yml is unchanged.
- **Layout scan:** only `feedback-relay/` and `checkout/` changed; no desktop
  walk or view is touched.
