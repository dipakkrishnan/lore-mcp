---
id: APP-007
title: Show durable owner-job status on Today
priority: P1
effort: M
component: desktop-app
status: completed
related: [APP-003, APP-004, APP-005]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-22
updated: 2026-09-03
---

## Problem

Capture, synthesis, and deployment activity disappears when its live agent
event ends. Owners need a small durable record of what ran, whether it
succeeded, and what it cost, without storing transcripts, prompts, or
credentials.

## Proposed approach

Add one owner-jobs table to Lore's existing SQLite database and expose its
summary in the desktop snapshot. Record only real app-initiated runs and
scheduled synthesis runs that have a supported completion seam; keep Windup or
the operating system as the scheduler. Today renders the recent rows and the
current live event without creating a second scheduler or analytics store.

## Acceptance criteria

- [x] The existing Lore SQLite database records job kind, status, summary or
      bounded error, nullable `cost_usd`, and start/finish timestamps.
- [x] Capture, attended synthesis, and deployment runs initiated by the app
      create and finish one job row; interrupted runs become visibly
      incomplete rather than silently successful. *(Partial — see "Attended
      synthesis has no seam" below.)*
- [x] Scheduled synthesis runs are recorded only through a supported execution
      hook; if none exists, the implementation narrows scope instead of
      inferring completion from a schedule.
- [x] The versioned desktop snapshot exposes recent job summaries and Today
      renders clear running, succeeded, failed, and empty states across app
      restarts.
- [x] Job rows contain no prompt or memory body, transcript, credential, token,
      private key, or shell command.

## Notes

This is local owner-operation history, not the deployed buyer `answer_jobs`
table and not Pi transcript checkpointing.

**Prioritization pass 2026-08-26:** cleared `blockers` — `APP-003` is
`completed`. Concrete AC, no open design question. Promoted `in-review` →
`ready`.

**Implemented 2026-09-03.** One `owner_jobs` table in `lore/store.py`, written
through a new ungated `lore job` verb, exposed as an additive `jobs` key on the
still-`version: 1` snapshot, and rendered as a "Recent runs" card on Today.

*Liveness, not timeouts.* An open row carries a claim — the pid that owes it a
close, a wall-clock deadline, or both — and any reader concedes the row when
the claim expires. A capture row carries the desktop app's own pid, so a turn
may run for hours and stays `running` for exactly as long as the process that
owes it a close is alive; when the app dies the pid dies and the next snapshot
read concedes it. Reaping happens inside `recent_jobs()`, so every Today
refresh and every relaunch performs it and no second scheduler exists. The one
unsound corner is pid reuse, bounded by the 12h capture ceiling and repaired by
`finish_job` accepting an `incomplete` row, so a late real close self-heals.

*Scheduled synthesis.* windup exposes only a `before` hook, its runner `exec`s
into the agent, and the plist discards both streams — so no completion hook
exists. Rather than narrowing scope away entirely, the start is taken from that
`before` hook (`lore sync --record-job`), which the scheduler runs itself and
is therefore observed rather than inferred; success comes only from the tail
`lore sync --source automation` the prompt already instructs, and closes
nothing when no row is open, so a hand-run sync cannot invent a run. A run that
never reports is conceded as `incomplete` after 1h — measured worst case is
~17min against a daily cadence. `incomplete` is deliberately distinct from
`failed`: nothing observed a failure, and the AC's bar is that a lost run must
never read as quietly successful. **The `before` tuple must stay a single
exec'able argv** — windup joins it with `shlex`, so a `&&` would be quoted into
a literal argument and break scheduled synthesis; `test_the_pre_run_hook_stays_
one_execable_command` guards this.

*Privacy.* `summary` stores a code from a closed `JOB_SUMMARIES` set; prose is
applied at read time. Enforced three ways — argparse `choices` at the process
boundary, a `ValueError` in `finish_job`, and a field validator on read — so
there is no code path from an exception message to a column value. This matters
because `deploy.py:_run` raises with 2000 chars of raw wrangler stderr and the
push failure names `npx wrangler` commands. The rule for future call sites:
**never pass `str(error)` as a summary; always a literal.** `owner_pid` and
`deadline_at` are absent from the model and every `SELECT`, so they cannot
reach the snapshot.

*Narrowings, deliberate:*

- **Attended synthesis has no seam.** The desktop app never runs `lore sync` —
  there is no synthesis trigger in `renderer.js` or `main.cjs`. AC #2's
  "attended synthesis" is therefore covered only by the attended capture turn
  (the path that actually produces memories), with the scheduled path covered
  by AC #3. A desktop synthesis button would be new product surface and belongs
  in its own item, not smuggled in here.
- **Deploy failure codes are `deployed`/`failed` only.** Threading a specific
  code through every `raise` in `deploy.py` is a ~20-site change on the exact
  path that mints raw stderr; a literal at the call site is smaller and is the
  privacy guarantee.
- **`cost_usd` is null except for capture** — only the agent turn has a usage
  number. AC #1 says "nullable", so this is compliant rather than a gap.
- **No cost roll-up on the facts strip** — the 20-row window can span a month
  and a summed figure would read as "this week".

*Testing.* Today's four states plus the empty state are covered in the real
renderer via a new `jobs` scenario in `app/desktop/support/edge.cjs` (run by
`npm run test:edge`), which drives actual Electron and screenshots the result —
rather than adding jsdom to an app with deliberately few dependencies.

*Unrelated pre-existing failure:* `tests/gate.py`'s Worker step fails locally
because `lore/node/node_modules` is missing the `@earendil-works/*` packages.
Verified identical with this branch's changes stashed; this diff touches no
file under `lore/node/`.
