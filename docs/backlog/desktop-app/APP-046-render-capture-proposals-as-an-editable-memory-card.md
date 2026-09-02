---
id: APP-046
title: Render capture proposals as an editable memory card
priority: P0
effort: S
component: desktop-app
status: in-review
related: [APP-003, APP-009, APP-016, APP-045]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-01
updated: 2026-09-01
---

## Problem

Fresh-device dogfood of the notarized build on 2026-09-01 showed a proposed
memory arriving as ordinary assistant Markdown with a generic keep, correct, or
drop question underneath. The object awaiting approval and the approval itself
were two disconnected pieces of transcript, so a new owner could not tell
exactly what "keep" would save. Correcting the wording meant another model
round trip, and the agent, not the app, ran the save afterwards.

## Proposed approach

Give the desktop agent one typed `propose_memories` tool that mirrors the
blueprint path end to end. The request slot renders the entries as one card
with an editable title and content per entry, a per-entry Drop, and a single
Keep. The composer stays open while the card is up, so anything the owner types
or dictates travels back as a correction note for the agent to revise and
propose again. On Keep, Electron main saves exactly the entries on screen
through `lore capture apply` and returns the saved memories to the agent; the
agent never runs the save itself in the desktop. The saved memories render as a
card in the thread, each with a Draft for sale action.

## Acceptance criteria

- [x] Capture proposals render as one editable memory card in the active
      thread before anything is saved, and the same proposal is not repeated
      as Markdown.
- [x] Keeping saves the entries exactly as edited on the card, through the
      main process and the existing private capture boundary.
- [x] A typed or dictated correction while the card is up returns to the agent
      as a note, alongside the owner's inline edits.
- [x] The kept memories, the owner's correction, and a drop remain legible
      after the thread is reopened from disk.
- [x] Desktop typecheck and tests pass.

## Notes

Filed from notarized-build dogfood on 2026-09-01. This is a regression against
APP-009's completed capture-card criterion after the old Bash-policy renderer
was removed with the Bash-regex approval boundary. The fix must not restore
command parsing. Supersedes the uncommitted APP-038 draft from that dogfood
session, whose id was later claimed on main by the Keychain sign-in bug.
