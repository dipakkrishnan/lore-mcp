---
id: CLI-018
title: Show prices below a cent, and past two decimals, as the desktop does
priority: P2
effort: S
component: cli-ux
status: completed
related: [APP-211, APP-019]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-11
updated: 2026-11-11
---

## Problem

Lore keeps prices to six decimals: `lore price` stores `round(amount, 6)` (lore/cli.py:1746), and a deploy
accepts anything from $0.000001. But every price the CLI prints uses `:.2f`. Reproduced on main:
`lore price 0.001` says "Publication price set to $0.00", and `lore price` then says "$0.00 per publication".
A seller at $0.001 sees $0.00 for every sale and for the total, and `lore price 1.239` shows "$1.24", which
isn't what the store charges. `lore price 0.0000004` is stored as `0.0` (free), but because the free check
compares the typed amount (`amount == 0`), it says "Publication price set to $0.00" instead of "Publications
are free". The desktop already shows these prices whole: `Intl.NumberFormat` USD with
`maximumFractionDigits: 6` (app/desktop/src/state.cjs:255, renderer.js:221; APP-211).

The sites in lore/cli.py:
- 1625: `lore sales` total
- 1630: `lore sales` row
- 1698: `lore status` publication price
- 1704: `lore status` answer price
- 1737: `lore price` with no amount
- 1751: `lore price <USD>`
- 1835: `lore answer on`

## Proposed approach

Add one money formatter in cli.py that matches the desktop's rule: at least two decimals, at most six,
with trailing zeros trimmed past the second ($0.001, $1.239, $0.50, $1.00). Use it at the seven sites. Base
the free/paid line in `price()` on the stored, rounded value. Leave `CARD_MINIMUM_USD:.2f` (cli.py:1743,
3015-3016) and the SQL `:.6f` lines alone.

## Acceptance criteria

- [x] `lore price 0.001` prints "$0.001", and `lore price` then prints "$0.001 per publication".
- [x] `lore status` shows a $0.001 publication price and a $0.001 answer price as "$0.001";
      `lore answer on` at 0.001 says "$0.001 per answer".
- [x] `lore sales` with three $0.001 sales shows "$0.003" as the total and "$0.001" on each row.
- [x] `lore price 0.0000004` says publications are free.
- [x] tests/test_cli.py:1188 and :1196 change from "$1.24" to "$1.239". Two-decimal prices are unchanged:
      the $0.01 sales tests (around test_cli.py:191-201) and "enabled at $0.50" (around :1401) still pass.

## Notes

Found 2026-11-11 by the lore-worker while reading the deploy price guard (`MINIMUM_PRICE`,
lore/deploy.py:133) after TEST-deploy (#697). APP-211 and APP-019 cover the desktop only.

**Prioritization pass 2026-11-11:** Promoted `in-review` → `ready`: no blockers or dependencies, criteria give exact commands, outputs and the test lines to change.

**Implementation 2026-11-11:** Added `_usd()` in lore/cli.py: it formats to six decimals, trims trailing
zeros and keeps at least two, the same output as the desktop's `Intl.NumberFormat` with
`maximumFractionDigits: 6`. The seven sites use it. `lore price` now bases the free/paid line on the stored
value `round(amount, 6)`, so 0.0000004 says "Publications are free". Formatting at six decimals also absorbs
float noise in the sales total (three $0.001 sales sum to 0.0030000000000000005 and print $0.003).
`CARD_MINIMUM_USD:.2f` and the SQL/manifest `:.6f` lines are unchanged.

Tradeoffs and follow-ups:
- The desktop's `Intl` output has thousands separators ($1,000.00) and the CLI's doesn't. No current price is
  that large; `f"{amount:,.6f}"` would add them if a seller ever needs it.
- Python rounds half to even at the seventh decimal and `Intl` rounds half away from zero, so a price with
  seven or more decimals can differ by $0.000001. Prices are stored to six decimals, so this only affects
  float sums.
- `lore answer on 0.0000004` passes the `price <= 0` check, rounds to 0.0, and then `AnswerSettings`
  refuses it after the charter is approved, with the generic "cannot be enabled without ... a positive
  answer price" error. It wasn't changed here and could become its own follow-up.
