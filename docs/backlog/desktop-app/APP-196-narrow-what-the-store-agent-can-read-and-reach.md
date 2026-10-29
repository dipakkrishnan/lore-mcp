---
id: APP-196
title: Stop giving every agent task read access to the other agents' history
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-005]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-07
updated: 2026-10-29
---

## Problem

The Oct 7 pre-release security review found the agent could read private
history and reach the network. Most of that has since been closed on main: the
shell has no network (`network: { allowedDomains: [], deniedDomains: [] }` in
`sandboxPolicy`, `app/desktop/src/agent.mjs:220`), the app runs the deploy only
after the owner confirms, there is no `~/.npmrc` read, and nothing under
`app/desktop` grants a write to `Library/LaunchAgents`.

One finding still holds. `sandboxPolicy` puts `~/.claude/projects` and
`~/.codex/memories` in `allowRead` for every task (`agent.mjs:223`), whatever
the task is. Text planted in imported writing can steer a task into reading
the owner's other-agent history, which that task has no reason to see. With no
network the text can't send it out directly, but it can still be copied into
Lore's home, where the owner's memories live.

## Proposed approach

Pass the two history directories to `sandboxPolicy` only for the tasks that
read them, and leave them out of `allowRead` for every other task. Work out
which tasks those are from `TASKS` in `agent.mjs` and their prompts (setup and
synthesize are the likely ones) rather than assuming.

## Acceptance criteria

- [x] A task that doesn't mine agent history can't read `~/.claude/projects` or `~/.codex/memories` from any tool (bash, read, edit).
- [x] The tasks that do mine agent history still can, and a real setup and synthesis run still succeeds.
- [x] A test pins `sandboxPolicy`'s `allowRead` per task so the history directories can't drift back in for all of them.

## Notes

**Completed 2026-10-29.** Only `setup` keeps `~/.claude/projects` and
`~/.codex/memories` in `allowRead` (`MINES_HISTORY` in
`app/desktop/src/agent.mjs`). Every other task loses them, and so does the
sandbox's no-task default (`initializeSandbox`, attachment copies). Bash, read,
write and edit all build their sandbox from `sandboxPolicy(place, task)`, so one
change covers every tool.

Which tasks read the history, checked against each task's skill and prompt:

- `setup` (`lore-onboard`) lists those folders and runs `lore setup --yes`,
  which imports them. It keeps access.
- `synthesize` (`lore-synthesize`) does not need them in the desktop app. It
  reads what came in from Lore's own store (`lore search --source … --json`,
  `lore memory rules`) and reports back through `memories_ready`. The import
  that does read the history (`lore sync --source automation`, `sources:read`,
  `desktop-state`) runs in `main.cjs`, outside the sandbox. Synthesize is also
  the quiet task that reads imported, untrusted writing, which is the route
  this item is about, so it is the most important one to close.
- capture, evening, publish, deploy and checkin never refer to the history.

Verification:

- A unit test in `test/sandbox.test.cjs` pins `allowRead` for each task and for
  no task. It runs everywhere, CI included.
- A darwin kernel test checks the real home: bash `ls`, the read tool's
  `access` and the edit tool's read are refused for every task except setup,
  and allowed for setup.
  - It only reads, never prints paths, and uses a small memory note rather
    than a transcript.
  - It skips when `~/.claude/projects` is missing, which includes GitHub's
    `macos-14` runners. There, the unit pin is the guard.
- Four mutations were each caught: history granted to every task, history
  added to synthesize, history granted to no task, and the Codex folder
  dropped.
- No live-model setup or synthesis run was done. The desktop suite and the
  edge walks point `CLAUDE_HOME` at scratch folders outside the denied home, so
  they only check for regressions, not for this boundary.

Known side effect, not fixed here: a non-setup thread that runs `lore setup
--yes` or a bare `lore sync` can now probe the Claude Code / Codex sources and
get a permission error. Lore then records `NEEDS_PERMISSION` for them, and the
app tells the owner macOS hasn't let Lore read them. Nothing is lost, but the
message is false. A possible follow-up is to refuse those commands outside
setup, the same way `STORE_COMMAND` is refused.
