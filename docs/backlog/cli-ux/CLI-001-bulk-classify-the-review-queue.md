---
id: CLI-001
title: Bulk-classify the review queue instead of one card at a time
priority: P1
effort: S
component: cli-ux
status: in-progress
related: [STO-001, XC-001, XC-002]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/6
created: 2026-07-26
updated: 2026-07-27
---

## Problem

`lore review` walks the queue one memory at a time, requiring a keystroke per
item. With ~50 pending memories this is the exact friction issue #6 opens with.
Those decisions are cheap and repetitive *retention* calls (keep-as-private,
discard); disclosure is rare and, under the "Private by Default, Publish by
Intent" model, does not happen through `review` at all — it goes through the
intent-driven publish flow (XC-002).

## Proposed approach

Add a bulk path to `review` that applies one *retention* status to a filtered set
in a single action — `lore review <query> --all private` / `--all discarded`, and
an "apply to all remaining" choice (uppercase P/D) inside the interactive loop.
External is never a bulk action ("no blind bulk externalization"): `--all external`
is rejected by the parser and `review()` refuses it for programmatic callers. Keep
the per-card flow for anything else. `--all private` is exactly the safe
`pending`→`private` migration the model calls for.

## Acceptance criteria

- [x] A non-interactive way to set one retention status across a filtered set in
      one command, with a printed count of how many were changed.
- [x] The interactive loop offers an "apply to all remaining" option (P/D only).
- [x] External is never assignable via any bulk action — rejected at the parser
      and refused by `review()`.
- [x] Tests cover the bulk paths, the interactive apply-all, and the external
      refusal.

## Notes

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/6; realigned to
Dipak's "Private by Default, Publish by Intent" doc — bulk is now retention-only
and the `external` bulk path (and its confirmation gate / `--yes`) was removed.

Implemented on the `feat/cli-bulk-review` branch of the fork
(https://github.com/shanedasbach/lore-mcp/tree/feat/cli-bulk-review, PR #18):
`lore review --all private|discarded`, uppercase P/D "apply to all remaining", and
`Store.set_status_many`. Branches off `main`, not the backlog branch, since it's
code. Rare disclosure belongs to XC-002, not here.
