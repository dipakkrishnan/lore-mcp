---
id: APP-178
title: Walk the desktop sign-in cancel, needs-permission, nothing-found and Disconnect paths in the CI edge scenario
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-125, APP-128, APP-060, CAP-009, XC-057, CAP-025, APP-179]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

The `connectors` edge scenario (`app/desktop/support/edge.cjs:303-470`,
run in CI by `tests.yml`) covers connect, import, feed refusal, a slow
feed cancelled, Read again, and a Granola sign-in that succeeds and one
that fails after the stub is stopped. It does not walk: **Cancel during a
sign-in** (`main.cjs:125-133` aborts the CLI; `state.cjs:229` must show
"Signing in was cancelled" and the loopback must be released — only the
feed cancel at `:400-409` exists); a source in `needs_permission` (the row
offers "Open System Settings", `renderer.js:~1200-1222`); a
`nothing_found` row's wording; and the Disconnect confirm sheet with
"Disconnect" (keep) vs "Delete them too" — that lives in the `obsidian`
scenario (`:297-301`), which is **not in CI**. The Manage sheet must also
never show an approval URL.

## Proposed approach

Extend the `connectors` scenario; no new scenario, so the CI job list is
unchanged.

### Files

- change `app/desktop/support/edge.cjs` (connectors branch)
- change `app/desktop/support/edge.sh` (a second Granola stub that never
  answers the sign-in, see below)
- change `tests/fixtures/granola.py`: a `--hang` flag that makes
  `list_tools` block for 60 s, so the CLI sits in "waiting" and Cancel is
  meaningful (the OAuth loopback itself is not reachable from the stub;
  the wait on `list_tools` is the same abort path)

### Test design (edge checks, `check(name, ok)`)

1. Sign-in cancel: point `LORE_GRANOLA_SERVER` at the hanging stub, click
   "Sign in to Granola", wait for the sheet's waiting text, click Cancel
   → the sheet shows `Signing in was cancelled`, no Granola row is added,
   and the CLI child is gone (`lore` process count via `ps` in the
   check, or the IPC promise rejects within 2 s). Then point at the normal
   stub and sign in successfully to prove the app recovered (one connect
   in flight at a time, `main.cjs:122-147`).
2. Needs permission: create a vault, connect it, `chmod 000` the vault,
   click Read again → the row's state text is what the renderer maps for
   `needs_permission` and the "Open System Settings" button is visible;
   `chmod 755` back, Read again → Connected. (On the CI runner the user is
   not root; guard with a check that `fs.accessSync` fails before
   asserting.)
3. Nothing found: connect an empty folder → row wording for
   `nothing_found` (assert the exact string the renderer uses, read from
   `renderer.js` in the check so a copy change fails here, not silently).
4. Disconnect keep vs delete: Manage → Disconnect → confirm sheet text
   `Disconnect <label>?` with two buttons; choose keep → row gone,
   notice says memories kept; reconnect, Disconnect → "Delete them too" →
   notice says deleted; memory count in `desktop-state` drops.
5. Manage never shows a URL: after a Granola sign-in, open Manage → the
   sheet's text contains no `http`.

Screenshots (`shot(...)`) for each new state as the scenario already does.

## Acceptance criteria

- [ ] `support/edge.sh connectors` passes locally and in CI with the five
      new checks; each failure names its check.
- [ ] The hanging stub is the existing `granola.py` with a flag, started
      and stopped by `edge.sh` like the current one.
- [ ] No check depends on wall-clock beyond the existing `waitFor`
      tries; the cancel check resolves within 2 s of the click.
- [ ] `cd app/desktop && npm test && npm run check` pass; Python suite
      unaffected.

## Notes

Covers: W-09 (desktop sign-in sheet cancel), W-16 (Disconnect confirm
wording, kept/deleted notice — now in CI), W-17 (desktop Cancel → abort →
"Signing in was cancelled"; Manage never shows URL), W-20
(`needs_permission` and `nothing_found` row wording), C-26, C-27, C-28,
C-34; APP-128's cancellable connect for the sign-in case.

Flakiness/safety: the stub is local; `PYTHON_KEYRING_BACKEND` stays the
null keyring so the runner's Keychain is never touched. The `chmod`
steps are restored in the scenario's cleanup.
