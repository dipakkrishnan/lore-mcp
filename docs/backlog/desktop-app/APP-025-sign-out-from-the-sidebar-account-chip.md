---
id: APP-025
title: Sign out from the sidebar account chip
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-009, APP-013]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

The signed-in chip in the sidebar's bottom-left looks clickable but does
nothing; the only way to sign out is to know it lives in Settings. Dipak
(2026-08-23): "when you click on your profile in bottom left there isn't
an easy way to sign out outside of navigating to settings."

## Proposed approach

Make the chip a button: clicking opens a small popover anchored to it with
the provider name and two actions — Sign out (existing `auth:logout` path)
and Open Settings. Dismiss on outside click and Escape; keyboard focusable
with an aria-expanded state.

## Acceptance criteria

- [x] Clicking the account chip opens a popover with Sign out and Settings.
- [x] Sign out returns to the welcome screen via the existing logout path.
- [x] Popover dismisses on outside click and Escape; chip is focusable.

## Notes

Implemented in the batch PR: the chip is a button opening a popover (Open Settings, Sign out of <provider>); Escape and outside click dismiss; aria-haspopup/expanded set.
