---
id: XC-128
title: Fix the two flakes main hit after the test pyramid
priority: P1
effort: S
component: cross-cutting
status: completed
related: [XC-106, APP-270, XC-124, XC-109]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-09
updated: 2026-11-09
---

## Problem

Two of the three main runs after #685 failed on 2026-11-09, neither from the
code they shipped:

- **Python unit tests** (run 42655832882, XC-103's merge):
  `tests/test_usage.py::SendTest::test_an_event_leaves_with_the_install_id_the_version_and_nothing_else`
  raised `RuntimeError: cannot join thread before it is started`. The test's
  `record()` helper joined every thread that appeared during `usage.record()`.
  That included the local relay's per-request `process_request_thread`, which
  `threading.enumerate()` lists while it is still starting. More likely now
  that XC-106 runs the tier with `-n auto`.
- **Store walk** (run 42657111483, APP-196's merge, both attempts; and the
  first attempt on #685's run 42624377309): the check "a group header reads as
  a label: medium weight, on its own band, and its rows the Inbox's size",
  which APP-270 folded in from the retired inventory walk. It failed only on
  busy runners (load 51–86) and never locally, in five runs including four
  under heavy CPU load. The check folded four conditions into one boolean, so
  the log could not say which one failed.

## Proposed approach

- Name the usage sender thread (`usage.SENDER_THREAD`) and have the test join
  only that thread.
- In `support/edge.cjs`, wait for the app to go quiet (`idle()`) and for the
  look to hold (`waitFor`, 5 s) before the check. Print the measured weight,
  font size, row height and both backgrounds with the result, so another
  failure names its cause.

## Acceptance criteria

- [x] `tests/test_usage.py` passes 30 runs in a row under `-n 4`.
- [x] The store walk passes locally, and the check's line carries its
      measurements.
- [x] Layout scan: the store walk still scans every view it scanned before;
      no view scanned by the desktop walks before this change is unscanned
      after it.

## Notes

- The store fix is a wait, not a proven cause. If the check fails again, its
  detail now says which of the four conditions broke; reopen with that.
