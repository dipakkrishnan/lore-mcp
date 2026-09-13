---
id: APP-105
title: Reconcile a completed capture's run status
priority: P2
effort: S
component: desktop-app
status: in-review
related: []
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/247
created: 2026-09-11
updated: 2026-09-11
---

## Problem

A memory capture that completed successfully (confirmed via `lore
desktop-state`: the save is visible and editable in Memories) still shows as
unfinished in two different, mutually contradictory ways after quitting and
relaunching the app. Today → Unfinished lists it as `Ready to resume` /
`Stopped`, even though the memory it produced is already saved. Separately,
Today → Recent runs lists the same capture with a `Done` chip but a summary
line reading "Stopped before finishing" — the chip and the summary disagree
on the same row, and the row isn't clickable, so there's no way to open it
and see what actually happened despite it showing a real dollar cost. Found
during a manual test of Scenario 1 in `docs/manual-test-walkthrough.md`.

## Proposed approach

Both symptoms trace to the capture turn ending without the agent calling
`finish_task` (`app/desktop/src/agent.mjs`'s `closingRecord` only closes a
task as done when `completed` is true). Add a safety net that marks the turn
complete the moment `propose_memories` reports a real save, independent of
whether the agent remembers to call `finish_task`; reconcile the two status
trackers (`closingRecord`'s `completed` flag and the Recent-runs job outcome)
so the same event can't report `succeeded` in one place and "stopped before
finishing" in the other; and make a Recent-runs row openable when its status
is anything other than a plain success, since it can show a real cost with no
way to inspect what it paid for.

## Acceptance criteria

- [x] A capture that saves a memory closes as done, not stopped, and does not
      appear under Today → Unfinished
- [x] A capture's Recent-runs entry shows one consistent status, not a `Done`
      chip contradicted by its own summary text
- [x] A Recent-runs entry can be opened to see what it actually did, at least
      when its status is anything other than a plain success

## Notes

Cataloged from GitHub issue #247. Already implemented on branch
`issue-247-recent-run-status` (`app/desktop/src/agent.mjs`,
`app/desktop/src/renderer.js`, `app/desktop/test/app.test.cjs`):
`savedCompletion` is the safety net that marks a capture's turn complete as
soon as `propose_memories` reports a non-empty save; `jobOutcome` replaces
the job row's independent `succeeded`/`stopped` computation so it can never
disagree with `closingRecord`; and `recentRuns` now renders a clickable row
(via `openTask`) for any entry whose status isn't a plain success, with
`openTask` reading history directly instead of requiring a still-live
`TaskRecord`.
