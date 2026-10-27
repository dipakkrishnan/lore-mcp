---
id: APP-225
title: Dark mode that follows the Mac
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-220, APP-222, APP-247]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-10-27
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
- [x] Dark tokens from the marketplace palette, text at WCAG AA
- [x] No literal colour outside the token blocks (unit test)
- [x] Dark marks readable on dark without recolouring
- [x] Edge walks run dark with `LORE_EDGE_APPEARANCE=dark`. Each walk checks
  the theme it was drawn in. The settings walk switches Appearance live. CI
  launches `faq` dark for the boot-time check, and the connectors walk re-shoots
  its list and a Manage sheet in dark from inside its light run (APP-247; until
  2026-10-27 CI walked connectors a second time, launched dark).
