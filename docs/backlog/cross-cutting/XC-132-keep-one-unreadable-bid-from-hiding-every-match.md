---
id: XC-132
title: Keep one bid with an unreadable expiry or amount from hiding every match
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [APP-274, APP-288, MON-051]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-15
updated: 2026-11-15
---

## Problem

One bid on the board whose `expires` Python cannot read stops `lore bids
match` for every other bid. The desktop then shows no bid notifications and
does not refresh the Bids page until that bid leaves the board. The CLI
promises the opposite: "one bid the board shows oddly never hides the rest"
(`lore/cli.py:1472`). That only holds for fields `OpenBid` validates.

How it happens: `expires` is a plain `str` (`lore/bids.py:77`). It is parsed
later, in `OpenBid.live()` (`:79-82`), which `BidMatcher.matches()` calls on
every bid before it matches any of them. Two cases fail:

- `"expires": "next week"`: `datetime.fromisoformat` raises `ValueError`.
  `main()` prints `lore: Invalid isoformat string: 'next week'` and exits 1.
  It also records a `cli.failed` usage event, because `("bids", None)` is
  not in `POLLED_READS` (`cli.py:94`). That is one event per look, about 96
  a day.
- `"expires": "2099-12-01T00:00:00"` (no offset) or `"2099-12-01"` (date
  only): the naive datetime is compared with an aware `now`, which raises
  `TypeError`. The CLI exits 1 with a traceback.

The desktop's `boardBids` (`app/desktop/src/bids.cjs:42-46`) checks only
that `expires` is a string, so both bids reach the CLI. `matchBids`
(`state.cjs:600`) rejects, and `BidWatch.#check` throws at `bids.cjs:122`
before it saves anything at `:125`. So the matches and the stored board stay
stale. `watchBids` logs `Lore could not read the bids board` and tries again
on the next look (`main.cjs:169-171`); the owner sees nothing.

`usd` is a bare `float`, so `0` and negative amounts validate. The desktop
passes them too: `Number.isFinite` lets them through. The owner is then
told "Someone will pay $0" or "$-5".

The following reach the CLI only when a person or agent pipes a board in
directly. The desktop filters all of them out before it calls the CLI.

- A board that is a JSON array crashes with a traceback (`AttributeError`).
- `{"bids": {}}` and `{"bids": null}` crash with a traceback. The exception
  type varies with the Python version.
- `{"bids": "abc"}` slices the string, silently.
- `NaN` and `Infinity` in `usd` validate, because `json.loads` reads them.
  A matched one would be printed as a bare `NaN`, which is not valid JSON.

Reproduced on `8f2c1669`: the expiry cases and the board-shape cases, by
piping a board into `uv run python -m lore bids match` with a temporary
`LORE_HOME`. Not run: the NaN output against a matching memory. That case,
and the desktop consequences, are read from the code.

## Proposed approach

Check every field that `live()` and the desktop rely on when the bid is
validated. An unusable bid is then skipped like any other bid that fails
validation.

- **`OpenBid.expires`:** add a field validator. It parses the value with
  `datetime.fromisoformat` after replacing `Z`, requires an offset, and
  raises `ValueError` otherwise. `live()` can then never raise.
  - The field stays a string, so `model_dump` hands back the board's own text.
  - The forms `fromisoformat` accepts differ by Python version. 3.11+ also
    accepts basic forms like `20991201T000000Z`, and any fraction length.
    That is fine: the Worker always writes `YYYY-MM-DDTHH:MM:SSZ`
    (`site/src/bids.js:45`), and a form only one version reads is still
    skipped, never fatal.
- **`OpenBid.usd`:** `Field(gt=0, allow_inf_nan=False)`.
  - `gt=0` alone lets `Infinity` through, so both settings are needed.
  - Do not copy the contract's 5–1000 range (`contracts/bids.md:137`).
    `POST /bids` enforces it, and a client copy would drift when the range
    changes.
- **`bids_match()`:**
  - A board that is not a JSON object, or whose `bids` is present but not a
    list, raises `ValueError("the bids board is not readable")`: one `lore:`
    line and exit 1, like "too big".
  - A missing `bids` key still means no bids: `[]`, exit 0.
  - Print with `json.dumps(..., allow_nan=False)` as a backstop.
- **`boardBids` in `bids.cjs`:** also require
  `Number.isFinite(Date.parse(bid.expires))` and `bid.usd > 0`.
  - This keeps a bad bid out of the CLI call and out of the stored board.
  - `BidWatch.board()` (`bids.cjs:86-89`) already hides a date that
    `Date.parse` cannot read.
  - JS reads date-only and offset-less strings that Python refuses, so the
    Python check is the one that matters.
- **`contracts/bids.md`** "Matching on the seller's Mac": list the new drop
  rules (an unreadable or offset-less `expires`, a `usd` that is not a
  positive number) and the refusal of a board that is not an object.

Out of scope: lax coercion of `usd` (`true` and `"20"` both validate; the
desktop filters them), and statuses outside the contract (`live()` already
treats them as ended).

## Acceptance criteria

- [ ] **Unreadable expiries are skipped.** In `tests/test_bids.py`, a board
      holding the fixture's answerable bids plus one bid each with `expires`
      set to `"next week"`, `"2099-12-01T00:00:00"` and `"2099-12-01"`
      (each reusing an answerable bid's question) exits 0. It prints the same
      matches as the fixture board alone. This test fails on `8f2c1669`.
- [ ] **Bad amounts are skipped.**
  - `OpenBid.model_validate` rejects `usd` of `0`, `-5`, `NaN` and `Infinity`.
  - A board holding such bids, each reusing an answerable bid's question,
    prints only the well-formed bids.
  - The output parses with `json.loads(..., parse_constant=...)` set to raise.
- [ ] **`live()` never raises** for a bid that validates. Assert this for a
      `+05:00` offset, a `Z`, and a 3-digit fraction such as
      `2099-12-01T00:00:00.123Z`. A 3-digit fraction keeps the test valid on
      the 3.10 floor.
- [ ] **A board of the wrong shape is refused plainly.**
  - `lore bids match` on `[]`, `{"bids": {}}`, `{"bids": null}` and
    `{"bids": "abc"}` exits 1 with one `lore: the bids board is not
    readable` line on stderr and no traceback.
  - `{}` still prints `[]` and exits 0.
- [ ] **The desktop drops the same bids.** In
      `app/desktop/test/unit/bids.test.cjs`, `boardBids` drops a bid whose
      `expires` is `"next week"` and one whose `usd` is `0` or negative.
      `npm run check` and the unit tier in `app/desktop` pass.
- [ ] **The contract lists the new rules.** The "Matching on the seller's
      Mac" section of `contracts/bids.md` names the new drop rules and the
      refusal.
- [ ] **Checks pass.** `uv run python tests/gate.py --python-only` passes,
      and so do ruff check, ruff format --check and mypy (paths as in
      `XC-048`).

## Notes

Found by reading `lore/bids.py` for ideation on 2026-11-15. No other backlog
item mentions `OpenBid`, `boardBids` or `bids match`. APP-274 built the
matcher. APP-288 keeps the last board for the Bids page, and that is the copy
that goes stale here.

Collision note for whoever implements this: open PR #626 (MON-052) changes
`lore/cli.py`. This change touches only `bids_match()`. Check #626's diff
again before you start.
