---
id: AUT-002
title: Synthesize net-new claims from recent sessions, named by the claim
priority: P1
effort: S
component: automation-synthesis
status: in-progress
related: [AUT-001, XC-016, APP-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-22
updated: 2026-08-22
---

## Problem

The owner's library holds files titled "Memory synthesis — 2026-08-18" and
"Memory synthesis — 2026-08-11": one catch-all per run, named by date, with
nothing in the title that tells an agent whether to open it. Each run also
re-states much of the previous one rather than asking what the owner's agents
did since last time. The prompt in `build_prompt` already asks for topic files
and for focusing on newer context, but it neither says how to find "newer"
(the session files changed in the last cadence window) nor requires checking
the library before writing, so nothing stops a run from re-synthesizing what
is already kept.

## Proposed approach

In the generated prompt: on later runs, list Claude and Codex session files
modified within the last cadence window (day or week from the profile), read
the ones that suggest a decision, lesson, or firsthand evidence, and search the
library for each candidate claim before writing so only net-new or superseding
content lands. Name files and titles by the claim they hold, never by date or
the word synthesis. No schema or scheduler changes.

## Acceptance criteria

- [ ] The generated prompt names the recency window that matches the profile's
      cadence and tells the executor to search the library before writing.
- [ ] The generated prompt forbids date- or run-named files and gives a
      concrete example of a claim-named file and title.
- [ ] `tests/test_automation.py` pins both.

## Notes

Found while dogfooding the desktop app on 2026-08-22. The job actually
running on the owner's Mac is a Codex automation installed 2026-07-27 from an
older prompt (`~/.codex/automations/lore-memory-synthesis/automation.toml`):
it writes one `Memory synthesis — DATE` file, references statuses and a
`--source` value the CLI no longer accepts (its own run log says so), and
`~/.lore/automation/` holds no profile or prompt, so the app reports the
profile as not set while the stale job keeps running. Re-running "Choose how
Lore learns from your agents" reinstalls under the same task id and replaces
it. That drift is XC-016's problem; this item only sharpens the prompt.
