---
id: CLI-001
title: Bulk-classify the review queue instead of one card at a time
priority: P1
effort: S
component: cli-ux
status: in-review
related: [STO-001, XC-001]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/6
created: 2026-07-26
updated: 2026-07-26
---

## Problem

`lore review` walks the queue one memory at a time, requiring a keystroke per
item. With ~50 pending memories this is the exact friction issue #6 opens with.
Most of those decisions are cheap and repetitive (keep-as-private, discard) and
do not need per-card attention; only the rare `external` decision does.

## Proposed approach

Add a bulk path to `review` that applies one status to a filtered set in a single
action — e.g. `lore review <query> --all private` / `--all discarded`, and/or an
"apply to all remaining" choice inside the interactive loop. Keep the per-card
flow for the decisions that warrant it. Purely additive; no change to defaults or
the status model.

## Acceptance criteria

- [ ] A non-interactive way to set one status across a filtered review set in one
      command, with a printed count of how many were changed.
- [ ] The interactive loop offers an "apply to all remaining" option.
- [ ] `external` is never assignable via a blind bulk action without an explicit
      confirmation, so bulk convenience can't cause accidental disclosure.
- [ ] Tests cover the bulk path, including the confirmation guard on `external`.

## Notes

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/6. This is the
smallest, non-breaking change that directly addresses the issue's stated pain,
and is independent of the larger capture/promotion redesign in STO-001.
