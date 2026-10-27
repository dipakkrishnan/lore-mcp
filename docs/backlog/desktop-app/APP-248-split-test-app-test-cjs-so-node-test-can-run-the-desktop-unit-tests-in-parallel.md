---
id: APP-248
title: Split test/app.test.cjs so node --test can run the desktop unit tests in parallel
priority: P2
effort: S
component: desktop-app
status: completed
related: [XC-077, XC-072]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-27
---

## Problem

`npm test` in `app/desktop` (`package.json:9`, `node --test` with no flags)
takes a median 120 s in CI on `macos-14`, 70 s locally on a 10-core M2 Pro.
In CI run 40343764690 the per-test durations sum to 116.0 s against a
reported 115.8 s total, so the tests effectively run one after another.
The reason is the file layout: `node --test` runs files concurrently (the
default is `os.availableParallelism() - 1`, which is 2 on the 3-vCPU
runner) and runs top-level tests within a file serially, and 124 of the
143 top-level tests are in one file, `test/app.test.cjs` (3153 lines). The
other four files hold 1, 10, 4 and 4 tests and finish in seconds.

Turning on in-file concurrency is not an option. The file swaps the
module-global CLI runtime (`useRuntime(...)` at `test/app.test.cjs:23`, then
in 27 call sites such as `:157,165,707,727`, backed by `let runtime` at
`src/state.cjs:13,129`), swaps the launch-key folder (`useKeys`,
`app.test.cjs:22`, `state.cjs:116-119`), and mutates `process.env.HOME`
(`app.test.cjs:259,267`). Two tests in flight in one process would see each
other's runtime. Separate files are separate processes, so they are safe.

Where the time goes (CI log, the same run): the 15 darwin-gated tests
(`skip: process.platform !== "darwin"`, at `app.test.cjs:199,222,387,416,456,500,537,591,641,1057,1074,1701,1723,2148,2184`;
`:591` is a `todo`) take 31.8 s (27%): write/edit sandbox 12.1 s, read
sandbox 9.1 s, shell limit 3.1 s, safeStorage 2.4 s, Bash 1.8 s. The
tests whose names mention the CLI take 53.1 s; they spawn `uv run` per
call (`app.test.cjs:16-19`) and each spawn pays about 0.4 s to import
`lore.cli`. The rest is small.

## Proposed approach

Split `test/app.test.cjs` into 3-4 files grouped by the fixture they
share, so each file's wall time is close to the others' and the default
file concurrency can overlap them:

- `test/sandbox.test.cjs`: the 15 darwin-gated tests and the sandbox
  policy tests, with `sandboxed()` and `swapping()`
  (`app.test.cjs:171-197`) and `TASKS_ALL` (`:198`). Keep every
  `skip: process.platform !== "darwin"` as it is.
- `test/store.test.cjs`: the `openStore`/payout/confirm tests that use
  `recordingCli`, `recordPayout` and `confirming` (`app.test.cjs:673-696`).
- `test/agent.test.cjs`: the scripted-agent and check-in tests, with
  `scriptedAgent`, `until` and `checkInWith` (`app.test.cjs:2125-2143,2520`).
- `test/app.test.cjs` keeps what is left (updates, sales, appearance,
  renderer-contract tests and so on).

Move the per-process scratch setup (`app.test.cjs:10-23`: the `LORE_STORE`
`mkdtemp`, the null keyring, the `lore-keys-*` folder with its
`attended_cli.py` shim and `exit` cleanup, `useKeys`, `useRuntime(CLI)`)
into a helper each file requires first, so every process gets its own
store and keys and no file depends on another's state. Node's default
concurrency on the runner is 2 files at once, so either balance the files
to about 30 s each, or pass `--test-concurrency=3` in `package.json:9`
and measure both in the CI run; the CLI tests are CPU-bound Python
startups, so 3 at once on 3 vCPUs may not beat 2.

## Acceptance criteria

- [ ] `npm test` in `app/desktop` finishes in 55-70 s on `macos-14`,
      measured on one CI run of the change (baseline median 120 s).
- [x] The same tests pass: 143 top-level tests across the files, with
      146 pass + 1 todo in the summary as today (local run on
      2026-10-26: exit 0 in 70 s; CI run 40343764690: 115.8 s).
- [x] No test shares mutable globals across files: each file sets its own
      `LORE_STORE`, `lore-keys-*` folder, `useKeys` and `useRuntime`, and
      no test reads a value another file wrote.
- [x] The 15 darwin-gated tests stay gated and still run (not skipped) on
      the macOS job.

## Notes

- Done 2026-10-27. `test/app.test.cjs` (3153 lines, 124 top-level tests) is
  now four files grouped by shared fixture: `sandbox.test.cjs` (23 tests:
  the 15 darwin-gated ones, every `skip:` kept, with `sandboxed`,
  `swapping`, `TASKS_ALL`), `store.test.cjs` (25: openStore/payout/
  confirm and the CLI round-trips, with `recordingCli`, `recordPayout`,
  `confirming`), `agent.test.cjs` (49: scripted-agent turns, readings,
  check-ins, routines, agents, with `checkInWith`, `TODAY`) and
  `app.test.cjs` (27: the rest). The grouping is the balanced one from the
  plan, not the item's literal three-group suggestion, which measured
  40/19/2.5/5.5 s locally and would have left one file as the long pole.
- The per-process scratch (old lines 10-23) moved to
  `support/scratch.cjs`, which each test file requires before anything
  loads `src/state.cjs` (that module reads `LORE_STORE` once, on require).
  It exports `{ KEYS, CLI, readState }` and removes both its `lore-keys-*`
  and `lore-store-*` folders on exit. `scriptedAgent` and `until` are in
  `support/scripted.cjs`. Neither is under `test/` and neither is named
  `test-*`: `node --test` with no arguments matches `**/test/**/*.cjs` and
  `**/test-*.cjs`, so helpers named that way run as empty tests and change
  the pass count (a first cut as `support/test-scratch.cjs` reported 154
  tests instead of 152). `tsconfig.json` includes only `src`, so nothing
  type-checks the helpers, as before.
- `store.test.cjs` changes the two bare `useRuntime()` calls (old lines
  807, 832) to `useRuntime(CLI)`: they reset to the real `uv run lore`,
  dropping the attended-folder shim until the next `useRuntime(CLI)`,
  harmless while the next test ran no CLI but order-dependent once the
  real-CLI tests share the process.
- Local measurement (M2 Pro, 2026-10-27, after STO-006 cut each CLI
  spawn): `npm test` on main 45.2 s wall (`tests 152, pass 151, todo 1`);
  after the split 20.8 / 20.6 / 20.5 s over three runs, same totals, exit
  0, no `# SKIP`. Each file alone: sandbox 20.7 s, store 9.8 s, agent
  8.4 s, app 7.7 s, so the sandbox file is now the long pole; the plan's
  19/19/14/14 s was measured before STO-006 shrank the CLI-heavy groups.
  Moving a few darwin-gated tests out of `sandbox.test.cjs` would cut
  another few seconds, if anyone wants it.
- The `lore-sandbox-*` `ENOTEMPTY` teardown race (XC-072) is untouched; it
  did not show in any of the local runs.
- Rank 8 of 9 in the 2026-10-26 CI investigation's low-effort list; the
  C report's finding 5 and option C3 are the source, re-read against
  `main` @ d8530d95. The 55-70 s estimate extrapolates from a local run,
  so the first CI run of the split is the real number.
- The `lore-sandbox-*` `ENOTEMPTY` teardown race (XC-072, acceptance 3)
  is not changed by this item. `sandboxed()` already makes a fresh
  `lore-sandbox-*` directory per test (`app.test.cjs:173`) and each test
  removes its own in `finally` after `SandboxManager.reset()`
  (`:216-218,234-236` and so on), so the race is between a test and its
  own sandbox's writer, not between files. Splitting the file neither
  fixes nor shrinks it; running sandbox tests next to CLI tests on 3
  vCPUs may make it a little more likely, which is a reason to land
  XC-072's fix first or watch for it in the measuring run.
- `--test-concurrency` alone, without the split, does nothing: the
  investigation ruled it out because one file holds 124 of 143 tests.
- A later lever for the same 53 s is lazy-importing `mcp` in
  `lore/sources.py` (C2 in the investigation), which cuts about 60% off
  every CLI spawn in these tests and in the app. Independent of this item.
