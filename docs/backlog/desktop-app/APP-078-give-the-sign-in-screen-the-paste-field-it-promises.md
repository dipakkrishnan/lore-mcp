---
id: APP-078
title: Give the sign-in screen the paste field it promises
priority: P2
effort: S
component: desktop-app
status: completed
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

- [x] While a Claude or ChatGPT login is pending, the welcome screen either shows a field that accepts the redirect URL and completes sign-in, or no longer mentions pasting one.
- [x] Pasting a valid redirect URL in that field signs the owner in without the browser callback.

## Notes

Found by a browser-driven dogfood pass on 2026-09-05; screenshot
`01-dogfood-signin-clicked.png` in that session's evidence.

Done 2026-09-05. Pi already asks for the pasted URL through a `manual_code`
auth prompt; the desktop routed it to the thread's request card, which the
welcome screen never shows. The renderer now renders that prompt as a field
under the note while sign-in is pending, submits it through the same
`agent:respond` IPC every card uses, and hides it when the browser callback
wins (main's `dismiss`) or sign-in settles. Pi parses a full redirect URL or
a bare code and rejects a state mismatch, so no parsing lives in the app.
Verified on a dev instance: the field appears on the real prompt after
"Continue with Claude", and a bogus URL clears it and shows the provider's
error ("OAuth state mismatch", pi's wording, as every sign-in error is
shown today); a valid exchange needs a real browser login.
