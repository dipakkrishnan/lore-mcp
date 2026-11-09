---
id: APP-063
title: Test the renderer's untrusted-text boundary and its CSP
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-066, APP-010, APP-008]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-03
updated: 2026-10-28
---

## Problem

Memory content, publication drafts and agent replies are untrusted text — a
memory body is written from whatever an agent read in a session — and
`markdown()` in `app/desktop/src/renderer.js` renders them by assigning
`marked.parse(text)` to `innerHTML`, then scrubbing the result: it drops
`href`s that aren't `http(s)`, adds `target`/`rel` to the ones that stay, and
removes every `<img>`. `marked` does not sanitize, so that ad-hoc pass is the
only markup filtering in the renderer.

What actually holds the line is defence in depth around it: the CSP in
`index.html` (`default-src 'self'; script-src 'self'` with no `unsafe-inline`,
`object-src 'none'`, `connect-src 'none'`, `form-action 'none'`, `base-uri
'none'`) plus `contextIsolation: true`, `sandbox: true`, `nodeIntegration:
false`, and the `setWindowOpenHandler` that denies every in-app navigation and
hands http(s) to the system browser.

**Not one of those properties is asserted by a test.** Nothing fails if a
future change adds `'unsafe-inline'` to `script-src` for a style tweak,
relaxes `frame-src` for an embed, drops the img removal, or flips a
`webPreferences` flag while chasing a bug. The CLI half of the same boundary
is explicitly tested — `tests/test_ui.py` opens by saying memory content is
untrusted and the card renderer is "a security surface, not decoration" — and
the desktop renderer, which puts the same text into a DOM, has no equivalent.

## Proposed approach

Two tests, at the two layers that matter:

1. **A static assertion** over `index.html` and `main.cjs`: the CSP directives
   are present with the values above, and the window is created with
   `contextIsolation`/`sandbox` on and `nodeIntegration` off. Cheap, runs
   under `node --test`, and is what catches a quiet loosening in review.
2. **A rendering test** over `markdown()` with hostile input — inline event
   handlers, `javascript:` and `data:` hrefs, embedded frames and objects,
   raw `<style>` — asserting what survives into the DOM. Reachable either by
   extracting `markdown()` into a module with an injected document, or from a
   renderer persona under Electron (see `APP-066`).

Decide as part of this whether the ad-hoc scrub should become an allowlist
sanitizer. The test comes first either way — it's what makes that decision
checkable.

## Acceptance criteria

- [x] A test fails if the CSP loses any of its current directives or gains
      `unsafe-inline`/`unsafe-eval`.
- [x] A test fails if `contextIsolation`, `sandbox` or `nodeIntegration` is
      changed on the main window.
- [x] `markdown()` has tests over hostile input pinning exactly what reaches
      the DOM, including a non-http href and an embedded frame.
- [x] The window-open handler is tested: in-app navigation denied, http(s)
      handed to the system browser.

## Notes

Found while auditing desktop test coverage (2026-09-03). Filed as a test gap,
not as a live vulnerability: the CSP and the sandbox flags are correct as they
stand, and script tags assigned through `innerHTML` don't execute. The point
is that all of that is currently held by convention rather than by anything
that fails when it changes.

**Prioritization 2026-10-19:** promoted to `ready`. No open blockers, no commit on main implements it, and the acceptance criteria are concrete and checkable. Priority and effort unchanged.

**Completed 2026-10-28.** `app/desktop/test/boundary.test.cjs` pins all four criteria:

- CSP: index.html must carry exactly one CSP meta whose directive map equals today's, and no directive may name
  `unsafe-inline`, `unsafe-eval`, `unsafe-hashes`, `wasm-unsafe-eval` or `*`.
- Main window: `createWindow` is cut out of `main.cjs` as text (it cannot be required outside Electron, the same reason
  `ipc-contract.test.cjs` reads it as text) and run in `node:vm` against a recording `BrowserWindow`. The test asserts
  `contextIsolation`/`sandbox` on, `nodeIntegration` off, and the preload path. It also asserts that the window-open
  handler denies every URL and hands only http(s) to `shell.openExternal`, and that `will-navigate` is prevented.
- `markdown()`: moved verbatim into `src/markdown.js`, its own classic script loaded just before `renderer.js`. The only
  change is `el()` → `document.createElement`, so the file can run alone; `types.d.ts` declares the global.
  `support/markdown-probe.cjs` loads marked and `markdown.js` into a hidden sandboxed Electron window, the way
  `credential-roundtrip.cjs` is driven. The test pins the exact `innerHTML` for 22 inputs: `javascript:`, `data:`,
  `file:` and relative hrefs in inline, reference, autolink, upper-case and entity-obfuscated forms; an attribute
  breakout; images; raw block and inline `<iframe>`, `<object>`, `<img onerror>`, `<svg onload>`, `<script>`, `<style>`
  and a raw `<a>`. The probe test is darwin-only, like the other Electron spawns, and runs in CI's `desktop-check`
  (macos-14); it takes about 2 s.
- 13 mutations, each loosening one of these properties, all fail the file.

**Raw HTML never reaches the scrub.** `marked.use({ renderer: { html: () => "" } })` drops every raw block and inline
tag before the href/img pass runs, so the embedded-frame cases are held by that override. The test names this, and
deleting the override fails it.

**Allowlist sanitizer: not adopted.** With raw HTML dropped whole, only marked's own output reaches the DOM. That output
is a closed set of tags, and the scrub already handles the two that carry URLs (`a`, `img`). A sanitizer would add a
dependency to guard a set marked already closes. The test is what makes a switch checkable if marked's output grows.

Not covered: the publication-preview window's `webPreferences` (`javascript: false`, same flags) in `main.cjs`, since
the criteria name the main window. The `.github/workflows/tests.yml` comment saying `renderer.js` has no unit coverage
is now partly stale; it was left alone because #559/#560 edit that file.
