---
id: APP-293
title: Keep Inventory's date on one line
priority: P2
effort: XS
component: desktop-app
status: ready
related: [APP-282, APP-183]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-11
updated: 2026-11-12
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

- [ ] An Inventory row dated "Nov 10" draws its date on one line at 1440 and 900 wide
- [ ] The row stays 32–40px tall and its price column doesn't move
- [ ] The width comes from a token, not a raw px value

## Notes

Found by APP-183's design review. This is a separate item because APP-183 only changed the row's price.

**Prioritization (2026-11-12):** Priority P2 (was P3), effort XS (was S).
Promoted to ready: unblocked, criteria checkable, and the premise checked
against the code.
