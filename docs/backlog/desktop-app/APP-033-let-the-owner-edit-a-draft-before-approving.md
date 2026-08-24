---
id: APP-033
title: Let the owner edit a draft before approving — by hand or by asking Lore
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-032, APP-023, APP-028, XC-002]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

Publication drafts are approve-or-skip only: no way to fix a title,
tighten a teaser, or reword paid content — manually or by asking the
agent (Dipak, 2026-08-23: "as a user, I have no way to edit this"). It's
the owner's voice being sold; take-it-or-leave-it is the wrong contract
for the one artifact that leaves the machine.

## Proposed approach

Two paths, one rule (the agent drafts, the owner may edit, the agent
never approves):

- **By hand** — title/teaser/content become editable on the approval card
  (APP-028's autosize pattern). An owner-edited candidate is an owner
  authorship act; `lore publication decide` accepts the edited fields
  when the candidate id matches a drafted card, recording that the owner
  amended it. Python stays the validator (bounds, non-empty, provenance
  preserved).
- **By asking** — while candidates are pending, a reply in the publish
  thread ("shorter teaser", "merge these two") revises the drafts: the
  skill re-drafts via the existing validated draft path and the cards
  refresh in place.

## Acceptance criteria

- [ ] Card fields are editable; Approve submits the edited candidate
      through `lore publication decide`, which validates and records the
      owner edit.
- [ ] A reply during pending approvals revises the drafts instead of
      starting a new pass; cards refresh in place.
- [ ] Skip/approve semantics, provenance, and "only what you approve
      leaves this Mac" unchanged; Python and desktop tests pass.

## Notes

Before promotion, cut the first implementation to direct owner editing. Agent
redrafting changes publish-session lifecycle as well as the card and validated
decision path, so it should follow only if manual editing feels insufficient.
