---
id: APP-184
title: Hide or plain-language the jargon left in Settings
priority: P2
effort: S
component: desktop-app
status: ready
related: [APP-136, XC-025, APP-094, APP-188]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Settings still shows things a seller doesn't understand or can't change:
"Paid answers / $0.10 per answer" (with no way to edit it), "To your wallet ·
0x… View ↗", "Hosted on Cloudflare ↗", the raw workers.dev address,
"Lore's shape", and a file path under "Where it lives".

## Proposed approach

- Hide Paid answers unless the seller turned it on, and make its price editable when shown.
- Show only the yourlore.dev address; move workers.dev and Cloudflare under Advanced.
- Rename "Lore's shape" to say what it is, and replace the path with "Your
  memories are stored on this Mac" and Show in Finder.

## Acceptance criteria

- [ ] A new seller's Settings shows no hex address, workers.dev URL or file path by default
- [ ] Every value shown is either editable or explained in one line

## Notes

Filed from the 2026-10-06 new-seller audit. When the wallet row shows is
covered by APP-188.
