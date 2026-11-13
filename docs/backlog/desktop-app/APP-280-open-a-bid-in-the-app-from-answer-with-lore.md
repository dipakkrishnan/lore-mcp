---
id: APP-280
title: Open a bid in the app from "Answer with Lore"
priority: P2
effort: S
component: desktop-app
status: in-review
related: [XC-093, XC-115, APP-274, MON-051]
blockers: [APP-274]
dependencies: []
github_issue: null
created: 2026-11-02
updated: 2026-11-12
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

**Prioritization pass 2026-11-11:** Moved `ready` → `in-review` and recorded APP-274 as a blocker: the approach starts "the same draft-from-memory flow APP-274 uses", and APP-274 is still `in-progress`.

**Prioritization (2026-11-12):** Priority P2 (was P1). Stays in-review.
Before it can be ready: Blocked by APP-274 (close it first). Re-scope the
third approach bullet and criterion 2 given the download page already
carries the bid id; say whether the first run still has to offer the bid.
