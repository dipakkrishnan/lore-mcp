---
id: XC-110
title: Bring lore/cloudflare.py to the 90/90 coverage floor
priority: P2
effort: S
component: cross-cutting
status: ready
related: [XC-087, XC-096, XC-108]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

XC-096 made the `Python unit tests` job run `tests/gate.py --python-only`,
which holds every file in `lore/` to 90% statement coverage and 90% branch
coverage, checked per file. The first run on that branch (2026-10-30, 1020
tests passing) reported one file under the floor:

| File | Statements | Branches |
|---|---:|---:|
| `lore/cloudflare.py` | 90.5% (84 statements, 8 missed) | 57.1% (14 branches, 6 partial) |

The missed lines are `75-76` (an HTTP error whose body is not JSON), `93`
(a second page of accounts), `102` (a `subdomain` error that is not
"no subdomain"), `123` (a `register` error that is not "taken") and
`127-129` (a registered name Cloudflare has not reported yet after the first
look, and one it never reports within `waits`). Every one is an error or
retry path of the Cloudflare REST client, which `tests/test_cloudflare.py`
covers only on its happy and first-failure paths. Until this lands, the
`Python unit tests` job is red on every pull request: the floor is not lowered
and no file is excluded (XC-096), so red is the floor doing its job.

## Proposed approach

Add the missing cases to `tests/test_cloudflare.py` against the stubbed
`urlopen` the file already uses: a non-JSON error body raising
`CloudflareError` with an empty error list; an `accounts()` answer whose
`result_info.total_pages` is 2, so both pages are fetched and concatenated; a
`subdomain()` error with a code other than `NO_SUBDOMAIN` re-raised; a
`register()` error with a code other than `TAKEN` re-raised; a `register()`
whose `subdomain()` reports the name only on the second look (with
`time.sleep` stubbed), and one that never does within `waits`, which returns
the name regardless. No change to `lore/cloudflare.py` is expected.

## Acceptance criteria

- [ ] `uv run python tests/gate.py --python-only` reports `lore/cloudflare.py`
      at or above 90% statements and 90% branches.
- [ ] The `Python unit tests` job is green on a branch with no other file
      under the floor.
- [ ] The floor in `tests/gate.py` is unchanged and no file is excluded from
      it.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Filed by XC-096's first run rather than lowering the floor or excluding the
  file, as that item's third criterion requires.
- The measured numbers are from macOS, Python 3.14; the Linux job measures
  the same lines, since nothing in `cloudflare.py` is platform-dependent.
