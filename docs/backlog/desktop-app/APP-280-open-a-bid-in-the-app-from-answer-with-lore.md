---
id: APP-280
title: Open a bid in the app from "Answer with Lore"
priority: P1
effort: S
component: desktop-app
status: ready
related: [XC-093, XC-115, APP-274, MON-051]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-02
updated: 2026-11-02
---

## Problem

A bid page's "Answer with Lore" (XC-093) links to `/download?bid=<id>`, which only hands out the
zip. The app registers no `lore://` URL scheme, so someone who already has Lore can't jump from
the bid to drafting an answer, and someone who installs it loses the bid they came for.

## Proposed approach

- Register `lore` with `app.setAsDefaultProtocolClient` and `CFBundleURLSchemes` in the Forge
  packager config; handle `open-url` in `main.cjs`, routing `lore://bid/<id>` to the renderer.
- The renderer opens the bid (read from `https://yourlore.dev/b/<id>.json`) and starts the same
  draft-from-memory flow APP-274 uses for a matching bid. Nothing is sent without approval.
- `/download?bid=<id>` becomes a small page: try `lore://bid/<id>`, and fall back to the zip,
  keeping the id so first run can offer "Answer the bid you came from".

## Acceptance criteria

- [ ] With Lore installed, "Answer with Lore" opens the app on that bid's draft.
- [ ] Without Lore, the button downloads the app, and first run offers the bid.
- [ ] An unknown or ended bid id shows a plain message, not an error.

## Notes

Filed from the XC-093 rework (Nov 1). The site side already carries the id in the URL.
