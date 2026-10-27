---
id: APP-247
title: Fold the dark-appearance connectors walk into the light one
priority: P2
effort: S
component: desktop-app
status: ready
related: [XC-077, APP-066, APP-225]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

The `Desktop macOS checks` job runs the `connectors` persona twice: once
light (`.github/workflows/tests.yml:72-73`) and once with
`LORE_EDGE_APPEARANCE: dark` (`tests.yml:112-115`). The second run costs a
median 52 s of macOS runner time per CI run (54 s over the last 3 green
`main` runs), plus its own Electron launch, seeding and a Granola stand-in
server (`support/edge.sh:204-224`).

What the dark run adds is small. `LORE_EDGE_APPEARANCE` is read in two
places: `edge.sh:16` writes it into `appearance.json` before launch, and
`support/edge.cjs:9` sets `DARK`. The app's boot reads that file and sets
`nativeTheme.themeSource` (`src/main.cjs:50,545`, `src/appearance.cjs:27-29`).
Inside the harness, `DARK` is read at exactly one place outside the settings
walk: the first check after load, `edge.cjs:667`, "the window is drawn dark,
as kept" (`nativeTheme.shouldUseDarkColors === DARK` and the page's `--bg`
token equals `#141613`). The connectors branch itself (`edge.cjs:1084-1261`)
never reads `DARK`, so all 46 of its own `check()` calls run identically in
both passes. The only other difference is indirect: the 13 `shot()` calls each run
the layout check twice (connectors is in `NARROW`, `edge.cjs:611`), and the
layout check's one colour-dependent step is `paintsAt` (`edge.cjs:493-498`),
which reads `backgroundColor` to decide whether a box covers what is under
it. So the dark pass buys: one boot-time check that a kept `dark` choice is
applied on launch, and 26 layout checks in dark colours that differ from the
light ones only where a token flips between transparent and opaque. It also
writes 26 dark PNGs to `$root` (`edge.cjs:639,646`), which nothing consumes:
`tests.yml` has no upload step and `edge.sh:259` only prints the folder.

Dark rendering is already exercised elsewhere every run. The settings walk
switches Appearance live from the Settings radio and the account-menu switch
(`edge.cjs:1509-1537`), asserts the `--bg` token and `themeSource` after
each flip, and takes dark screenshots (`settings-appearance-dark`,
`account-menu-dark-mode-on`). `test/app.test.cjs:3025-3046` covers
`Appearance.read/set/apply` against a fake theme. APP-225's acceptance line
"CI walks connectors in dark" (`docs/backlog/desktop-app/APP-225-dark-mode.md:50-52`)
is the only reason the second step exists.

## Proposed approach

Two small moves, keeping every assertion the dark run makes:

1. **Keep the boot-time dark check, on the cheapest walk.** Move the
   `env: LORE_EDGE_APPEARANCE: dark` from the second connectors step to the
   `faq` step (`tests.yml:74-75`, 9 s median). Every walk runs the
   `edge.cjs:667` check, and `faq` is the only other DARK-independent
   branch short enough to not matter; nothing in its branch
   (`edge.cjs:1262-1299`) reads `DARK`, so its 2 screenshots and the rest of
   its checks are unchanged. That keeps the one assertion only a dark launch
   makes (a kept `dark` overrides a light Mac at boot, `main.cjs:545`) at no
   added runner time. `provision` (8 s) would do too, but its first screen is
   the failed-setup banner; `faq` paints a normal signed-in page.
2. **Re-check the connectors surfaces in dark inside the light walk.** After
   `shot("settings-connected")` (`edge.cjs:1244`), call
   `window.lore.setAppearance("dark")` (`src/preload.cjs:120` →
   `main.cjs:357` → `appearance.cjs:32-42`), `waitFor` the `--bg` token to
   equal `DARK_BG`, then `shot()` the connectors list and one open Manage
   sheet (for example the ChatGPT one from `edge.cjs:1237-1241`) in dark, and
   set it back to `light` before the Today check at `edge.cjs:1245`. Each
   `shot()` runs the layout check at both widths, so this keeps the dark
   `paintsAt` coverage on the two busiest connectors screens for about 5 s
   instead of 52. Do not read `DARK` for this; the walk is light and flips
   itself, as the settings walk does.
3. Delete the second connectors step from `tests.yml`. `test/ci-edge.test.cjs:15`
   builds a `Set` of persona names, so the duplicate's removal does not trip
   it. Update APP-225's acceptance line to say what now holds (connectors
   re-shot in dark; `faq` launched dark).

If uploading `$root` on failure lands (XC-072, acceptance 1), the dark PNGs
from step 2 arrive with it; nothing else needs them.

## Acceptance criteria

- [ ] `.github/workflows/tests.yml` has one `support/edge.sh connectors` step.
- [ ] Every assertion the dark connectors run made still runs somewhere:
      the boot-time "drawn dark, as kept" check (`edge.cjs:667`) runs on a
      walk launched with `LORE_EDGE_APPEARANCE=dark`; the connectors list and
      at least one open sheet pass the layout check in dark colours at 1040
      and 900 px; the connectors branch's own checks run once, light.
- [ ] The Desktop macOS job's median duration drops by at least 40 s over
      the next 8 green runs (per-step medians, as in the 2026-10-26
      investigation), and no check is dropped from the walk log.
- [ ] `npm test` still passes (`test/ci-edge.test.cjs`), and APP-225's
      acceptance note names the new arrangement.

## Notes

- Rank 7 of 9 in the 2026-10-26 CI investigation's low-effort list; the
  investigation's B report, F11, is the source for the "one unique
  assertion" finding, re-read against `main` @ d8530d95 today.
- Said plainly: beyond the one boot-time check at `edge.cjs:667`, the dark
  walk has no assertions of its own. Its value is 26 layout passes whose
  only colour sensitivity is `paintsAt`'s transparency test, plus
  screenshots nothing reads. The item is shaped around keeping that boot
  check and a cheap dark layout sample, not around parity with the full
  light walk.
- `LORE_EDGE_APPEARANCE` is honoured by every walk, not only connectors
  (`edge.sh:15-16`), so the env can move to any step without harness
  changes. `settings` is the one walk that should stay light: its checks at
  `edge.cjs:1510-1537` branch on `DARK` and already cover both directions.
- The screenshots are the only output of a walk that is not a `check`;
  CI never uploads them (no `upload-artifact` in `tests.yml`), so the 26
  dark PNGs removed here were never looked at.
