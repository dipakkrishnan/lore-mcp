---
id: APP-054
title: Close the edge audit's pre-freeze findings before the notarized build
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-039, APP-046, APP-047, APP-034]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-02
updated: 2026-09-02
---

## Problem

The 2026-09-01 desktop edge audit (two personas, one money pass, 29
findings) left five defects that lose an owner's work or make the app look
broken on first contact, all cheap:

- `say()` writes to the thread log, and the log is hidden whenever no thread
  is open, so on Today root, Memories, For Sale and Settings every
  confirmation and error vanishes (approval confirmations, failed take-downs
  and pushes, microphone help, refused files, memory save errors).
- Approval forms are rebuilt on every render, and the `changed` event fires
  on every agent bash call, so an edited title, teaser or paid content is
  wiped mid-edit.
- Enter in a memory card's title implicitly submits the form, which is Keep.
- IPC handlers register only after first-run provisioning succeeds; a failed
  setup leaves every button rejecting with "No handler registered" and no
  retry (APP-039 is the launch-time symptom of the same ordering).
- The Sales card promises the first sale will show up with what it paid,
  and nothing collects that.

## Proposed approach

A `tell()` that says things in the open thread or, when the log is hidden,
as a dismissible notice in the existing status live region. Approval forms
kept across renders keyed by candidate. Enter in a one-line field moves to
the next field. Register IPC before provisioning, answer "still setting up"
until the agent exists, and offer Try again. Honest Sales copy until a
ledger exists.

## Acceptance criteria

- [x] Every `tell()` call site is visible on the view where it fires.
- [x] A draft edit survives repeated `changed` events and reaches the
      approved publication.
- [x] Enter in a title keeps the card up and moves focus to the content.
- [x] With provisioning failing, the banner names it, IPC answers, and Try
      again recovers to sign-in.
- [x] A persona harness (`npm run test:edge`) drives these under Electron.

## Notes

Shipped in PR #192. The audit's remaining pre-launch items (deploy re-entry,
standing push, root capture, probe cache, read allowlist, key proof) are
APP-055. The sales ledger, payout address and an owner-gated open-URL tool are
scoped separately.
