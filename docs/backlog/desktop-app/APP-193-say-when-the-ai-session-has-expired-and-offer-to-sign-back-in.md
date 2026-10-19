---
id: APP-193
title: Say when the AI session has expired and offer to sign back in
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-181, APP-183]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-19
---

## Problem

The bottom-left account indicator (`renderAccount` in
`app/desktop/src/renderer.js`) says "Signed in" whenever a credential is stored.
It never checks whether the Claude or ChatGPT session is still valid. When the
session expires the app still says "Signed in", Lore's work fails, and the only
way back is to sign out and then sign in again.

## Proposed approach

Notice an expired or rejected credential, either from a failed refresh or an
auth error from the runtime, and keep that state beside the credential. The
indicator then reads "Session expired, sign back in to reconnect" with a "Sign
back in" action that runs the provider sign-in directly, with no sign-out step
first. The Settings sign-in row shows the same state.

## Acceptance criteria

- [ ] After the provider rejects the session, the indicator says the session expired and to sign back in
- [ ] One click signs back in without signing out first
- [ ] A valid session still shows "Signed in"
- [ ] The Settings sign-in row agrees with the indicator

## Notes

Filed from the 2026-10-06 For Sale review. P1 because a silently dead session
makes every Lore job fail with no explanation.

**Prioritization 2026-10-19 (corrected in review):** not promoted; partly built and
not audited. `app/desktop/src/agent.mjs` already detects a rejected refresh
(`SIGN_IN_EXPIRED`, line 160), re-prompts through `#signInAgain` (line 806), and emits
a `signed-out` event reading "Your ... sign-in expired. Sign in again to keep going."
(line 954). What is still unknown is whether `renderAccount` and the Settings row
(`renderer.js:2994`) show the expired state outside a running turn, and whether
signing back in needs a sign-out first. Trace those two paths, then rewrite the
criteria to the real gap.
