---
id: APP-065
title: Measure the desktop app's test coverage
priority: P3
effort: S
component: desktop-app
status: in-review
related: [APP-058, APP-060, APP-061, APP-062, APP-063, APP-064, XC-003]
blockers: [APP-058]
dependencies: []
github_issue: null
created: 2026-09-03
updated: 2026-09-03
---

## Problem

Nothing measures what the desktop tests cover. `app/desktop/package.json` has
no coverage tool in `devDependencies` and no coverage script; `npm test` is
bare `node --test`. So "is this surface tested?" can only be answered by
reading `test/app.test.cjs` and `support/edge.cjs` against 2,700 lines of
`src/` by hand — which is how `APP-060` through `APP-064` were found, one
module at a time.

`lore/` doesn't have this problem: `XC-003` put a per-file 90% statement and
branch gate on the Python package, enforced by `tests/gate.py`. The Electron
app, which holds the owner's credentials and renders untrusted text, has no
equivalent number at all.

## Proposed approach

Add `c8` (or `node --experimental-test-coverage`, which needs no dependency)
to the desktop package and a `test:coverage` script, then report the number
before arguing about a threshold. `renderer.js` will read as near-zero until
the personas run under the same process — worth knowing, and worth reporting
separately from the main-process modules rather than averaging the two into
one meaningless figure.

Do not set a gate in the same pass. Land the measurement, publish the
baseline, and let a follow-up choose a floor that reflects what's reachable —
`main.cjs` and `runtime.cjs` have Electron-only and packaged-only paths that
no threshold should pretend to cover.

## Acceptance criteria

- [ ] `npm --prefix app/desktop run test:coverage` reports per-file coverage.
- [ ] The baseline is recorded in this item's `## Notes` and in
      `app/desktop/README.md`, split between main-process modules and the
      renderer.
- [ ] The item states which files are Electron-only or packaged-only, so a
      later gate can exclude them deliberately rather than by accident.

## Notes

Filed after the audit that produced `APP-060`-`APP-064` (2026-09-03) — those
were found by hand precisely because no tool would say. Blocked on `APP-058`:
measuring coverage is worth little until the renderer suite runs in CI, since
until then the renderer's number reflects whether someone remembered to run
`test:edge`, not what the tests cover.
