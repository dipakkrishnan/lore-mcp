---
id: APP-225
title: Dark mode that follows the Mac
priority: P3
effort: XS
component: desktop-app
status: completed
related: [APP-220, APP-222, APP-247]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-11-13
---

## Problem

Lore forced itself light (`nativeTheme.themeSource = "light"`) so its frosted
sidebar would not turn grey on a dark Mac. On a Mac set to dark, Lore was the
one bright window, and the owner could not choose otherwise.

## Fix

- Settings → Appearance offers Match Mac, Light and Dark. Match Mac is the
  default. The choice is kept in the app's user data (`appearance.json`) and
  drives `nativeTheme.themeSource`. The page's colours and the sidebar's
  frosted material change together, at once.
- The account menu at the foot of the sidebar has a Dark mode switch. It shows
  what the window is drawn in. One click turns the window light or dark at once
  and keeps that as an explicit choice, leaving Match Mac. Settings shows the
  same choice.
- The dark palette is the marketplace site's (`--bg #141613`, `--surface
  #1c1f1b`, `--ink #ecebe6`, `--muted #a3a69f`, `--line #2e322d`, `--accent
  #8fc3a6`, `--accent-soft #223129`). Every other token is derived from it, and
  all text meets WCAG AA. Buttons filled with the accent use dark text.
- Every colour in the stylesheet is a token. Shadows and backdrops are one
  colour at their own strength, made deeper in dark.
- Brand marks drawn in near-black (OpenAI/ChatGPT, Notion, Medium, Goodreads,
  Letterboxd, the blog mark, the personal agent) sit on a light tile in dark.
  No mark is recoloured. The dock icon is unchanged.
- Light mode looks exactly as before.

## Acceptance criteria

- [x] Appearance: Match Mac / Light / Dark in Settings, kept across launches, switching live
- [x] A Dark mode switch in the account menu flips the window live and keeps the choice
- [ ] ~~Dark tokens from the marketplace palette, text at WCAG AA~~ Superseded: APP-281 (#638) replaced the palette with the Linear tokens, so the palette and its contrast now belong to APP-281's tokens. The `--text-3` AA gap is a separate follow-up (see Close-out).
- [x] No literal colour outside the token blocks (unit test)
- [x] Dark marks readable on dark without recolouring
- [x] Edge walks run dark with `LORE_EDGE_APPEARANCE=dark`. Each walk checks
  the theme it was drawn in. The settings walk switches Appearance live. CI
  launches `faq` dark for the boot-time check, and the connectors walk re-shoots
  its list and a Manage sheet in dark from inside its light run (APP-247; until
  2026-10-27 CI walked connectors a second time, launched dark).

## Notes

**Backlog audit (2026-11-12), left in-review:** Everything APP-225 built is
on main and covered by tests and walks. Criterion 3 no longer holds: APP-281
(#638) swapped in a Linear dark palette, and its tertiary text `--text-3`
(#76777e) measures 4.27:1 on the canvas and 3.78:1 on raised surfaces, under
AA for body text. Reword criterion 3 to defer the palette to APP-281, and
file or fold the --text-3 contrast fix (into APP-281, which is in-review);
then this item can close.

**Prioritization (2026-11-12):** Priority P3 (was P2), effort XS (was M).
Stays in-review. Before it can be ready: Reword criterion 3 to defer the
palette to APP-281, file the --text-3 contrast fix as its own small item
(APP-281 already shipped), then close. Prioritization flag (not acted on):
done except the AA criterion.

**Close-out (2026-11-13):** completed. What APP-225 built is on main and ticked.
Appearance and the dark switch are tested by the settings walk. The token-only
rule has a unit test. The dark-tile marks are in `app/desktop/src/styles.css`
(the `img:is([src$="/openai.svg"], …)` rule under `prefers-color-scheme: dark`).
Criterion 3 is struck because APP-281 owns the palette now. The contrast gap is
real and wider than the audit said. Measured on this branch: dark `--text-3`
#76777e is 4.27:1 on `--bg` #0f1011 and 3.78:1 on `--bg-raised` #1c1d21.
Light `--text-3` #8f9098 is 3.10:1 on #fcfcfd and 3.18:1 on #ffffff, so both
themes fall under AA 4.5:1 for body text. `--text-2` passes (dark 6.2:1). This
needs its own small item. Proposed in the close-out report, not filed here.
