---
id: AUT-001
title: Detect the actual local scheduler before installing Claude's routine
priority: P1
effort: M
component: automation-synthesis
status: ready
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-07-26
updated: 2026-07-27
---

## Problem

`lore/automation.py`'s `setup_prompt()` / `run_setup()` (invoked by `lore
profile` to install the Claude agent's recurring memory-synthesis schedule,
per `skills/lore-onboard/SKILL.md` step 4, "Save and schedule") hardcodes the
assumption that the machine has a native "Claude Desktop Local task" facility
to install a routine into. Found during a live end-to-end test of the
lore-onboard skill: on the test machine, no such facility exists — nothing
under `~/Library/Application Support/Claude/` or `launchd`, and the one
native scheduler available (`CronCreate`) is session-only, in-memory, and
expires within days, so it can't host a persistent weekly task.

What actually runs that machine's existing scheduled Claude Code tasks is the
user's crontab driving `claude --print`, with prompt files under
`~/.claude/scheduled-tasks/<name>/` — a different mechanism than what
`setup_prompt()` assumes and asks the headless agent to use. The headless
install failed as a result: the agent it spawned tried to write a matching
crontab entry and was blocked by the permission classifier (non-interactive
session, no human present to approve), and correctly aborted without making
any changes rather than routing around the denial. Net effect: profile.json
and the prompt file get written, but the actual recurring schedule silently
never gets installed on any machine that doesn't use Claude Desktop's Local
routines.

## Proposed approach

Have the Claude scheduling path detect (or ask) which local scheduling
mechanism actually exists on the machine — Claude Desktop Local routine vs.
user crontab vs. none — instead of assuming Desktop routines universally
exist, and branch `setup_prompt()`/`run_setup()` accordingly (crontab install
could mirror `install_codex()`'s direct-write approach rather than going
through a headless agent call at all). Separately, handle the
permission-denied case more gracefully: if a headless install can't get a
required permission, surface the exact command for the owner to run
themselves (this is what happened here as a fallback, but only because the
headless agent improvised it — it isn't something `lore` itself produces or
displays).

## Acceptance criteria

- [ ] On a machine without Claude Desktop's Local task facility, `lore
      profile` either installs a working recurring schedule via the
      mechanism that actually exists (e.g. crontab), or fails with a clear
      message plus the exact command the owner can run by hand — never a
      silent no-op.
- [ ] `run_setup()`'s headless-agent failure path (permission denial,
      timeout, or any other non-zero outcome) surfaces actionable output to
      the calling `lore profile` invocation instead of just raising a bare
      `OSError` with subprocess output.

## Notes

Found and written up during a live test of the `lore-onboard` skill
(2026-07-26 session, `test-lore-e2e`). The headless agent that hit this
diagnosed it in detail on its own (checked
`~/Library/Application Support/Claude/`, `launchd`, and `CronCreate`'s
docs) and proposed a crontab entry matching the existing dispatch-task
convention, but chose the wrong day of week (Sunday vs. the Monday the owner
had actually chosen) — worth double-checking day-of-week plumbing once this
is fixed, not just the scheduler-detection logic.
