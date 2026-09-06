---
id: APP-091
title: Say a For Sale list's shared state once, and offer the push beside it
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-081, APP-072]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

After a push failed, For Sale showed seventeen rows each wearing a "Not
live yet" chip under a heading that read "17 publications · 17 not on your
store yet", and the only Push button sat in the store bar above the fold.
Seventeen identical chips read as something broken, and the remedy was
not next to the statement of the problem (dogfood 2026-09-05).

## Proposed approach

Show a per-row chip only when the rows differ. When they are all in one
state, the heading says it once, and when anything is waiting, the
heading carries a "Push to your store" link next to that count.

## Acceptance criteria

- [x] A list where every row is in the same state shows no chips; a mixed list keeps them.
- [x] The heading reads "none on your store yet" when nothing is live, the waiting count when some are, and "all on your store" when everything is.
- [x] "Push to your store" sits in the heading whenever something is waiting, and shows "Pushing…" disabled while a push runs.

## Notes

Done 2026-09-05. The store bar keeps its own Push button; the heading's
is the same action within reach of the list.
