---
id: MON-039
title: Update a live piece's free parts in place
priority: P1
effort: S
component: monetization
status: in-review
related: [MON-035]
blockers: []
dependencies: [MON-035]
github_issue: null
created: 2026-10-05
updated: 2026-10-05
---

## Problem

MON-035 gave pieces a free sample and who-it's-for lines, but only a new
approval can set them, and approval always creates a new publication. Pieces
published before those fields existed show none of them, and the only way to
add them mints a new public id, so shared links, sales history and page views
stop pointing at the piece.

## Proposed approach

A staged-candidate variant for an existing publication: an agent stages
`{publication_id, sample, useful_if, not_useful_if}` with
`lore publication extras draft`, and the owner approves each one on a desktop
card (beside new drafts, with the same page preview) or in a terminal with
`lore publication extras review`. Approval goes through the same attended
gates as new pieces and updates only those three columns and `updated_at`,
then pushes the way a desktop approval already does.

## Acceptance criteria

- [x] An agent can stage new free parts for a piece by its id; nothing changes until the owner approves
- [x] Approving keeps the piece's public id, price and paid content, and the store push carries the new free parts
- [x] Piped or background approval is refused; only the desktop app or an interactive terminal can approve
- [x] The desktop card shows only the three free fields and previews the piece's page with them
- [x] A sample containing the whole paid text, or an id that isn't an active piece, is refused

## Notes

Staged in `~/.lore/publish-extras.json`, separate from new-piece drafts, so
staging one never discards the other. The three values replace the piece's
current ones together. Edge check: `app/desktop/support/edge.sh extras`.
