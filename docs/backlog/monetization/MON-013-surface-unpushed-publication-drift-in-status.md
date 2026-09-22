---
id: MON-013
title: Surface unpushed publication drift between the local library and the deployed node
priority: P1
effort: S
component: monetization
status: in-review
related: [MON-004, MON-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-10
updated: 2026-09-22
---

## Problem

Approving a publication locally does not reach the deployed node until the
owner remembers to run `lore push` separately. Nothing in `lore status` (or
anywhere else) compares the local active-publication count against what the
deployed node is actually serving, so the gap is invisible until an outside
buyer notices — which is exactly what happened: an owner published three new
items, `lore status` kept showing them as active, and a third party trying to
buy from the node reported he couldn't see them at all. The owner had no way
to catch this themselves short of manually querying the live `discover` tool.
`MON-004` already covers the mirror-image case (revocation not reaching the
edge fast enough); this is the same underlying drift problem for the
publish/new-content direction, which no existing item covers.

## Proposed approach

Unclear in detail. One shape: `lore status` fetches (or caches from the last
push) the deployed node's publication count/ids and diffs against the local
active set, printing something like `Node catalog: 2 pushed, 3 pending push`
when they disagree. A stronger shape: auto-push as part of the publish/approve
flow itself, so the gap never opens rather than needing to be surfaced.

## Acceptance criteria

- [x] After approving a publication without running `lore push`, some
      owner-visible signal (most likely `lore status`) shows the deployed
      node is behind the local active set
- [x] The signal disappears once `lore push` runs and the sets match

## Notes

Surfaced 2026-08-10: local active-publication count was 5, the deployed
node's live `discover` catalog still reported 2, and the gap was only found
by directly querying the node's MCP endpoint after a third-party report — not
through any owner-facing tooling.

**Prioritization pass 2026-08-26:** the approach section's two shapes
("`lore status` diffs the counts" vs. "auto-push on approve so the gap
never opens") were an open decision blocking implementation, the same
pattern `MCP-002` had before a prior pass picked a direction. Picking one:
**mirror `MON-004`**, which already made this exact call for revocation —
push as part of the owner action, record `revocation_pending`-style state
and surface it in `lore status` if the push fails, rather than only
surfacing an after-the-fact diff. Apply the same shape to publish/approve.
If that turns out too aggressive in practice (e.g. an owner approving many
publications in a row triggers a push per approval), the status-diff shape
is the fallback — note that in `## Notes` if implementation goes that way
instead. Promoted `in-review` → `ready`.

**Implementation, 2026-09-22:** mirrored `MON-004`'s shape rather than
falling back to a status diff. `publication_apply` (the CLI's interactive
approve/edit/reject loop over drafted candidates) and `publication_decide`
(the desktop app's one-decision-per-call path) both push the active set to
the deployed node as part of approving, via a shared `_push_after_approval`
helper; a failed push sets a `publish_pending` setting and raises with a
retry instruction, exactly like `revocation_pending`. `lore status` prints a
reminder while it's outstanding, and a successful remote `lore push` clears
it (`_push` now clears `publish_pending` next to `revocation_pending`).

The "push per approval in a row" risk this note flagged turned out to be
real only in `publication_apply`'s loop, which can approve several
candidates within one process invocation — nothing in `MON-004` has an
analog for that, since revoking is always one id per invocation. Rather than
falling back to a diff, that one path batches: it pushes once after the
loop ends (covering quit-early too), not once per approved card, so
approving N candidates in one sitting costs one edge write. `publication_decide`
needed no such batching — the desktop app already calls it once per card, the
same granularity `publication_revoke` has, so it pushes per call like MON-004
does. New tests: `test_approving_several_candidates_in_one_sitting_pushes_once_not_per_card`,
`test_the_desktop_app_pushes_each_approved_card_immediately`,
`test_a_failed_approval_push_is_recorded_never_silently_dropped` (and its
desktop-path counterpart), plus a `publish_pending` counterpart to each
existing `revocation_pending` status/push test. Moving `ready` → `in-review`
per this repo's backlog convention.
