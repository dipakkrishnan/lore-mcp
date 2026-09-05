---
id: APP-078
title: Give the sign-in screen the paste field it promises
priority: P2
effort: S
component: desktop-app
status: in-review
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

After "Continue with Claude" the welcome screen says "Complete login in your
browser. If the browser is on another machine, paste the final redirect URL
here." There is nothing to paste into: the only input on that screen is the
collapsed API-key field, and `renderer.js` has no paste or redirect handler.
An owner whose browser opens elsewhere (remote desktop, a Mac with a broken
default browser) is stuck with a promise the screen cannot keep (dogfood
2026-09-05, fresh sandbox sign-in).

## Proposed approach

Either show a URL field under the note while an OAuth login is pending and
feed its value to the provider's `secret` prompt path, or drop the second
sentence so the copy only promises what the screen does.

## Acceptance criteria

- [ ] While a Claude or ChatGPT login is pending, the welcome screen either shows a field that accepts the redirect URL and completes sign-in, or no longer mentions pasting one.
- [ ] Pasting a valid redirect URL in that field signs the owner in without the browser callback.

## Notes

Found by a browser-driven dogfood pass on 2026-09-05; screenshot
`01-dogfood-signin-clicked.png` in that session's evidence.
