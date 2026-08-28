---
id: XC-013
title: Test the Worker's request path, not just its leaf modules
priority: P2
effort: M
component: cross-cutting
status: ready
related: [XC-003, XC-004, MCP-001, MON-002, MON-003, MON-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-31
updated: 2026-08-28
---

## Problem

`XC-003` brought the Worker in `lore/node/` from zero checks to four: `tsc
--noEmit`, `wrangler deploy --dry-run`, and unit tests over `src/price.ts` and
`src/wallet.ts`. What it did **not** reach is the thing the Worker exists to do
— serve a free `discover` manifest, challenge an unpaid `get` with a 402, and
never leak the paid publication content inside that challenge.

That behavior is asserted today only by `scripts/smoke.ts`, which needs a
running or deployed node and only runs when a human remembers to run it (or as
the last step of `lore node deploy`). Nothing catches a regression before a
deploy. This matters more as `MON-003` moves real publications behind that gate:
the failure mode stops being "the canary broke" and becomes "the node served
paid content for free", which no type check can see.

## Proposed approach

The working vehicle is `lore/node/test/`: it runs in workerd through
`@cloudflare/vitest-pool-workers` against the real `wrangler.jsonc`, and CI
already executes it. Drive `exports.default.fetch` through the MCP client, as
the existing contract and paid-path tests do, and keep the resulting assertions
aligned with `scripts/smoke.ts`.

## Acceptance criteria

- [ ] A test that runs without a deployed node asserts: `tools/list` matches
      the canonical tool contract; `discover` succeeds unpaid and quotes
      `PRICE_USD` alongside the teaser manifest; `get` called unpaid returns a
      402 challenge carrying x402 payment requirements, and no publication
      content — title, content, or topic — appears anywhere in that challenge.
- [ ] A Worker whose `LORE_WALLET` is missing or malformed fails to serve rather
      than serving for free.
- [ ] The test runs under `tests/gate.py` alongside the existing Worker checks,
      and fails the gate when the behavior regresses.
- [ ] `scripts/smoke.ts` and this test assert the same tool list from one
      definition, or the duplication is deliberate and noted (see `MCP-002`,
      which wants one source of truth for the tool surface).

## Notes

Scope boundary: `scripts/pay.ts` is deliberately out. It spends faucet funds
against a live facilitator, which is an integration concern (`MON-002`), not
something a unit test should reach.

`XC-004` (CI) should run `tests/gate.py --require-node` so the Worker checks
cannot be silently skipped on a machine without a Node toolchain — the mode that
exists precisely so a Python-only contributor is not blocked locally.

**2026-08-03:** `MON-010` landed `lore/node/test/` — a real component suite
that calls the Worker's actual `fetch` handler (via `exports.default.fetch`
from `cloudflare:workers`, stubbing only the x402 facilitator) under
`@cloudflare/vitest-pool-workers`, and it passes. That is exactly the kind of
call this item's blocker (the `ajv`/CJS loader crash) was expected to break on.
Path 1 above (try a newer pool/wrangler version, or check whether the crash is
specific to how the entry point is invoked) is worth revisiting with
`lore/node/test/` as a working reference before assuming the blocker still
applies.

**Audit 2026-08-04:** promoted `ideation` → `in-review` — has a concrete
`## Problem` and a checklist of acceptance criteria, so it's ready for a
prioritization pass rather than needing further ideation work.

**Prioritization pass 2026-08-26:** No formal blockers; the CJS/ajv loader issue is the problem being investigated, not a blocker on someone else's item, and `MON-010`'s working precedent (noted below) gives the first path to try. Promoted `in-review` → `ready`.

**2026-08-28:** Consolidated the older leaf tests into the already-working
`lore/node/test/` suite and deleted the duplicate `tests/node/` package. The
loader dependency is no longer current; this item now owns only any remaining
request-path assertions and smoke-test alignment.
