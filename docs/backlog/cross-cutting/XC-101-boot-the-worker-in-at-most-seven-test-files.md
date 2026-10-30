---
id: XC-101
title: Boot the Worker in at most seven test files
priority: P1
effort: S
component: cross-cutting
status: ready
related: [XC-099, XC-100]
blockers: [XC-099]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

In `lore/node`, the first test in every file that calls
`exports.default.fetch` pays a 3-5 s Worker cold start (CI run 40893275772:
`views` 5.1 s, `card` 5.2 s, `pages` 5.1 s for a plain GET of `/`,
`answer-disabled` 4.4 s, `empty-store` 4.3 s, `mcp-contract` 4.3 s for its one
test, `free` 4.3 s, `signin` 4.2 s, `paid-path` 3.1 s, `collections` 3.1 s,
`answer-unready` 2.6 s); later tests in the same file take 10-350 ms. Thirteen
files boot the Worker, so about 60 of the suite's 65 s of test time is boot.
With `fileParallelism: false` the boots are serial.

## Proposed approach

Merge the small Worker-boot files into the ones that already cover their
surface: `views`, `pages` and `answer-disabled` into `request-path`, along
with the description and required-args comparison from `mcp-contract` (which
`request-path.test.ts:93-108` half-does already); `answer-unready` into
`answer`. Keep `paid-path`, `card`, `signin`, `empty-store`, `collections`,
`agent` and `free` as the seven component files. Then, and only then, try
`fileParallelism: true` with isolated storage, fixing the shared seed in
`test/setup.ts`, the `env.LORE_WALLET` mutation and the `globalThis.fetch`
spy if they are what breaks; revert if cold starts time out as MCP-003 saw.

## Acceptance criteria

- [ ] At most seven files under `lore/node/test/` (outside `unit/` and
      `hosted/`) call `exports.default.fetch` or open an MCP session.
- [ ] Every assertion from the merged files is present in its new home, test
      count unchanged.
- [ ] The `Node component tests` job is under 60 s over three consecutive
      green main runs (today 90 s).
- [ ] If `fileParallelism` is flipped, the reason it is now safe is recorded
      in the config comment; if not, the blocker met is recorded in Notes.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream C3 of the test-pyramid plan. Expected saving 25-30 s from the
  merges alone.
- Decision recorded here rather than as its own item: the `worker-smoke` CI
  job stays. It is the only check that publications written by a real
  `lore push --local` (via `.github/scripts/seed_worker_smoke.py`) are what
  the Worker's `discover` returns; the vitest suite seeds a hand-copied
  schema in `test/setup.ts` that can drift. Nothing in this plan replaces
  it.
