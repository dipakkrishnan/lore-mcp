---
id: XC-073
title: Shard the Desktop macOS CI job so a run finishes in five minutes
priority: P1
effort: S
component: cross-cutting
status: in-progress
related: [XC-072, APP-066]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

A green CI run (`.github/workflows/tests.yml`) takes 18–21 minutes: the median of
the last 30 green runs is ~1190s, the worst 1814s. Every job but one finishes in
under 2.5 minutes. The whole critical path is the single `desktop-check` job
("Desktop macOS checks", `macos-14`), measured over three green runs on Oct 26:

| Part of `desktop-check` | Time | Share |
|---|---|---|
| checkout, setup-node, setup-uv, `npm ci` | ~26s | 2% |
| `npm test` | 116–135s | 10% |
| 22 serial `support/edge.sh <persona>` Electron walks | ~966s | 80% |
| `npm run package` | 71–95s | 7% |

The walks run one after another, each a fresh Electron launch driving the renderer
with timer-based waits; `agents` alone is 227–260s, `automations` 83–96s, and
`connectors` runs twice (light and dark). Three things make the twenty minutes cost
more than they look:

1. A flaky walk fails late and forces a full rerun. The five most recent red runs
   each failed on one walk (`agents` after 402s, `update` twice, `connectors`,
   `settings`) — the flakes XC-072 tracks — and each cost another twenty minutes
   because the job is one unit.
2. The `protect-main` ruleset requires branches to be up to date, so every merge to
   `main` makes every other open pull request update and run the full twenty
   minutes again.
3. 29 of the last 40 merged pull requests touch `app/desktop`, so skipping the job
   by path would rarely help.

"Desktop macOS checks" is not a required status check (those all finish in ~2.5
minutes); people wait on it by convention, which is right. The fix is to make the
wait short.

## Proposed approach

Split `desktop-check` into five macOS jobs that run side by side, balanced from the
measured walk times so each lands at about four minutes:

| Job | Steps |
|---|---|
| `desktop-check` | `npm run check`, `npm test`, `npm run package` |
| `desktop-walks-agents` | `agents` |
| `desktop-walks-store` | `automations`, `connectors`, `connectors` (dark), `store` |
| `desktop-walks-today` | `checkin`, `today`, `fresh`, `settings`, `cards`, `seller` |
| `desktop-walks-rest` | `schedule`, `quiet`, `reading`, `update`, `sales`, `feedback`, `obsidian`, `jobs`, `sell`, `faq`, `provision` |

Five, not more: GitHub-hosted macOS runners are capped at five concurrent jobs per
account, so a sixth would only queue. Explicit jobs with explicit per-persona steps
rather than a matrix with a loop, so a red step still names the persona that broke
(APP-066) and `test/ci-edge.test.cjs` keeps working unchanged. Also: a workflow
`concurrency` group so a new push to a pull request cancels the run it supersedes
(freeing the capped macOS runners), a 15-minute job timeout so a hung shard cannot
sit for GitHub's six-hour default, and `setup-uv`'s cache so each shard's first
`uv run` restores the venv (including the git-sourced `windup` dependency) instead
of building it.

Not done here, on purpose: running walks concurrently inside one runner (`macos-14`
has three vCPUs and the walks are full of fixed sleeps — exactly what XC-072 is
trying to make less flaky), path-filtering `app/desktop`, and shaving the walks'
own waits (XC-072's territory).

## Acceptance criteria

- [ ] A green CI run on a pull request finishes in under 7 minutes wall-clock,
      measured over the 20 runs after this lands (was ~20).
- [ ] Every `test:edge` persona still has its own named step
      (`app/desktop/test/ci-edge.test.cjs` passes), and the set of walk steps across
      the four `desktop-walks-*` jobs is exactly the 22 that `desktop-check` ran.
- [ ] A walk that fails is rerun with "Re-run failed jobs" in under 7 minutes
      without rerunning the other shards.
- [ ] No more than five macOS jobs per run.
- [ ] A second push to a pull request cancels the run in progress for it; pushes
      to `main` are never cancelled.

## Notes

Two policy levers were left alone because they are the owner's call, not this
item's:

- `strict_required_status_checks_policy: true` in `.github/rulesets/protect-main.json`.
  Keeping it means every merge still makes every open pull request update and
  rerun — now ~5 minutes instead of 20. Turning it off removes that cycle at the
  cost of merging a branch that was never tested against the exact `main` it joins.
- Making the desktop jobs required checks. They would be fast enough now, but at
  XC-072's ~5.7% flake rate they would block merges of unrelated pull requests.
  Revisit once XC-072 lands.

When a persona is added, or a walk's time changes a lot, put it in (or move it to)
the shortest shard; the comment above the walk jobs in `tests.yml` records the
timings the shards were balanced from.
