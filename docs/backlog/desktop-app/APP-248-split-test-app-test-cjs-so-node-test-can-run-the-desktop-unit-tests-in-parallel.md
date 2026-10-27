---
id: APP-248
title: Split test/app.test.cjs so node --test can run the desktop unit tests in parallel
priority: P2
effort: S
component: desktop-app
status: ready
related: [XC-077, XC-072]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
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
- [ ] The same tests pass: 143 top-level tests across the files, with
      146 pass + 1 todo in the summary as today (local run on
      2026-10-26: exit 0 in 70 s; CI run 40343764690: 115.8 s).
- [ ] No test shares mutable globals across files: each file sets its own
      `LORE_STORE`, `lore-keys-*` folder, `useKeys` and `useRuntime`, and
      no test reads a value another file wrote.
- [ ] The 15 darwin-gated tests stay gated and still run (not skipped) on
      the macOS job.

## Notes

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
