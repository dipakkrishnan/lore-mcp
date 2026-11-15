---
id: APP-184
title: Hide or plain-language the jargon left in Settings
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-136, XC-025, APP-094, APP-188]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-11-12
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

**Prioritization (2026-11-12):** Priority P2. Moved back from ready to in-
review. Before it can be ready: Rewrite against the current renderSettings
(renderer.js ~4725): Paid answers is already hidden unless on (its price
still can't be edited); "Where it lives" already has the plain sentence and
Show in Finder but still shows the ~ path; the wallet is a short hex in Get
paid > To your wallet; the address row has "Hosted on Cloudflare". Criterion
2 ("every value editable or explained") can't be checked; list the exact
rows. Consider merging with APP-188.
