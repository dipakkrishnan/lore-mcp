---
id: XC-121
title: Package the desktop app on Node 24 until electron-forge finishes on Node 26
priority: P0
effort: XS
component: cross-cutting
status: in-progress
related: [XC-111, XC-082, XC-083]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-02
updated: 2026-11-02
---

## Problem

`Desktop macOS checks` is red on main since 2026-11-02 (run 41387246365, the
XC-111 merge) at its last step, "Packaged whisper is the pinned tag":
`cat out/Lore-darwin-arm64/Lore.app/Contents/Resources/whisper/version: No
such file or directory`. The same step passed on the same code on 2026-10-30
(run 41114041681) and fails identically on PRs #612 and #614. The cache was
hit in every case and `npm run package` exited 0 in 14-21 s each time. The
difference is Node: `actions/setup-node` with `node-version: lts/*` gave
24.22.1 on Thursday and 26.13.0 today, and under Node 26 electron-forge
7.11.2's log stops at "❯ Finalizing package" with none of the "✔ Copying
files", "✔ Finalizing package", "✔ Packaging application" or "postPackage
hook" lines the Node 24 run prints. Forge exits early, silently and with
status 0, so the only step that notices is the whisper check, and it says
"no such file" rather than "no app". Everything else in the job (unit tests,
all 21 walks) passed on both Node versions.

## Proposed approach

Pin the desktop job's `node-version` to `24` (the LTS line the app was
packaged with until today) and leave the Linux jobs on `lts/*`, where Node
26 is green. Make the whisper check say what happened: if the app bundle is
missing, fail with `::error title=no packaged app` naming the path, and only
then compare versions. Record the forge-on-Node-26 behaviour here so the pin
is lifted deliberately, by a later item that upgrades forge or reproduces the
early exit, not by `lts/*` moving again.

## Acceptance criteria

- [ ] `Desktop macOS checks` on main passes "Packaged whisper is the pinned
      tag" again, on Node 24, with the cache hit and 21/21 walks.
- [ ] A missing app bundle fails the check with an error annotation that
      names the missing path and says no app was packaged, distinct from the
      stale-whisper message.
- [ ] Notes record the Node versions and run ids on each side, so whoever
      lifts the pin knows what to re-test.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Found 2026-11-02 while merging the test-pyramid phase-0 PRs: #612 and #614
  showed the same red step as main, and both their agents traced it to the
  step rather than their changes.
- The local development machine runs Node 25.5.0 and packages fine, so the
  early exit is specific to Node 26 or to 26.13.0; a forge upgrade (7.11.2
  is pinned in `app/desktop/package.json`) is the likely lift.
