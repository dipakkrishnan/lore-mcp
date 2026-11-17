---
id: XC-136
title: Tell an agent its occurred_at isn't a real date instead of saving it
priority: P3
effort: XS
component: cross-cutting
status: in-review
related: [XC-067, XC-100, CAP-042]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-17
updated: 2026-11-17
---

## Problem

The node's `Save` schema (`lore/node/src/agent-schema.ts`) checks `occurred_at`
against a regex for the ISO 8601 shape only. A personal agent that saves
`occurred_at: "2026-11-31"`, `"2026-02-29"`, `"2026-13-01"` or `"2026-08-01T25:61"`
gets a success. The impossible date is sealed into the inbox, and the agent never
learns that it got the date wrong. On the Mac, that date then becomes the memory's
date (CAP-042).

## Proposed approach

Add a `.refine` on `occurred_at` that keeps the regex and the existing message,
"occurred_at must be an ISO 8601 date":

- **Date part:** build the date with `new Date(0)`, `setUTCFullYear(y, m - 1, d)`,
  then check that the UTC month and day read back unchanged. Don't compare the year
  through `Date.UTC`, which maps years 0-99 to 1900-1999. Refuse year `0000`, to
  match Python's `date.fromisoformat`.
- **Time part, when present:** hours 0-23, minutes and seconds 0-59.
- **Offset, when present:** hours 0-23, minutes 0-59.

The rule is pure, so it belongs with the other leaf rules from XC-100 and can be
table-tested there.

## Acceptance criteria

- [ ] The `occurred_at` table in `lore/node/test/unit/agent-schema.test.ts` refuses
      the following with "occurred_at must be an ISO 8601 date":
      - `2026-11-31`, `2026-02-29`, `2026-13-01`, `2026-00-10` and `0000-00-00`
      - `2026-08-01T24:00`, `2026-08-01T09:60` and `2026-08-01T09:30:15+25:00`
- [ ] The same table accepts:
      - `2028-02-29`, `0050-01-01` and `2026-08-01T23:59:59Z`
      - every value it accepts today
- [ ] `npm run check` and `npm test` pass in `lore/node`.

## Notes

- Found by ideation 2026-11-17, while reproducing CAP-042.
- The Mac still has to guard on its own (CAP-042): older deployed nodes and every
  other reader can still hand it an impossible date.
- **Out of scope:** dates in the future are real days and stay accepted.
