---
id: XC-035
title: Show a diff for flagged publications in Desktop
priority: P1
effort: M
component: cross-cutting
status: ideation
related: [XC-019, MON-004, APP-006, APP-011]
blockers: [XC-019]
dependencies: []
github_issue: null
created: 2026-09-22
updated: 2026-09-22
---

## Problem

XC-019 wants a flagged publication to show the owner *what* changed, not just
that something did, and its second (higher) bar is: never show a flag without
a diff between the approved-time source text and the current text. The
desktop Store/Today surfaces that would host this were fully removed in PR
#121 (`needsYou()` and `renderStore()` in `app/desktop/src/renderer.js` carry
zero references to `source_changed_at`, flags, or reapprove today), and the
data path feeding them was removed with it: `Store.publication_inventory()`
doesn't select `source_changed_at`, `snapshot.py:build()` doesn't surface it,
and `types.d.ts`'s `PublicationItem` has no field for it. There's also no
`reapprove` IPC counterpart to the existing `revoke` handler.

## Proposed approach

Once XC-019 lands the Python-side snapshot (source fingerprint/content
recorded at approval time) and the CLI-side grouping/diff logic, wire the
same data into the desktop app: extend `publication_inventory`'s query and
`types.d.ts` to carry `source_changed_at` + the changed-memory's name/author/
date + enough to compute or receive a diff, add the missing `reapprove` IPC
(preload.cjs + main.cjs, mirroring the existing `revoke` handler), and add a
grouped "Changed" section to `renderStore()`/`needsYou()` with an actual diff
view — not the old un-explained flag PR #121 removed for being noisy. This is
new UI, not a restore: the diff-rendering and group-by-cause logic have no
prior implementation to copy from (existing sections group by flat state).

## Acceptance criteria

- [ ] A flagged publication row on Store and the Today summary names the
      changed memory, its author, and the change date.
- [ ] The same row/section shows a diff of the source text between approval
      time and now, for publications with a recorded snapshot.
- [ ] Publications flagged by the same memory change are grouped for one
      Re-approve / Take-down decision.
- [ ] Existing flags with no snapshot degrade to name/author/date only, no
      crash or empty diff view.
- [ ] Copy does not imply the owner edited the memory when an agent did.

## Notes

Split off from XC-019 during a 2026-09-22 implementation attempt: a scoping
pass (see XC-019's own notes) found the desktop half is not a "wire the
existing IPC back up" job — PR #121 removed both the UI and the data
plumbing feeding it, and the new diff/grouping requirement has no precedent
in `renderer.js`'s hand-rolled DOM-builder code. Rough estimate from that
pass: ~150-250 new/changed lines in `renderer.js` alone, plus ~60-80 lines of
snapshot/types/IPC wiring — a near-M effort on its own, not foldable into
XC-019's Python/CLI M without under-delivering one side or the other.
