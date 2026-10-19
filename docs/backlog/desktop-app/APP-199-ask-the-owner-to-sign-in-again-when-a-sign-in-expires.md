---
id: APP-199
title: Ask the owner to sign in again when Claude's sign-in expires, never show the raw error
priority: P0
effort: S
component: desktop-app
status: completed
related: [APP-193, APP-190]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-13
updated: 2026-10-19
---

## Problem

A trial user opened "Set up your Lore", typed "Let's set up my Lore", and got a
stack trace as Lore's message: `OAuth refresh failed for anthropic: ...
{"error": "invalid_grant", "error_description": "Refresh token expired"}; stack=...`.
The task then sat at "Stopped" with no way forward but signing out.

Two things made the sign-in stale. Credentials live in
`userData/credentials.bin`, which survives deleting the app, so a month-old
Claude sign-in came back with the reinstall. And nothing stops two copies of
Lore (one left in Downloads, one in Applications) running against the same
file: Anthropic rotates the refresh token on every refresh, and
`CredentialStore` serializes refreshes only within one process, so the second
copy to refresh is refused with `invalid_grant`.

Separately, the agent emits any model `errorMessage` verbatim into the
conversation, so every provider or plumbing failure reads as a stack trace.

## Proposed approach

- When the provider refuses a refresh (`invalid_grant`, or Codex's
  `refresh_token_*` codes), delete that stored sign-in, hold the task at
  "Needs you", and send the owner to the existing sign-in screen with one
  line: "Your Claude sign-in expired. Sign in again to keep going." (ChatGPT
  for a Codex sign-in). After signing in, replying resumes the same thread.
- Take Electron's single-instance lock; a second launch quits and focuses the
  open window.
- Never put a model's `errorMessage` in the conversation: the step cap keeps
  its sentence, everything else reads "Lore's model did not answer. Try
  again." The raw detail goes to the main-process log. The API-key check does
  the same.

## Acceptance criteria

- [x] A refused refresh deletes that provider's stored sign-in and shows the plain sign-in line, not the error
- [x] The task is held at "Needs you", not "Stopped", and replying after signing in continues it
- [x] No model `errorMessage` ever reaches the conversation or the sign-in note
- [x] A second copy of Lore quits and brings the open window forward
- [x] A network failure during a refresh does not delete the sign-in

## Notes

Filed from a trial user's Oct 13 report. APP-193 covers the account
indicator saying the session expired before a task fails; this item is the
failure path inside a task.

**Completed (verified 2026-10-19):** every acceptance criterion is checked and the work is on main in ddc4bdf. Status was left stale after merge; closed out in the review-queue pass.
