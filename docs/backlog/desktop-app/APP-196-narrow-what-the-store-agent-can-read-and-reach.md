---
id: APP-196
title: Stop giving every agent task read access to the other agents' history
priority: P2
effort: S
component: desktop-app
status: ready
related: [APP-005]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-07
updated: 2026-10-24
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

- [ ] A task that doesn't mine agent history can't read `~/.claude/projects` or `~/.codex/memories` from any tool (bash, read, edit).
- [ ] The tasks that do mine agent history still can, and a real setup and synthesis run still succeeds.
- [ ] A test pins `sandboxPolicy`'s `allowRead` per task so the history directories can't drift back in for all of them.
