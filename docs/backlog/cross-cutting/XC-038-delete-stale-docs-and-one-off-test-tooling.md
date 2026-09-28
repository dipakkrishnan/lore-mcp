---
id: XC-038
title: Delete stale docs and one-off test tooling
priority: P2
effort: S
component: cross-cutting
status: completed
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-09-27
updated: 2026-09-27
---

## Problem

An audit found stale, no-product-impact material accumulating with no
inbound references or CI role: a one-off manual test-run record that
duplicates the walkthrough it was copied from, a one-time manual-test-report
converter script and its test never wired into CI, four design docs
untouched since Jul 28–Aug 18 with nothing load-bearing linking to them, and
a stale `pyproject.toml` reference to a test-gate file that was renamed.

(A companion idea — pruning the ~100 `completed` `docs/backlog/**` items —
was reviewed and dropped: `AGENTS.md` rule 2 allocates the next id from the
highest-numbered file still in the folder, so deleting completed items would
make ids get reused; `.github/scripts/check_pr_title.py` requires the
referenced id's file to exist, so a later PR titled with a completed id would
fail its title check; and loosening `regenerate_index.py`'s cross-reference
check to tolerate that would also let real typos in `related`/`blockers`
through as non-errors. Backlog items stay deleted only via the ordinary
`obsolete` status, never a file removal.)

## Proposed approach

Delete the identified files outright (git history keeps everything); fix the
handful of inbound references that would otherwise break (`pyproject.toml`'s
`tests/coverage_gate.py` -> `tests/gate.py`, the manual-test walkthrough and
its README no longer instructing readers to run the deleted converter
script, `docs/test-plan-handoff.md` and `docs/backlog/docs/README.md` no
longer naming the deleted design docs). Deleting `support/manual_test_report.py`
leaves `support/` with no files at all, which breaks
`.github/workflows/tests.yml`'s ruff/mypy commands and `pyproject.toml`'s
mypy `files` list on a now-missing directory — drop `support` from those.

## Acceptance criteria

- [x] `docs/manual-test-runs/2026-09-07-shane.md` deleted (0 inbound refs).
- [x] `support/manual_test_report.py` and `tests/test_manual_test_report.py`
      deleted; `docs/manual-test-walkthrough.md` and
      `docs/manual-test-runs/README.md` no longer instruct running it.
- [x] `docs/masterclass-coaching.md`, `docs/gamified-onboarding.md`,
      `docs/manual-capture-ux.md`, `docs/agent-runtime-capture.md` deleted;
      the two docs that named them (`docs/test-plan-handoff.md`,
      `docs/backlog/docs/README.md`) updated. `docs/demo-buyer-live.md` kept
      (in active use by another agent's buyer skill).
- [x] `pyproject.toml`'s `tests/coverage_gate.py` reference corrected to the
      file that actually exists, `tests/gate.py`.
- [x] `support` dropped from `.github/workflows/tests.yml`'s ruff/mypy
      commands and `pyproject.toml`'s `[tool.mypy] files` list now that it
      has no files left.
- [x] `docs/backlog/**` `completed` items and `docs/backlog/agents/regenerate_index.py`
      / `audit.md` left untouched — the prune was dropped on review.

## Notes

`detect_completion_drift.py` flags several `in-review` items whose body
reads as done (every acceptance-criteria checkbox checked) while `status`
hasn't moved — pre-existing drift, unrelated to this cleanup, listed in the
PR description rather than acted on here per the drift script's own
contract (report, don't flip status or delete).
