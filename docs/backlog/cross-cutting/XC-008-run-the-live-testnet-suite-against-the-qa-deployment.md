---
id: XC-008
title: Run a live testnet suite against the QA deployment
priority: P2
effort: M
component: cross-cutting
status: in-review
related: [XC-004, XC-007, MON-002, MON-007, MON-008, MCP-002]
blockers: [XC-004, MON-008]
dependencies: ["Base Sepolia buyer wallet with a monitored faucet balance", "GitHub repository secrets for the buyer key"]
github_issue: null
created: 2026-08-01
updated: 2026-08-01
---

## Problem

Some failures only exist in the deployed world, and this repository has no place
that observes them. A mocked facilitator (`MON-007`) proves the Worker's logic; a
typecheck proves it compiles. Neither can catch the real x402.org facilitator
changing its response shape, a settlement that confirms on-chain but arrives too
late for the request, D1 behaving differently at the edge than in local
`workerd`, or a deploy that boots to a runtime error — the class of failure
`XC-004` already documents from the `LORE_WALLET` module-scope read.

Today the only thing that would notice any of these is a person running
`npm run smoke -- <url>` and `npm run pay` by hand, remembering to, and having a
funded wallet at that moment. `smoke.ts` says so itself: "not wired into CI".

So the last mile — the paid path against a real chain — is verified once per
`MON-002`-style manual effort and never again.

## Proposed approach

A live job that runs against the QA deployment `MON-008` stands up. Not on every
pull request: it spends test money, depends on third-party uptime, and would
teach people to ignore a red build.

1. **When it runs** — after the QA deploy on merge to `main`, on a daily
   schedule, and on manual dispatch before a release. Never on pull requests,
   and never on forks.
2. **What it asserts** — the full buyer journey against the live URL:
   `discover` is free and returns seeded fixture titles; `answer` challenges;
   `worker/scripts/pay.ts` settles a real Base Sepolia payment; the receipt comes
   back in `_meta["x402/payment-response"]`; the paid response contains the
   fixture content. Then the fail-closed cases that are safe to run live: an
   invalid credential and a replayed credential.
3. **Distinguish "broken" from "out of gas".** Check the buyer's balance before
   spending and fail with a distinct, obvious message when the faucet has run
   dry. A live suite that reports a funding problem as a regression gets muted
   within a week.
4. **Cap the spend.** Keep `pay.ts`'s existing per-call cap, and bound the number
   of paid calls per run so a retry loop cannot drain the wallet.

## Acceptance criteria

- [ ] A scheduled and merge-triggered job completes a real Base Sepolia payment
      against the QA deployment and asserts the receipt and the served content
- [ ] The job never runs on pull requests or forks, and the buyer key is a
      repository secret that no other job can read
- [ ] An exhausted or unfunded buyer wallet fails the run with a message naming
      funding as the cause, distinct from an assertion failure
- [ ] A run is bounded to a known maximum number of paid calls, with the existing
      per-call spend cap intact
- [ ] A failure names which stage broke — deploy, discover, challenge,
      settlement, or content — rather than only that the suite failed
- [ ] The README's development section documents how to run the same suite
      locally against QA, and what it costs

## Notes

This is the sixth and last tier of the CI pipeline sketched in `XC-004`'s notes:
compile, lint, unit, contract, component, live. Each tier below it exists so this
one can stay small — by the time a change reaches here, the only untested things
left should be the facilitator, the chain, and the deployment itself.

Flake policy matters more than coverage here. Third-party testnet infrastructure
will have bad days. Decide up front whether a live failure blocks a release or
opens an issue, and write that down in the item's implementation rather than
leaving it to whoever is on call the first time x402.org is slow.

`MCP-002`'s contract check is the natural neighbour of this job: if the Python
surface and the Worker surface disagree, the live suite is the first place a
buyer-visible difference becomes observable.
