---
id: XC-108
title: Set coverage floors and guard the walk budget and the view table
priority: P2
effort: S
component: cross-cutting
status: completed
related: [XC-098, APP-266, APP-270, XC-099, XC-096]
blockers: [XC-098, APP-266, APP-270]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-09
---

## Problem

A pyramid only stays one if something refuses the first eighth walk, the
first Worker test that sneaks `cloudflare:workers` into the node project,
and the first view that quietly stops being scanned. The old
`test/ci-edge.test.cjs` guarded one such property (every persona had a CI
step) until XC-077 replaced it; nothing guards the shape the test-pyramid
plan builds. And the coverage numbers XC-098 reports are advisory until a
floor makes them binding.

## Proposed approach

Three guards and a set of floors. Floors: from XC-098's first weeks of
numbers, set a statement and branch floor per Node package a few points
under the measured value, enforced in that package's CI job the way XC-096
enforces Python's. Guard one, in `app/desktop/test/unit/walks-budget.test.cjs`:
fail if `support/walks.cjs` has more than seven entries or its `seconds`
sum exceeds 450, unless the PR adds a one-line note in the walks file naming
the item that allows it. Guard two, in each Worker's node project: fail if
any `test/unit/` file imports `cloudflare:workers` or `cloudflare:test`
(XC-099 may already add this; then it is confirmed here). Guard three, the
view table: a test reads APP-266's seven-walk table and edge.cjs's `shot()`
calls and fails if any view in the table is no longer scanned by its named
walk at its named width. Editing the table is the only sanctioned way to
change scan coverage, and the diff shows it.

## Acceptance criteria

- [x] Each Node package's CI job fails below a per-package statement and
      branch floor recorded in its config, with the number and date in Notes.
      (lore/node, feedback-relay, checkout: `coverage.thresholds` in their
      vitest configs; app/desktop: `coverageFloor` in package.json. Numbers
      below. site and bridge have no coverage run, so no floor.)
- [x] A PR that adds an eighth walk, or pushes the `seconds` sum past 450,
      without a note fails the walks-budget test.
      (Run 42586372371, below.)
- [x] A PR that imports `cloudflare:workers` from a node-project test fails.
      (Run 42586381915, below. XC-099's guard already did this in all three
      Workers; confirmed here, not added.)
- [x] A PR that removes a scanned view from a kept walk without editing the
      table fails the view-table guard; the three cases are shown on a
      throwaway branch and the run links recorded in Notes.
      (Run 42586667848, below.)
- [x] Layout scan: this item adds the guard that protects scan coverage;
      no view scanned before this change is unscanned after it.
      (The diff touches neither edge.cjs nor views.json. With the change in
      place the walks read "25 of 25 views in views.json scanned this run
      (114 shots, 92 again at 900 px)", the same line as main at 808a33d8,
      run 42584807851.)

## Notes

- Workstream E2 of the test-pyramid plan.
- 2026-11-09, implementation, on main at 808a33d8.
- **Floors.** Each floor was set from main's CI run 42584807851, about 0.5 to
  1 point under the measured number. The same numbers came out of a local
  `npm run test:coverage`. A floor is never above the measured number, and no
  file was excluded to meet one. Each config says never to lower it.

  | Package (config) | Measured statements / branches | Floor |
  |---|---|---|
  | lore/node main Worker (`vitest.config.ts`) | 96.83% (918/948) / 91.42% (597/653) | 96 / 90.5 |
  | lore/node hosted Worker (`vitest.hosted.config.ts`) | 94.41% (186/197) / 86.27% (132/153) | 93.5 / 85.5 |
  | feedback-relay (`vitest.config.ts`) | 100% (211/211) / 100% (166/166) | 99 / 99 |
  | checkout (`vitest.config.ts`) | 96.95% (318/328) / 95.43% (293/307) | 96 / 94.5 |
  | app/desktop (`package.json` `coverageFloor`) | lines 90.59% (4543/5015) / 87.53% (1874/2141) | 89.75 / 86.75 |

  lore/node gets two floors because it is two Workers with two reports
  (XC-098 partitioned src/ between them). vitest enforces the Workers'
  floors itself: `npm run test:coverage` exits 1 below one, as a local run
  with checkout's statement floor raised to 97 showed ("Coverage for
  statements (96.95%) does not meet global threshold (97%)"). So the
  existing test steps in CI enforce them, and the workflow only gained a
  comment there. The desktop's floor is on the union of its two tiers' lcov
  files, which only `.github/scripts/coverage_summary.py` computes.
  The script gained `--floor CONFIG`, tested in
  `tests/test_coverage_summary.py`. It reads the `coverageFloor` block, and
  below the floor, or with no report to read, it prints an `::error` and
  exits 1. The desktop job's coverage step passes `--floor package.json` and
  is renamed "Coverage line and floor in the step summary". A per-tier
  floor (`node --test --test-coverage-lines`) would have failed every time
  a test moved from the component tier to the unit tier, which is the move
  the pyramid plan makes, so it was not used.
  node:test counts lines, not statements, so the desktop floor is on lines.
  Its branch total also moves a little between runs: 2141 on main's run,
  2116 on proof run 42586381915 (87.76%). The 0.78-point margin covers that.
  site has no coverage run (`npm test` only) and bridge has none
  (`tsx scripts/test.ts`), so neither has a floor. Setting one up is a
  measurement item first, as XC-098 was for the others.
- **Walks budget** (`app/desktop/test/unit/walks-budget.test.cjs`).
  walks.cjs runs its walks as soon as it is loaded, so the test reads its
  source as views.test.cjs does. It counts the `{ name: ... }` entries in
  `WALKS` and sums their `seconds`. The default budget is 7 walks and 450
  seconds. The escape is one line in walks.cjs:
  `// walks-budget: <ITEM-ID> allows <N> walks and <S> seconds: <why>`.
  The named item must be a file under docs/backlog/. Its figures replace the
  defaults rather than waiving them, so one walk or one second past them
  still fails, and raising them shows in the diff. Two notes fail. A note
  the walks already fit under without it gets a diagnostic, not a failure,
  so a parallel PR that brings the sum down is not broken by it.
  **Premise change:** main already breaks the default. APP-270's refreshed
  `seconds` sum to 480 (192 + 98 + 63 + 43 + 31 + 30 + 23). So walks.cjs
  carries `// walks-budget: APP-271 allows 7 walks and 480 seconds`.
  APP-271 is the item making the kept walks cheaper, and it should delete
  the line once the sum is 450 or less.
- **View-table guard** (the last two tests in
  `app/desktop/test/unit/views.test.cjs`). APP-266's staleness tests already
  caught a shot() deleted outright, since its label leaves edge.cjs. They
  did not catch a shot() moved out of the walk the table names, because the
  label survives elsewhere. The new `reach()` reads edge.cjs line by line
  and follows its scenario chains:
  - `if (scenario === "x") {`, `} else if (["a", "b"].includes(scenario)) {`
    and `} else {`, each closed by a `}` at the chain's indent;
  - an `else` runs every scenario its chain did not name;
  - a shot() outside every branch is reached by all scenarios.

  The guard fails when a views.json row's walk, or a dead scenario, no
  longer reaches a label the row lists. Widths need no separate check here:
  shot() scans every NARROW walk at both widths, and the existing widths
  test holds each row to NARROW. Limits: the read is static, so a shot()
  behind another condition (DARK) counts as reached. A shot() in a helper
  defined outside the branches counts for every walk. A negated scenario
  condition makes the test stop and say so. `edgeLabels()` now takes an
  optional source, so this guard and the APP-266 tests read labels one way.
  If APP-271 changes how shot() is spelled, both follow.
- **Proof runs**, one throwaway branch and draft PR each, cut from this PR's
  commit. All three draft PRs are closed and their branches deleted.
  - Walks budget, #680, branch `xc-108-proof-walks`:
    https://github.com/dipakkrishnan/lore-mcp/actions/runs/42586372371.
    The branch deleted the note and added an eighth walk of 5 s. Both tests
    failed in "Desktop macOS checks": "walks.cjs lists 8 walks; the budget is
    7" and "the walks' seconds sum to 485; the budget is 450".
  - View table, #681, branch `xc-108-proof-views`:
    https://github.com/dipakkrishnan/lore-mcp/actions/runs/42586667848.
    The branch moved `shot("faq")` from the checkin branch to the settings
    branch with views.json unchanged. Only the new guard failed: "faq:
    checkin no longer shoots faq". APP-266's six tests passed.
  - cloudflare:workers import, #682, branch `xc-108-proof-cloudflare`:
    https://github.com/dipakkrishnan/lore-mcp/actions/runs/42586381915.
    The branch added `lore/node/test/unit/proof.test.ts`. "Node component
    tests" failed in its unit step: guard.test.ts reported "proof.test.ts"
    reaching `cloudflare:workers`. Every other job passed, including the
    full desktop job with this item's changes: floor met, 7/7 walks,
    "25 of 25 views".
- The workflow edits are limited to the floor. The desktop coverage step
  gained `--floor package.json` and its new name. Three Worker test steps
  gained a comment saying their coverage run now fails below the floor. No
  job was renamed.
- Checks run locally:
  - `npm run lint`, `npm run check` and `npm run test:coverage` in
    lore/node, feedback-relay and checkout;
  - `npm run check`, `npm run test:unit` (414 pass) and the coverage tiers
    in app/desktop;
  - ruff, mypy and pytest on the coverage script and its tests.
