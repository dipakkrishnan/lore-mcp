---
id: XC-104
title: Start the Python stand-in node once per test class, not per test
priority: P1
effort: S
component: cross-cutting
status: ready
related: [XC-096, XC-097]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
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
