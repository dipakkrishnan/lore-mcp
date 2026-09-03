---
id: APP-051
title: Fix the storage-location row's layout — long paths crush the label column
priority: P2
effort: S
component: desktop-app
status: in-review
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-09-02
updated: 2026-09-02
---

## Problem

The "Where it lives" row on the settings/shape screen
(`src/renderer.js:514`) renders the full absolute `LORE_HOME` path in a
`.mono` span as the row's trailing value. `.row .v` is `flex-shrink: 0`
(`src/styles.css:253`), so that value never shrinks or wraps — on a long
path (e.g. a dogfood sandbox path like
`/var/folders/4y/6_bz7ln547jbbn8g2nrz9ty80000gn/T/lore-dogfood-new.KuLoeG/lore`)
all the row's flex compression instead lands on the label/description
column (`.t`, `src/styles.css:244`, which has `min-width: 0` but no
`flex-grow`), crushing "Where ... Everything stays on this Mac. Only what
you approve for sale ever leaves." into a narrow wrapped sliver next to a
full-width unbroken path.

## Proposed approach

Two independent fixes, likely both worth doing:
- **Layout**: give `.t` room to keep its normal width (e.g. `flex: 1` like
  `.sheet-head .t` already gets) and let the `.v` mono path wrap or truncate
  instead of forcing all the squeeze onto the label column.
- **Content**: a full absolute temp-dir path is rarely meaningful to an
  owner anyway. Consider showing a shortened form — last 1-2 path segments,
  or a `~`-relative path when it's under the real home directory — with the
  full path available via `title` (hover tooltip) or on click, rather than
  always rendering the complete absolute path inline.

## Acceptance criteria

- [ ] The "Where it lives" row's label/description text keeps a readable
      width regardless of how long the storage path is.
- [ ] A long path (verified against a real `dogfood:new` sandbox path) no
      longer crushes the label column into a narrow wrapped sliver.

## Notes

Reported by the owner while dogfooding (2026-09-02), with a screenshot of a
`dogfood:new` sandbox path squeezing the label column.
