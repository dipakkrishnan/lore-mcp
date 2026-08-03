---
id: XC-004
title: Run tests and checks in CI on every pull request
priority: P1
effort: S
component: cross-cutting
status: ready
related: [XC-003, XC-007, XC-008, MON-010, MCP-002]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-08-03
---

## Problem

**Partly landed.** PR #50 added `.github/workflows/tests.yml`, which runs the
Python suite via `astral-sh/setup-uv` on every pull request and on pushes to
`main`. What follows described the state before that, and the second half of it
is still true.

The node side is still unchecked by anything automatic: `lore/node/`'s `tsc
--noEmit` (`npm run check`) and its `npm run smoke` MCP smoke test run only when
a person remembers to run them. For that half of the repository, a green review
still means "a reviewer read it", not "the suite passed".

This already cost something. The canary shipped reading `LORE_WALLET` from
`process.env` at module scope; `process.env` is populated lazily on first
`process` access, so a deployed Worker could have booted with an empty value —
and the failure mode is the runtime refusing to start at all. A `tsc` +
`wrangler dev` + smoke job would have surfaced it before review, since the
smoke test fails outright when the Worker can't construct.

`XC-003` is also affected: it specifies a 90% coverage gate and its own notes
concede the gate is local-only without CI, which makes it a suggestion rather
than a floor.

## Proposed approach

One workflow (`.github/workflows/ci.yml`) triggered on `pull_request` and pushes
to `main`, with two independent jobs:

1. **python** — `astral-sh/setup-uv`, `uv sync`, `uv run python -m unittest
   discover -s tests`. Once `XC-003` lands, this is also where its per-file
   coverage check hangs.
2. **worker** — `npm ci` in `lore/node/`, then `npx tsc --noEmit`, then the smoke
   test. The smoke job needs a `.dev.vars` containing a placeholder
   `LORE_WALLET` (any syntactically valid EVM address): it is what `wrangler
   types` reads to declare the binding, and the Worker refuses to construct
   without it. Use a burn address, never a real one.

Deliberately out of scope: deploying anything, and any job that needs
Cloudflare or CDP credentials. CI should prove the code builds and the free
path works; it must not hold keys that can move money.

## Acceptance criteria

- [ ] A workflow runs on every pull request and on pushes to `main`
- [ ] The Python suite runs and a deliberately broken test fails the run
- [ ] `lore/node/` is typechecked and its smoke test runs against a locally served
      Worker, with a placeholder wallet supplied by CI rather than a secret
- [ ] The README's development section names the same commands CI runs, so
      local and CI checks cannot drift
- [ ] No job requires a deployment credential or a funded wallet

## Notes

`XC-003` anticipated this item explicitly: "Wiring it into GitHub Actions is
worth a separate item — an unenforced threshold decays." Filed as that item;
`XC-003` owns *what* is measured, this owns *that it runs*.

Sized `S` on the assumption CI only runs what already exists. If the worker job
turns out to need a Cloudflare account even for `wrangler dev` in CI, drop that
job to `tsc` only rather than adding credentials, and note it here.

### Where this sits in the full pipeline

Ideation pass on 2026-08-01 scoped an end-to-end pipeline of six tiers. This item
is the root — it creates the workflow the first five hang off — but it only
covers three of them. The rest are separate items:

| Tier | Covered by | Runs on |
|---|---|---|
| 1. Compile | this item (`tsc --noEmit`) | every PR |
| 2. Lint | `XC-007` — no linter exists in the repo yet | every PR |
| 3. Unit | this item; `XC-003` adds the coverage gate | every PR |
| 4. Contract | `MCP-002`'s drift check between the two MCP surfaces | every PR |
| 5. Component | `MON-010` — Worker paid path vs. a mocked facilitator | every PR |
| 6. Live | `XC-008` against the QA deployment `MON-008` stands up | merge, schedule, manual |

Tiers 1-5 stay inside this item's boundary: credential-free, fork-safe, no money.
That boundary is load-bearing, so tier 6 lives in its own workflow with its own
secrets rather than as another job here. `MON-008` is the first thing in the repo
to hold a deploy credential.

Two further gates were added to the pipeline on 2026-08-03. They check the pull
request itself rather than the code in it, so they are not tiers in the sequence
above and do not belong in this item's jobs:

| Gate | Covered by | Checks |
|---|---|---|
| PR title | `XC-010` | title is `BACKLOG-ID: summary`, and the id exists |
| Review count | `XC-011` | required approvals scale with what the diff touches |

Prioritization pass 2026-08-01 raised this to `P0` and `ready`, on the rationale
that the repository had no CI at all and this was the `S`-effort item every other
check hangs off.

Revised 2026-08-03, back to `P1`: PR #50 landed the Python half, so the "no CI at
all" urgency is spent. It stays `ready` and stays the pipeline root — the
remaining scope still unblocks `XC-007`, `XC-009`, and `XC-008`, and still gives
`MON-010`'s suite somewhere to run — but the most valuable half is already
merged.

### What is done and what is left

| Acceptance criterion | State |
|---|---|
| Workflow runs on every PR and on pushes to `main` | done (`tests.yml`) |
| Python suite runs; a broken test fails the run | done |
| `lore/node/` typechecked, smoke test run with a placeholder wallet | **not started** |
| README development section names the same commands CI runs | **not started** |
| No job needs a deployment credential or funded wallet | holds |

Two notes for whoever finishes it. The shipped workflow is named `tests.yml`
rather than the `ci.yml` this item proposed — keep the existing name and add jobs
to it rather than introducing a second file, since `XC-007`, `XC-009`, and
`MON-010` all expect one place to hang off. And it runs `uv run python -m
unittest discover -s tests -v` directly, without a separate `uv sync` step.
