---
id: APP-293
title: Keep Inventory's date on one line
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-282, APP-183]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-11
updated: 2026-11-13
---

## Problem

Inventory's date column is `var(--s-10)` wide (`.irow .age` in `app/desktop/src/styles.css`). A two-digit day such as
"Nov 10" or "Nov 11" doesn't fit, so it wraps onto two lines and the row grows past its one-line height. Design
principles section 4 says every collection is a list of one-line rows. It shows in the `store` walk's
`inventory-rows-dark.png` on main (7bda09a0) and in APP-183's dark screenshots. A month with a two-digit day wraps
every row.

## Proposed approach

Size the date column to the widest short date ("Sep 30") with a token, and add `white-space: nowrap`, so the price
column after it stays where it is. Check the row at 900px wide too, where the walks' layout scan already looks.

## Acceptance criteria

- [x] An Inventory row dated "Nov 10" draws its date on one line at 1440 and 900 wide
- [x] The row stays 32–40px tall and its price column doesn't move
- [x] The width comes from a token, not a raw px value

## Notes

Found by APP-183's design review. This is a separate item because APP-183 only changed the row's price.

**Prioritization (2026-11-12):** Priority P2 (was P3), effort XS (was S).
Promoted to ready: unblocked, criteria checkable, and the premise checked
against the code.

**Implementation (2026-11-13):** A new `--col-date: 48px` token in `:root`
(beside `--col-status`), and `.invrow .age { width: var(--col-date);
white-space: nowrap; }`. The price (`.cost`) is the row's last, fixed-width
column, so it stays where it is. Pinned in two places:

- `test/unit/app.test.cjs` checks the token and the rule.
- The `store` walk (`support/edge.cjs`) shows every Inventory row dated "Nov 10"
  at 1440 and 900 wide. It checks the date draws on one line, the row is
  32-40px tall, and the price's right edge doesn't move. Without the rule it
  measured two lines at both widths, and with it one.

The design review found no break. The walk's dark `inventory-rows-dark` shot
shows "Nov 13" on one line. Only Inventory's rule changed: the Inbox's
`.irow .age` keeps `var(--s-10)`.
