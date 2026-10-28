---
id: APP-249
title: Put the store online in the background so the welcome flow never waits
priority: P1
effort: M
component: desktop-app
status: ideation
related: [XC-085, XC-087, XC-088, XC-069]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

"Set it up" holds the welcome flow on one card until the store is online or fails.
Email verification can take hours; a fresh address can take minutes to answer; the
deploy checks the new address once and gives up (`deploy.py:898`). The owner's rule:
sign-up never breaks and never feels like friction.

## Proposed approach

- Store setup becomes a background job with named states: signing in, checking your
  account, getting your address ready, waiting for your email, online.
- The welcome flow continues at once ("We'll tell you when Claude can save here");
  a Today card and notification announce it online, then hand over the connect link.
- Waiting-for-email polls the account every 60s; readiness polls the store with
  backoff for ~3 min before calling it stuck; resumes on launch and on network change.

## Acceptance criteria

- [ ] Tapping Set it up never leaves the owner on a card they can't move past.
- [ ] An owner who verifies their email an hour later gets "Claude can save here now" without tapping anything.
- [ ] A store whose address answers 90s after setup is reported online, not failed.
- [ ] Every state is in plain words; none says deploy, worker or subdomain.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
