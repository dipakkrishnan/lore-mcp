---
id: XC-095
title: Ask Windows visitors to get notified instead of downloading the Mac zip
priority: P1
effort: S
component: cross-cutting
status: ideation
related: [XC-091, CLI-017, APP-253]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

yourlore.dev (site/public/index.html:117,124; site/src/worker.js:11,138) links every visitor to
Lore-macOS-arm64.zip. A Windows visitor gets a file they can't run, and we never learn they came, so
we have no measure of Windows demand (a Windows user asked for a PC build).


## Proposed approach

Detect the platform client-side (navigator.userAgentData.platform, falling back to navigator.platform).
On Windows/Linux, replace the button with "Get notified when Lore is ready for Windows" plus an email
field, with a small "Download for Mac" link kept under it. Add POST /notify to the site Worker (in
run_worker_first) that validates the email and forwards a `site.windows_waitlist` event to the feedback
relay (PostHog) or stores it in KV. Same swap on the marketplace page's download link.


## Acceptance criteria

- [ ] Windows UA sees the notify form, not the Mac zip link; macOS UA unchanged
- [ ] Submitting stores or forwards the email once and shows a plain "We'll email you" confirmation
- [ ] A PostHog insight counts waitlist sign-ups by platform
- [ ] Works with JS disabled (falls back to the current Mac link)

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
