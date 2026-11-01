---
id: APP-242
title: Let a browser sign-in left waiting be cancelled, time out, and give way to the next
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-078, APP-178, APP-199]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-22
updated: 2026-10-22
---

## Problem

A trial user started Continue with Claude, closed the browser tab, and Lore
sat on "Waiting for your browser…" with no way out. `LoreAgent.login` passed
pi-ai's OAuth flow no `signal`, so nothing ever ended the wait. The hung
Claude flow kept callback port 53692, so the next try failed with
`EADDRINUSE`. The ChatGPT flow still opens its URL when its port is taken, so
every click opened another tab and started another wait, and she saw a pile
of sign-in tabs when she closed Lore.

## Proposed approach

The agent runs one sign-in at a time. A new sign-in, `cancelLogin()`, or a
five-minute timeout aborts it. The pasted-URL prompt is aborted with it,
since pi-ai's Anthropic flow otherwise waits on that prompt and never closes
its server. An `auth:cancel` IPC backs a Cancel button that the welcome
screen shows while it waits. A replaced sign-in no longer overwrites the
newer one's note.

## Acceptance criteria

- [ ] Cancel on the welcome screen ends a sign-in waiting on the browser and says "Sign-in stopped."
- [ ] A sign-in left waiting ends after five minutes with "Sign-in timed out. Try again."
- [ ] Starting another sign-in ends the waiting one, and the callback port is free for it
- [ ] A unit test covers cancel and replace, including aborting the pasted-URL field

## Notes

Fixed in PR #544 (branch `app-signin-cancel`). I checked the real
`anthropicOAuth.login`: without the fix an abort leaves it hung and holding
the port; with it, it ends and frees the port. Not explained yet: why the
tabs opened only when she quit Lore. Lore opens none on quit, so the likely
cause is that the browser held the URLs it was sent (no window open, or a
profile picker showing). Which browser she uses is still unknown.
