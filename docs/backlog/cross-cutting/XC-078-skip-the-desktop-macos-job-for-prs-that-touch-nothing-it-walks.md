---
id: XC-078
title: Skip the desktop macOS job for PRs that touch nothing it walks
priority: P1
effort: S
component: cross-cutting
status: ready
related: [XC-077, XC-079, XC-081]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

Every run of `tests.yml` starts the `Desktop macOS checks` job (`desktop-check`,
`.github/workflows/tests.yml:49-116`), whatever the change was. The workflow has
no path filter and no job has an `if:` (`tests.yml:3-6` is the whole trigger), so
a PR that edits only `docs/backlog/`, `site/`, `lore/node/` or `tests/test_*.py`
spends about 19 macOS minutes (p50 18.9, p90 21.4 over 155 green jobs) walking an
app it did not change.

Of the 191 PRs merged in the 30 days to Oct 26, 61 (32%) touched no file the
walks, `npm test` or `npm run package` read: 27 docs/backlog/site-only PRs, 18
worker-only PRs (`lore/node/`, `feedback-relay/`, `checkout/`, `bridge/`), 7
tests-only Python PRs and 9 mixed PRs (docs+worker, docs+python). In the 200 runs
from Oct 20 19:25Z to Oct 26 14:55Z, PR runs whose PR touched no walk input were
78 of the 171 PR run-attempts and used 1,340.6 of 3,478.8 macOS minutes (38.5%),
the single largest avoidable share of the job's time. Those runs also carry the
job's about 20% flake rate (16 of the 78 failed) on changes that could not have
caused a failure, and each one holds a macOS runner slot during the busy hours
when slots run short (XC-077's Problem section has the queueing figures).

The job is not a required check (`.github/rulesets/protect-main.json:41-69` lists
nine contexts, none of them `Desktop macOS checks`), so skipping it on these PRs
changes nothing about what gates a merge; it only stops the wait and the noise.

## Proposed approach

A job-level condition, not a workflow-level one.

- Add a small `ubuntu-latest` job (call it `changes`) that checks out the PR,
  lists the files changed against the base (`git diff --name-only
  origin/${{ github.base_ref }}...HEAD` with a deep enough fetch, or
  `dorny/paths-filter`), and sets one output, `desktop`, to `true` when any
  changed path matches a walk input.
- `desktop-check` gets `needs: changes` and
  `if: needs.changes.outputs.desktop == 'true'`. Everything inside the job stays
  as it is (or as XC-077 leaves it). Pushes to `main` are XC-079's concern; until
  it lands, keep them running the job (`|| github.event_name == 'push'`), so the
  `changes` job only has to be right for `pull_request`.
- Do not use workflow-level `paths` or `paths-ignore` on `tests.yml`. With
  `strict_required_status_checks_policy: true` and nine required contexts coming
  from this workflow (`protect-main.json:39-69`), a filtered-out workflow means
  those contexts are never reported, and the PR sits at "Expected" and cannot
  merge. The skip has to live on the one job.

Walk inputs, each checked against what the job actually reads:

| path | why it is an input |
|---|---|
| `app/desktop/**` | the job's working directory (`tests.yml:52-54`); every step runs here. The only file under it the job does not read is `app/desktop/README.md`; not worth a rule |
| `lore/**` except `lore/node/**` | the walks drive the real CLI through `uv run lore` from the repo root (`app/desktop/src/state.cjs:10-13`; `support/edge.sh:22-23` and throughout) |
| `lore/node/src/price.ts`, `lore/node/wrangler.jsonc` | the one exception to the exclusion: a walk's stand-in deploy still runs `lore/deploy.py:_build`, which reads these two files' text (`deploy.py:207-219`) before handing off to the stand-in wrangler |
| `plugins/lore/skills/**` | the unpackaged app loads skills from here (`app/desktop/src/runtime.cjs:8`) and `npm run package` bundles the folder (`app/desktop/forge.config.js:48`) |
| `tests/fixtures/**` | the `connectors`/`reading` walks copy exports and feeds from it and run `granola.py` (`edge.sh:211-220`); `agents`/`firstrun` run `tests.fixtures.inbox` as the stand-in node and keyring (`edge.sh:252-254`, `edge.cjs:284,2188`) |
| `pyproject.toml`, `uv.lock` | what `uv run lore` resolves; also `packaging/wheelhouse.sh` |
| `.github/workflows/tests.yml` | the job definition itself; a change to the `changes` job's own filter must also run the job it gates |

Why the rest of `lore/node/**` is out: the walks never execute the Worker. Every
deploy in a walk goes to a stand-in `npx`/`wrangler` that exits 0 or answers from
files (`edge.sh:83-85,91,141`; `edge.cjs:280-289`), and `app/desktop/src/storefront.mjs`
is a generated copy checked in under `app/desktop/`, so a PR that regenerates it
trips the filter anyway. The Worker has four Ubuntu jobs of its own, including
`worker-smoke`, which runs a real `lore push --local` (`tests.yml:118-165,262-311`).
`contracts/`, `install.sh`, `site/`, `bridge/`, `feedback-relay/` and `checkout/`
are not read by `app/desktop/src`, `app/desktop/support` or `app/desktop/packaging`
(grep, 2026-10-26).

## Acceptance criteria

- [ ] A PR that changes only files outside the walk-input list (for example a
      `docs/backlog/` item, a `site/` change, or a `lore/node/src/` change with its
      tests) finishes CI with no macOS job in about 2.5 minutes (over the 200 runs
      in the window, the Linux jobs alone span p50 2.2 min, p90 2.5 min).
- [ ] A PR that changes any file in the walk-input list, including one that
      touches only `plugins/lore/skills/`, `tests/fixtures/` or `uv.lock`, still
      runs `Desktop macOS checks`.
- [ ] The skip is visible in the run as a skipped `Desktop macOS checks` job (grey,
      "skipped"), not as a job that is absent from the run.
- [ ] The required Linux checks still report on every PR, including the skipped
      ones; no PR waits on an "Expected" check.
- [ ] Over the 50 PR runs after it lands, the share of PR runs that start a macOS
      job is about 68% or less (130 of 191 merged PRs touched a walk input).

## Notes

Filed from the 2026-10-26 CI investigation (read-only against `main` @ d8530d95);
ranked 2 of 9 in its low-effort list. The 61-of-191 figure classifies the files of
each merged PR since 2026-09-26 against the input set above (PR #355 lists 100
files, the API's cap, so its class may be incomplete). The 38.5% figure is macOS
minutes of PR run-attempts in the Oct 20-26 window whose PR touched no input.

The saving depends on the input list being right. If a walk starts reading a new
folder, the list in `tests.yml` has to follow; the `.github/workflows/tests.yml`
row is there so that a PR which changes the filter also runs the job it filters.

Three separate levers came out of the same investigation and are filed apart
because each can land alone: this item (skip on PRs that cannot affect the app),
XC-079 (skip on pushes to `main`, which depends on the ruleset staying strict)
and XC-081 (cancel a PR's superseded run). Their savings overlap; do not add them.
XC-077 shortens the job itself and is independent of all three.
