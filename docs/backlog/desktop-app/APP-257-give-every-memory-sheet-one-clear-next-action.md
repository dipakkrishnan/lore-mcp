---
id: APP-257
title: Give every memory sheet one clear next action
priority: P1
effort: S
component: desktop-app
status: ideation
related: [APP-258, APP-259]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

A memory Lore judged not for sale opens with no button at all (renderer.js:396–446). The only way forward is a 12px "Draft anyway" link inside the grey meta line, after an unlabeled model reason. Coming from Cmd-K, which only opens things, the user stops there. Feedback #2 and #3.

## Proposed approach

Meta line: `Private · Lore wouldn't sell this: {why}`. Put a secondary **Sell anyway** button in the slot where the primary "Sell this" sits for sellable memories. Work memories: `Work · always private`, no button. In the palette, show `⌘↵ Sell` in the footer for a selected sellable memory, calling `publishMemory`.

## Acceptance criteria

- [ ] Every non-work memory sheet has exactly one sell button in the same position (primary or secondary by verdict)
- [ ] No inline action links in the sheet meta line
- [ ] ⌘↵ in the palette starts selling the selected memory; ↵ still opens it
- [ ] Walks green

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
