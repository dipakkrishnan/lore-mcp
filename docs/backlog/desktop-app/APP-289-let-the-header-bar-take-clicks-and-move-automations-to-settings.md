---
id: APP-289
title: Let the header bar take clicks, and move Automations to Settings
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-282, APP-283, APP-288]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-04
updated: 2026-11-04
---

## Problem

Owner testing 0.1.22 (Nov 4):

- On a memory's page, the ↓ button in the header does nothing, and the "Inventory" breadcrumb doesn't go back.
- Automations at the foot of Connectors feels out of place.
- A private memory's note runs two lines: "Lore keeps this private · Status of the owner's own product and plans;
  useful context, not a lesson others would pay for. · Draft anyway". It is the model's own 200-character reason, verbatim.
- Inventory lists a group's pieces before its memories, so an Oct 26 piece sits above a Nov 4 memory.

Root cause of the dead buttons: the window's drag strip (`.titlebar`, fixed, 28px, `-webkit-app-region: drag`) covers the top
28px of the 44px header bar. Electron hands clicks in a drag region to the window, so the page never sees them.
`aside > *` already opts out of the strip; the header's buttons never did. Synthetic clicks (tests, CDP) don't go through
the window's drag handling, so no test could see this.

## Proposed approach

- Everything clickable in the header (buttons, page tabs, a collection's editable title) is `no-drag`.
- Automations becomes a section of Settings, above Appearance. "Automations" links and the first-run notice land there.
- The note says "Lore keeps this private · Draft anyway"; the model's reason is its tooltip.
- Within a group, drafts lead, then pieces and memories together, most recently updated first.

## Acceptance criteria

- [ ] A real click on the breadcrumb, ↑/↓ and the Bids tabs works anywhere on the control.
- [ ] Connectors shows Your agents and Your apps only; Settings shows Automations.
- [ ] A private memory's note is one line; hovering it shows Lore's reason.
- [ ] Inventory rows in a group (after drafts) run newest first by the date they show.
- [ ] The notice about what Lore does on its own says "Change this in Settings" and opens Settings at Automations.
