---
id: APP-195
title: Open each tab at the top and say a store update where it happened
priority: P2
effort: XS
component: desktop-app
status: in-review
related: [APP-139, APP-190]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

From the Oct 6 pre-release pass: switching tabs kept the last view's scroll
position (For Sale opened at the bottom); saving a price on For Sale gave no
confirmation, while "Your store is updated" appeared later inside unrelated
threads; and a publish thread whose drafts were all skipped still ended on
"ready for your approval below".

## Proposed approach

Reset the scroll on every tab switch; show the store-updated note on For
Sale too, and clear it on leaving the view or opening a thread; close a
thread whose last card was skipped with "Skipped. Nothing new is for sale."

## Acceptance criteria

- [x] Each tab opens at its top.
- [x] A price saved on For Sale confirms there, and the note doesn't follow.
- [x] A thread with every draft skipped ends on a line that says so.
