---
id: XC-101
title: Boot the Worker in at most seven test files
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [XC-099, XC-100]
blockers: [XC-099]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-12
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

- [x] At most seven files under `lore/node/test/` (outside `unit/` and
      `hosted/`) call `exports.default.fetch` or open an MCP session.
- [x] Every assertion from the merged files is present in its new home, test
      count unchanged.
- [ ] The `Node component tests` job is under 60 s over three consecutive
      green main runs (today 90 s).
- [x] If `fileParallelism` is flipped, the reason it is now safe is recorded
      in the config comment; if not, the blocker met is recorded in Notes.
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
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
- Premise correction: fourteen files booted the Worker, not thirteen, and the
  proposed merges left nine, not seven. `request-path` and `answer` both call
  `exports.default.fetch` too; their first test looked cheap only because a
  `beforeAll` pays the cold start. To reach seven, two more files were folded
  in: `request-path` (after taking in `views`, `pages`, `answer-disabled` and
  `mcp-contract`, as proposed) went into `paid-path`, the buyer's side
  before and after payment, and `signin` (XC-068) went into `agent` (XC-067),
  the owner's agents' endpoint. `answer-unready` went into `answer`, as
  proposed. The seven are `paid-path`, `answer`, `agent`, `card`, `free`,
  `collections` and `empty-store`.
- How the merges keep behaviour: each moved file's body is its own `describe`,
  so its file-level hooks (`request-path`'s piece and wallet reset,
  `answer-unready`'s binding reset, `signin`'s `Mac.pushed()` and sign-in
  wipe) stay scoped to its tests. Only shared helpers (`connect`, `textOf`,
  `workerFetch`, `visit`) were de-duplicated. `page views` runs before the
  store-page tests, because a view is counted after the response and a page
  opened just before would land in its count. Counted from source, the ten
  files before and the three after hold the same 273 `expect(`, 5 `expect.`,
  96 `it(` and 3 `it.each`; the workerd project still has 148 tests.
- `fileParallelism` is now `true`. It is safe because nothing crosses a file:
  `@cloudflare/vitest-pool-workers` 0.23 starts a Miniflare per test file
  (`NODE_DEBUG=vitest-pool-workers` logs 11 "Starting runtime" lines for 11
  files), so each file has its own workerd, D1 and isolate. The D1 seed, the
  `env.LORE_WALLET` mutation and the `globalThis.fetch` spies were already
  file-local; serial running was not what kept them apart. The reason is in
  `vitest.workerd.config.ts`'s comment, with the instruction to set it back to
  `false` if cold starts begin timing out. Locally 3 of 3 parallel runs passed.
- Measured locally (Node 25, M-series Mac), before -> after:
  - workerd project (`vitest run --project workerd`): 18 files / 148 tests,
    57.7 s -> 11 files / 148 tests, 33.3 s serial (the merges alone) and
    9.5-10.4 s with parallel files (three runs).
  - `npm run test:coverage` (node + workerd): 33 files / 406 tests, 58.9 s ->
    26 files / 406 tests, 18.9 s. The hosted run is unchanged (18 tests, 2 s).
  - Coverage is unchanged: statements 96.83% (918/948), branches 91.42%
    (597/653), functions 97.26% (284/292), lines 98.38% (793/806), and every
    file's entry in `coverage-summary.json` is identical before and after.
- CI, `Node component tests` on main before this change (runs 42570213129,
  42570854056, 42572100253, 42572962023, 42573468736, 42573916648): job
  111-189 s, its `test:coverage` step 50-86 s. On this PR (run 42575255200):
  job 101 s, `test:coverage` step 32 s (vitest's own duration 25.4 s for the
  node and workerd projects, 2.9 s for hosted), coverage 918/948 statements as
  before. The criterion's three consecutive green main runs can only be read
  after merge, so it stays open, and with it this item. It is unlikely to be
  met as written: on that run about 69 s of the job is outside the test step
  (checkout, setup-node, `npm ci`, the unit tier, the coverage summary), more
  than the whole 60 s budget. The job's "90 s today" looks like it already
  included that floor. The test step, which this item can move, went from
  50-86 s to 32 s. The criterion likely needs restating against the test
  step, for example "the `test:coverage` step is under 40 s".
- Comments that named the removed files now name their new homes
  (`scripts/smoke.ts`, `scripts/surface.ts`, two `test/unit/` headers). One
  outside `lore/node` still names `lore/node/test/mcp-contract.test.ts`: the
  docstring of `tests/test_mcp_contract.py`. That check now lives in
  `paid-path.test.ts` under "before anyone pays"; the docstring is left for a
  change that may touch `tests/`.
- Layout scan: the diff is confined to `lore/node` (tests, the two vitest
  configs, comments in two scripts), this file and `INDEX.md`; no desktop walk
  or view is touched.

**Backlog audit (2026-11-12), moved to in-review:** PR #677 did the work,
and four of five criteria are met on main. The remaining one, a job under 60
s, cannot be met by this item: green main runs on 2026-11-12 took 105-128 s,
of which the test step was only 29-39 s, and the rest is setup this item
cannot change. Moved back to in-review to restate that criterion against the
test step (for example under 40 s), which current runs already meet, and
then close it.
