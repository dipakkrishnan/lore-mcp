---
id: APP-033
title: Let the owner edit a draft before approving
priority: P1
effort: M
component: desktop-app
status: completed
related: [APP-032, APP-023, APP-028, XC-002]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

Publication drafts are approve-or-skip only: no way to fix a title,
tighten a teaser, or reword paid content (Dipak, 2026-08-23: "as a user,
I have no way to edit this"). It's
the owner's voice being sold; take-it-or-leave-it is the wrong contract
for the one artifact that leaves the machine.

## Proposed approach

Title, teaser, and content become editable on the approval card using
APP-028's autosize pattern. The decision carries the original staged card
alongside the owner's edited version, so Python can consume exactly that card,
permit only those three edits, and preserve kind, topic, and provenance.

## Acceptance criteria

- [x] Card fields are editable; Approve submits the edited candidate
      through `lore publication decide`, which validates and records the
      owner edit.
- [x] Skip/approve semantics, provenance, and "only what you approve
      leaves this Mac" unchanged; Python and desktop tests pass.

## Notes

Scope cut by owner decision on 2026-08-23: direct editing is required; agent
redrafting is deferred unless manual editing proves insufficient.

Implemented on 2026-08-23. The saved publication is the durable edited version;
no separate amendment log or candidate-id migration was added.
