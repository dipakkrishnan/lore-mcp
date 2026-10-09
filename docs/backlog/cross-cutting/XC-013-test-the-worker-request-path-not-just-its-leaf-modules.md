---
id: XC-013
title: Test the Worker's request path, not just its leaf modules
priority: P2
effort: M
component: cross-cutting
status: completed
related: [XC-003, XC-004, MCP-001, MON-002, MON-003, MON-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-31
updated: 2026-10-09
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

- [x] A test that runs without a deployed node asserts: `tools/list` matches
      the canonical tool contract; `discover` succeeds unpaid and quotes
      `PRICE_USD` alongside the teaser manifest; `get` called unpaid returns a
      402 challenge carrying x402 payment requirements, and no publication
      content — title, content, or topic — appears anywhere in that challenge.
- [x] A Worker whose `LORE_WALLET` is missing or malformed fails to serve rather
      than serving for free.
- [x] The test runs under `tests/gate.py` alongside the existing Worker checks,
      and fails the gate when the behavior regresses.
- [x] `scripts/smoke.ts` and this test assert the same tool list from one
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

**Completed 2026-10-09.** `lore/node/test/request-path.test.ts` drives the
Worker's `fetch` handler in workerd and holds the four criteria:

- *Before payment.* `tools/list`, free `discover` quoting `PRICE_USD`, and the
  402 an unpaid `get` returns: one `exact` payment requirement for the
  deployed price, paid to `LORE_WALLET`, with the piece's title, content and
  topic nowhere in the result, no call to the facilitator's `/verify` or
  `/settle`, and no sale recorded. The test seeds its own piece so the "nothing
  leaks" check cannot pass on fixture wording.
- *No wallet.* With `LORE_WALLET` missing, empty, malformed, or a private key,
  an MCP `initialize` and a client connect both fail with the `payTo` error,
  so no tool is reachable; the same request succeeds before and after. The
  test sets the binding on the `env` object the Durable Object reads. That
  proves the MCP server cannot be built without `payTo` passing; it is not a
  second Worker deployed without the secret.
- *What the wallet does not guard.* The store pages (`/`, `/p/<id>`,
  `/p/<id>.json`, `POST /p/<id>/free`) never build the MCP server, so they
  answer without a wallet. The test holds them to the teaser only. Free copies
  and card receipts hand over a piece on those routes by design, and neither
  needs a wallet; if that should change, it is a new item, not this one.
- *The gate.* `tests/gate.py` runs `npm test` in `lore/node`, which picks the
  file up by glob; CI does not call the gate script, and its `node-component`
  job runs the same `npm test`. Three deliberate regressions each turned the
  file red and were reverted: giving every unpaid `get` a free copy (the 402
  test), a `payTo` that never throws (all four wallet cases), and dropping
  `result` from the shared tool list (the tool-list test).
- *One definition.* `lore/node/scripts/surface.ts` holds the tool names and
  the catalog-entry keys; `scripts/smoke.ts` and the test both import it, and
  the test fails when the names drift from `contracts/mcp_tools.json`. The
  smoke script cannot read that JSON itself, because the copy `lore node
  deploy` materializes has no `contracts/`. Copies left alone on purpose: the
  name list in `test/answer-disabled.test.ts`, the key list in
  `test/paid-path.test.ts`, and `EXTRAS` in `src/answer-state.ts`, which is
  the source the Worker serves from.

Smoke alignment found one real gap: the script required exactly `id`, `kind`,
`teaser`, `updated_at` on every entry, but `discover` adds `sample`,
`useful_if` and `not_useful_if` when the owner wrote them, so the script
failed against any node selling a piece with a sample. It now uses the shared
key check. Neither CI seed (`seed_worker_smoke.py`, `qa-fixtures.sql`) has a
piece with a sample, so only the workerd test covers that branch.

On a loaded machine the first test in several older files
(`paid-path`, `card`, `pages`, `views`) can time out at 15s on a cold Worker,
on untouched `main` as well. The new file spends that wait in a `beforeAll`
with its own 30s budget; the older files are unchanged.
