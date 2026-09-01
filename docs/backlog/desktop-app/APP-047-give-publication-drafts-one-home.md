---
id: APP-047
title: Give publication drafts one home and keep cards in their own thread
priority: P0
effort: S
component: desktop-app
status: in-review
related: [APP-020, APP-023, APP-032, APP-046]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-01
updated: 2026-09-01
---

## Problem

The 2026-09-01 dogfood published the same memory twice. The capture session,
following the skill's optional handoff, drafted a publication candidate; the
app rendered its card only on Today, not in the capture thread where the owner
was; the owner then clicked Draft for sale on the memory, which started a
second, cold publish session that ignored the staged draft and asked its own
clarifying question. Today compounded it by synthesizing an unfinished
publication task row for the same draft. Separately, agent questions carry no
task identity, so a question from a background deploy renders under whichever
thread the owner happens to be viewing.

## Proposed approach

Publishing gets exactly one home. In the desktop, capture never drafts a
publication: the saved card offers Draft for sale per memory, and nothing
happens until the owner clicks. That click forks the capture session into a
new publish session with pi's native fork, so the publish agent already knows
what was said and does not cold-start. Draft for sale from anywhere checks
pending candidates' provenance for the memory and opens the existing card
instead of starting another agent. Today stops synthesizing a task row for
pending drafts. Every agent request and message names its task, and the
renderer opens that thread before rendering a card.

## Acceptance criteria

- [x] A desktop capture ends at the saved card with no publication question
      and no staged draft.
- [x] Draft for sale from the saved card starts the publish task as a
      continuation of the capture thread.
- [x] Draft for sale for a memory that already has a pending candidate opens
      that card instead of starting another agent turn.
- [x] Today renders a pending draft once, without a synthetic unfinished
      publication row.
- [x] A card or message from one task never renders under another task's
      heading.
- [x] Desktop typecheck and tests pass.

## Notes

Filed from notarized-build dogfood on 2026-09-01. Supersedes the uncommitted
APP-039 draft from that session, whose id was later claimed on main by the
agent:status IPC bug. The capture skill keeps its optional publish handoff for
terminal hosts; only the desktop prompt overrides it. Enforcement is by prompt:
the capture sandbox has no command-level policy, so a hard block on the draft
command is deliberately out of scope here.
