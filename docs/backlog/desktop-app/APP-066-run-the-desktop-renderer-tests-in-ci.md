---
id: APP-066
title: Run the desktop renderer's persona tests in CI
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-054, APP-055, APP-056, APP-057, APP-007, XC-004, XC-014]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-03
updated: 2026-10-20
---

## Problem

`app/desktop/src/renderer.js` is only reachable through real Electron, via the
`support/edge.cjs` personas behind `npm run test:edge`. When this item was filed
nothing in CI ran them. Since then `desktop-check` in `.github/workflows/tests.yml`
gained seven walks (`feedback`, `connectors`, `faq`, `seller`, `store`, `agents`, and
`connectors` in dark), but `test:edge` has 20 personas, so 14 were still attended-only:
`provision`, `jobs`, `fresh`, `obsidian`, `reading`, `schedule`, `checkin`, `quiet`,
`automations`, `sell`, `cards`, `sales`, `settings`, `today`.

That gap had already cost something. On 2026-10-20 `automations` failed two checks on
main: APP-229 (`61db3c0`, 2026-10-19) folded Today's new memories into one card and
updated other walks, but not this one, because nothing ran it.

## Proposed approach

Give every `test:edge` persona its own step in `desktop-check` (no second workflow,
per `XC-004`), so a red step names the persona. Bring the stale `automations` checks
up to the folded Today card. Add a test that fails when a persona is added to
`test:edge` without a CI step, so the gap cannot reopen. Say in
`app/desktop/README.md` which suites CI runs and that `test:capture` stays attended.

Out of scope: `npm run test:capture`, which prompts the operator for Return.

## Acceptance criteria

- [x] `desktop-check` runs every `test:edge` persona on every pull request,
      and a deliberate renderer regression fails the job.
- [x] The job needs no provider or Cloudflare credential to pass.
- [x] The harness's failure output identifies which persona and which named
      check failed, from the CI log alone (each persona is its own step; `edge.sh`
      prints `FAIL <check name>`).
- [x] `app/desktop/README.md` states which desktop suites CI runs and that
      `test:capture` stays attended.

## Notes

Raised while auditing what tests exist for the desktop app (2026-09-03).
`tests/test_ui.py`, despite the name, tests the CLI's terminal card renderer
(`lore/ui.py`), not the Electron app — it is not a substitute here.

The harness was built under `APP-054` ("A persona harness (`npm run test:edge`)
drives these under Electron") and grew personas under `APP-055`/`APP-056`/
`APP-057`, then a fourth under `APP-007` (PR #209); wiring it into CI was never
part of any of those items' acceptance. That it keeps growing while
`desktop-check` keeps running three commands is the argument for this item —
each new persona adds coverage nothing enforces.

If the personas prove too slow or flaky to gate every PR, the fallback is to
run them on pushes to `main` plus a `workflow_dispatch`, and treat that as a
partial close rather than silently dropping the check.

Renumbered from `APP-058` to `APP-066` on 2026-09-03 before merge: this item
was filed as `APP-058` from a branch cut before PR #214 landed
`APP-058-measure-the-alpha-activation-funnel.md` on `main`. That item merged
first and keeps the id. Same race as the `APP-054` collision resolved in the
same pull request — two branches each taking "highest on `main` plus one"
while the other is open.

**Prioritization 2026-10-19 (corrected in review):** not promoted; partly shipped,
and the Problem section above is stale. `desktop-check` in
`.github/workflows/tests.yml` (lines 67-78) already runs `support/edge.sh` for
`feedback`, `connectors`, `faq`, `seller`, `store` and `agents`, each with a 5
minute timeout (`1f0b864` XC-003 #334, `347769b` #473). `npm run test:edge` runs 20
personas, so 14 are still not wired into CI: `provision`, `jobs`, `fresh`,
`obsidian`, `reading`, `schedule`, `checkin`, `quiet`, `automations`, `sell`,
`cards`, `sales`, `settings` and `today`. Before promoting, rewrite the Problem and
acceptance criteria around that remaining gap (and whether those personas are
deterministic enough to gate every PR), and check `app/desktop/README.md` for the
"which suites CI runs" statement, which is not there yet.

**2026-10-20 (implementation):** ran the 14 unwired personas twice locally on a Mac:
all pass both times with identical check counts, slowest 45 s (`automations`), after
fixing the two stale `automations` checks. Added `test/ci-edge.test.cjs`, which
passes on the real workflow and fails naming the persona when a step is removed.
Criteria 1 and 2 were confirmed on the PR (#514): `desktop-check` ran all 21 persona
steps green on the macOS runner, which has no secrets configured, in 16m24s (about 8 min
before). A regression failing the job is shown by `automations`, which exited non-zero
on its two stale checks before they were fixed; `edge.sh` exits 1 on any non-PASS line. The rewritten Problem section replaces the original
filing text, which predated the six walks already in CI.
