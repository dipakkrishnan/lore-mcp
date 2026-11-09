---
id: XC-105
title: Split pure planners out of _push, snapshot.build and deploy
priority: P2
effort: L
component: cross-cutting
status: completed
related: [XC-096, XC-104]
blockers: [XC-096]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-09
---

## Problem

The Python suite's 1,019 tests are almost all component tests: handlers
called against a real SQLite store under a temp home. `tests/test_cli.py`
(3,291 lines) is about 15% argv end-to-end, 80% handler-level against the
store, and 5% pure. That is because the production modules mix decisions
with I/O in single functions. `lore/cli.py:2566 _push` does about ten Store
reads, the selling policy, SQL building (`_push_sql`, already pure and
tested), a tempfile, the `npx wrangler d1 execute` subprocess, job
bookkeeping, `forget_live()` and `_bind_card_store()` in one body.
`lore/snapshot.py:209 build` wraps a Store block, a network probe
(`_live_state` via `urlopen`), wall-clock caching through a Store setting and
`Path.home()` around what is otherwise pure assembly. `lore/deploy.py:649
deploy` combines validation, `shutil.which("npm")`, Store reads, an env flag
and the subprocess chain. `cli.py:1838 attended_folder` and `:1919
_attended` read `pwd.getpwuid`, an env var and `sys.stdin.isatty()`
directly. `lore/ui.py:9` freezes `COLOR` at import. `lore/usage.py:175`
starts a thread per event. Every rule in those functions can only be tested
by arranging the world around it.

## Proposed approach

In the order XC-096's per-file coverage report ranks the files, extract a
pure planner from each and leave the original as a thin executor:
`plan_push(state) -> PushPlan` (what SQL, which tables, whether selling,
which job record) with `_push` executing it; `assemble(rows, live_state,
now) -> Snapshot` with `build` fetching and calling it; a pure
`deploy_preconditions(...)` returning the first refusal or none; make
`attended_folder` and `_attended` take their inputs as parameters with the
current call sites passing the live values; make `ui.COLOR` a function;
give `usage` an injectable sender. Each extraction ships with a table test
in a new `tests/test_<module>_rules.py` file, and the existing handler tests
stay as the component tier.

## Acceptance criteria

- [x] `plan_push`, `assemble` and `deploy_preconditions` exist, take plain
      data, perform no I/O, and each has a table test file.
- [x] `attended_folder`, `_attended`, `ui.COLOR` and the usage sender take
      their environment as parameters or injected callables.
- [x] Per-file coverage of `cli.py`, `snapshot.py` and `deploy.py` does not
      fall on any PR of this item, read from XC-096's table.
- [x] `tests/test_cli.py` is not rewritten; new tests go in new files.
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it. The kept walks still
      exercise `snapshot.build` end to end through the app, which is the
      regression check for that extraction.

## Notes

- Workstream D2 of the test-pyramid plan. Decision recorded here rather
  than as its own item: `tests/test_cli.py` stays as it is. Its
  handler-level tests against a real tmp store are good component tests and
  rewriting 3,291 lines would buy nothing the floor does not already prove.
- `lore/cli.py` is 2,882 lines with 51 `with Store()` and 74 `print(` sites;
  the extractions above are the first three, not the whole list. File
  follow-ups as the coverage table points at them.
- 2026-11-09, delivered by PR #654 (merged `74aff845`), checked against main
  `bdada87f`:
  - Planners: `plan_push(state, *, local, opening) -> PushPlan`
    (`lore/cli.py:2741`, `PushPlan` at `:2684`), `assemble(rows,
    live_state, surroundings)` (`lore/snapshot.py:321`, called by `build` at
    `:313`) and `deploy_preconditions(...)` (`lore/deploy.py:935`, returns
    the first refusal or `None`, called by `deploy` at `:899`). Each takes
    plain data; table tests in `tests/test_push_plan.py`,
    `tests/test_snapshot_assemble.py` and `tests/test_deploy_preconditions.py`.
  - Environment as parameters: `attended_folder(account_home=None)`
    (`cli.py:1915`), `_attended(key, *, terminal, launch_keys)`
    (`cli.py:2000`), `ui.COLOR()` evaluated per call (`lore/ui.py:13`), and
    `usage`'s sender looked up at send time and injectable
    (`lore/usage.py:188`). Tests: `tests/test_attended_rules.py`,
    `tests/test_ui_color.py`, `tests/test_usage_rules.py`; `tests/test_ui.py`
    updated for `COLOR()`.
  - Coverage, #654's before/after on the gate table (statements / branches):
    `cli.py` 95.8/90.2 -> 95.9/90.4, `snapshot.py` 97.9/96.9 -> 98.3/96.9,
    `deploy.py` 97.7/93.3 -> 98.0/94.1. #654 is the item's only PR. On
    `bdada87f`, `gate.py --python-only --ignore=tests/integration` reads
    95.9/90.4, 98.3/96.9 and 97.8/93.5. `deploy.py` is untouched since #654;
    its 0.2/0.6 point gap is XC-097's #655 moving the real `npm install`
    test into `tests/integration/`, which that gate leaves out: run with
    the integration tier included (`-k "not real_uv_install"`, 1,125
    passed), `deploy.py` reads 98.0/94.1, the same as #654's after.
  - `tests/test_cli.py`: #654's diff does not touch it.
  - Layout scan: #654 touches only `lore/` and `tests/`, nothing under
    `app/`. The walks, which drive `snapshot.build` end to end through the
    app, passed on main afterwards (run 42566939852, walks step 424 s).
