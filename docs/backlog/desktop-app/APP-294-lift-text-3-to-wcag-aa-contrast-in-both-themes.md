---
id: APP-294
title: Lift `--text-3` to WCAG AA contrast in both themes
priority: P2
effort: XS
component: desktop-app
status: in-review
related: [APP-225, APP-281]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-15
updated: 2026-11-15
---

## Problem

The tertiary text token `--text-3` in `app/desktop/src/styles.css` is under
WCAG AA's 4.5:1 for body text in both themes. It colours real text, not just
decoration: `h2` section labels, `.eyebrow`, nav counts, `.account-line`,
`kbd`, `.md .keywords`, step timings and every input placeholder (about 39
uses). Measured against the surfaces it sits on:

| Theme | `--text-3` | `--bg` | `--bg-side` | `--bg-raised` | `--bg-hover` |
|---|---|---|---|---|---|
| Dark | #76777e | 4.27:1 (#0f1011) | 4.09:1 (#121614) | 3.78:1 (#1c1d21) | 3.78:1 (#1a1e1c) |
| Light | #8f9098 | 3.10:1 (#fcfcfd) | 2.89:1 (#f2f5f3) | 3.18:1 (#ffffff) | 2.76:1 (#ecf0ed) |

APP-225 and APP-281 both closed with this gap deferred to its own item.
`--text-2` passes (dark 6.2:1 on raised, light 5.8:1 on the sidebar).

## Proposed approach

- Pick new `--text-3` values for the light `:root` block and the dark
  `@media (prefers-color-scheme: dark)` block that reach 4.5:1 on `--bg`,
  `--bg-side`, `--bg-raised` and `--bg-hover`, while staying visibly quieter
  than `--text-2`. Roughly #6b6c73 light and #8b8c93 dark; confirm by
  measurement and by eye against `docs/design-principles.md`.
- Add a unit test next to the APP-281 token test in
  `app/desktop/test/unit/app.test.cjs` that parses both token blocks from
  `styles.css`, computes the WCAG relative-luminance ratio, and fails when
  `--text-1`, `--text-2` or `--text-3` falls under 4.5:1 on any of those
  surfaces.

## Acceptance criteria

- [ ] `--text-3` measures at least 4.5:1 on `--bg`, `--bg-side`, `--bg-raised`
      and `--bg-hover` in light and in dark.
- [ ] `--text-3` stays lighter-weight than `--text-2` (a lower ratio on `--bg`)
      in both themes, so the three-step text ramp survives.
- [ ] A unit test reads both token blocks from `styles.css` and fails if any
      text token drops under 4.5:1 on those surfaces.
- [ ] `design-review` run; dark and light screenshots of a screen with section
      labels, nav counts and a placeholder attached to the PR.

## Notes

Filed 2026-11-15 from the in-review close-out. Measurements are from the
2026-11-13 close-out of APP-225, rechecked on main 2026-11-15 and extended
to `--bg-side` and `--bg-hover`.
