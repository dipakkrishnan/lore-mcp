---
id: XC-004
title: Run tests and checks in CI on every pull request
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [XC-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

There is no CI in this repository — no `.github/` directory at all. Every check
is manual and therefore optional: the Python suite (`python -m unittest discover
-s tests`), and, since the Cloudflare canary landed, `worker/`'s `tsc --noEmit`
and its `npm run smoke` MCP smoke test. Nothing runs on a pull request, so a
green review means "a reviewer read it", not "the suite passed".

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
2. **worker** — `npm ci` in `worker/`, then `npx tsc --noEmit`, then the smoke
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
- [ ] `worker/` is typechecked and its smoke test runs against a locally served
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
