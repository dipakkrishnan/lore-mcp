---
id: XC-104
title: Start the Python stand-in node once per test class, not per test
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [XC-096, XC-097]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-31
---

## Problem

`uv run pytest --durations=40` on 2026-10-29 shows no slow Python test, but a
flat cost: the slowest 40 entries sum to about 35 s of the suite's 84 s, and
from the sixth entry on they are all 0.52-0.60 s tests in `tests/test_agents.py`
and `tests/test_inbox.py`. Those classes use `NodeCase`
(`tests/helpers.py:96-117`), which in `setUp` builds the D1 fake and starts a
`ThreadingHTTPServer` from `tests/fixtures/inbox.py` for every test, about 60
times per run. The half second is server start and teardown, not the
assertion.

## Proposed approach

Start the stand-in node once per class in `setUpClass`, and in `setUp`
reset the SQLite file (or the D1 fake's tables) it serves, so each test
still begins from a clean store without a fresh process or thread. Keep the
per-test `LORE_HOME` temp dir from `LoreTestCase`. Measure before and after
with `--durations`.

## Acceptance criteria

- [ ] `test_agents.py` and `test_inbox.py` tests take under 0.1 s each
      except the ones that are slow for their own reason, named in Notes.
- [ ] The local suite is 25 s or more faster than the 84 s baseline, and the
      `Python unit tests` CI job is under 75 s (today 104 s).
- [ ] No test depends on state another test left in the shared node; running
      either file with `--randomly-seed` or in reverse order passes.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream D1 of the test-pyramid plan.
- `tests/test_feed.py:29` and `tests/test_hosted.py:34` already patch
  `FeedReader.fetch` and `HostedReader.connect` in-process rather than
  serving; they are the model if a class turns out not to need a real
  socket at all.

### Back to in-review, 2026-10-31

An attempt stopped before shipping and moved this back from `ready`, because the
criteria cannot be met as written and the fix overlaps two open PRs. Nothing was
implemented. Measured on main c0fd2724 with `test_agents.py` + `test_inbox.py`
(64 tests, 58 of them on `NodeCase`), on a loaded Mac (load about 2.7), three runs each:

| Variant | Seconds | Call phase at or over 0.1 s |
|---|---|---|
| Today | 35.5, 40.8, 34.9 | 58-59 tests |
| `serve_forever(poll_interval=0.01)`, one server per test | 14.4, 47.5, 10.6 | 43-56 tests |
| One server per class, new D1 and Endpoint per test | 17.1, 12.3, 12.2 | 39-43 tests, plus 6-7 class-stop teardowns |

The 47.5 s run is unexplained and was not rerun, so load noise is a guess. Both
fixes passed all 64 tests in every run.

- The half second is `shutdown()` waiting out `serve_forever`'s default 0.5 s
  poll, not server start. PRs #559 (XC-043) and #560 (XC-073) both already make
  that one-line change in `tests/fixtures/inbox.py`, and it recovers about the
  same time as the class-level server.
- The first criterion's "under 0.1 s" cannot hold through its exception clause:
  about 40 of the 64 tests stay over it. A plan-review profile put the remaining
  cost in rebuilding argparse on each `cli.main`, `Store` setup and HTTP round
  trips. Reaching 0.1 s means changing `lore/cli.py`, which this item does not cover.
- The CI target needs 29 s saved from 104 s. Removing the stop wait entirely
  saves at most 58 x 0.5 = 29 s, so under 75 s is not reachable from this
  change alone. The 25 s local target has no margin for the class-level server,
  which still stops 7 times (ceiling 25.5 s). Neither CI nor the whole suite was
  run with either variant.

Decisions for a maintainer:

1. Whether to land the `poll_interval` line by itself, which needs no shared
   state. Recommended, then re-measure. #559 and #560 hold it but are conflicting,
   and #559 has changes requested on other files.
2. Whether the class-level server is still worth having after that. It saves
   little more and adds shared state between tests.
3. What the 0.1 s and 75 s criteria should say, given what the measurements show.

The plan-review check found nothing that depends on a per-test server: tests only
read `self.node.url`, and a test's `clock` change stays on its own `Endpoint`. So
the class-level design remains safe if it is still wanted.
