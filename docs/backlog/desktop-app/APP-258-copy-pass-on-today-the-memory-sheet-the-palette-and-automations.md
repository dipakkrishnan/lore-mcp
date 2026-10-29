---
id: APP-258
title: Copy pass on Today, the memory sheet, the palette and Automations
priority: P1
effort: S
component: desktop-app
status: ideation
related: [APP-255, APP-256, APP-257, XC-025]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

The composer asks "What did you learn today?" when the app wants what you worked on. Selling is called draft, publish, sell and approve in different places. "Capture", "Find or capture", "Waiting for you" next to "Needs you", and title-case "+ Add Memory" are jargon or inconsistent.

## Proposed approach

Apply the copy table in this audit (§3): composer `What did you work on today?`, `Save`, `Search`, one verb (`Sell`), `In progress`, `Stopped`, `Import from your apps`, and a shorter check-in description.

## Acceptance criteria

- [ ] Composer label, placeholder and syncComposer text all match
- [ ] No user-facing "capture", "Draft anyway" or "your Lore" left in renderer copy
- [ ] Edge walks that assert names (edge.cjs:737, 2533, 2576) updated; all green

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
