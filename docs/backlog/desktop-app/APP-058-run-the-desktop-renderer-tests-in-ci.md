---
id: APP-058
title: Run the desktop renderer's persona tests in CI
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-054, APP-055, APP-056, APP-057, XC-004, XC-014]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-03
updated: 2026-09-03
---

## Problem

Nothing automatic exercises `app/desktop/src/renderer.js`. The `desktop-check`
job in `.github/workflows/tests.yml` runs `npm run check`, `npm test` and
`npm run package`; `npm test` is `node --test` over `test/app.test.cjs`, which
covers main-process and state logic (`readState`, `openable`, the Bash sandbox,
credential storage, session records, the CLI action boundaries) and never
touches the DOM. The only tests that drive the rendered UI are the three
`support/edge.cjs` personas — `seller`, `provision`, `store` — behind
`npm run test:edge`, and they run only when a person remembers to.

That harness is where the launch-week UI guarantees live: a draft edit
surviving repeated `changed` events, Enter in a title moving focus instead of
saving, the two-stage `open_url` card, notices landing on the view that fired
them, the sales ledger summing and linking to Basescan, standing Push rows,
root capture joining an unfinished thread. Every one of those is a regression
CI would currently let through — a green PR means the main process still works
and the app still packages, not that the owner-facing surface still renders.

## Proposed approach

Add `npm run test:edge` to the `desktop-check` job in
`.github/workflows/tests.yml` (do not add a second workflow — `XC-004` settled
that). The job already runs on `macos-14` with `setup-uv` and `npm ci`, which is
what `support/edge.sh` needs to seed its scratch `LORE_HOME` via
`uv run lore capture apply` / `publication draft`, and `provision()` is a no-op
when the app is not packaged, so no wheel or Python install is involved.

Two things to prove or fix before it can be a required check:

1. **No secrets.** `window.__lore.signIn()` fakes an Anthropic credential, so
   rendering needs no provider key — but the `store` persona submits the
   composer to reach a real agent turn. Confirm that check passes with no
   credential configured, or narrow it so it asserts the thread-joining
   behavior without needing a model.
2. **Determinism.** `edge.cjs` paces itself with fixed sleeps and
   `waitFor(..., 40)` polls, and `edge.sh` greps stdout for `PASS`/`FAIL`. Run
   it enough times on a runner to know it isn't flaky, and keep the exit code
   (already non-zero on any non-PASS line) as the signal.

Out of scope: `npm run test:capture`, which prompts the operator for Return and
cannot be automated as-is. Say so in `app/desktop/README.md` so the next reader
doesn't try.

## Acceptance criteria

- [ ] `desktop-check` runs all three `test:edge` personas on every pull
      request, and a deliberate renderer regression fails the job.
- [ ] The job needs no provider or Cloudflare credential to pass.
- [ ] The harness's failure output identifies which persona and which named
      check failed, from the CI log alone.
- [ ] `app/desktop/README.md` states which desktop suites CI runs and that
      `test:capture` stays attended.

## Notes

Raised while auditing what tests exist for the desktop app (2026-09-03).
`tests/test_ui.py`, despite the name, tests the CLI's terminal card renderer
(`lore/ui.py`), not the Electron app — it is not a substitute here.

The harness was built under `APP-054` ("A persona harness (`npm run test:edge`)
drives these under Electron") and grew personas under `APP-055`/`APP-056`/
`APP-057`; wiring it into CI was never part of those items' acceptance.

If the personas prove too slow or flaky to gate every PR, the fallback is to
run them on pushes to `main` plus a `workflow_dispatch`, and treat that as a
partial close rather than silently dropping the check.
