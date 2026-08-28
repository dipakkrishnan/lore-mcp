---
id: AUT-003
title: Bring the Codex executor to parity with Claude for synthesis
priority: P2
effort: S
component: automation-synthesis
status: ready
related: [AUT-001, AUT-002, XC-016, APP-004]
blockers: []
dependencies: ["windup (separate repo) for the `before` and `reasoning_effort` changes"]
github_issue: null
created: 2026-08-22
updated: 2026-08-26
---

## Problem

The profile offers Claude or Codex as the synthesis executor as if they were
interchangeable, but `install()` and windup treat them differently, and the
shared prompt assumes Claude's shape. Reading agent sessions is *not* the
gap: Codex's sandbox allows reads everywhere (its 2026-07-27 run read
`~/.claude` memory files through `lore sync` without trouble). The real
differences are:

- Neither executor is told where sessions live. The prompt says "prior agent
  sessions" with no path; Claude is handed `~/.claude` and `~/.codex` as
  `--add-dir`, Codex is handed nothing. In the owner's home this week that is
  23 Claude and 36 Codex session files the job could have read.
- `before` (`lore sync`) is a real pre-step in Claude's launchd runner but a
  "First run `…`" sentence prepended to Codex's prompt, because the Codex
  scheduler takes only a prompt.
- The prompt tells the executor to delegate cold-start slices to subagents;
  `codex exec` has no subagent tool, so a large first pass runs single-threaded
  and the instruction is noise.
- Codex automations accept `reasoning_effort` (the owner's other automations
  set it); windup never emits it, and the profile has no field for it.
- Codex automations only fire while the Codex desktop app is running; Claude's
  is a plain launchd job. The app's executor choice does not say so.

## Proposed approach

In `lore/automation.py`: put concrete session globs derived from
`claude_home()` and `codex_home()` into the prompt for both executors, and
make the subagent instruction conditional on the tool existing. In windup:
emit `reasoning_effort` when the task carries one, and either run `before`
for Codex through the same runner shape Claude uses or drop `before` for
both in favour of the prompt's first instruction, so the two paths stop
diverging. In the app's profile step, state the "Codex app must be running"
condition next to the Codex option. No change to which executor is default.

## Acceptance criteria

- [ ] The generated prompt names the Claude and Codex session directories
      explicitly, for either executor.
- [ ] The subagent instruction appears only when the executor has one.
- [ ] A Codex task installs with `reasoning_effort` when the profile sets it.
- [ ] `lore sync` runs before synthesis under Codex by the same mechanism as
      under Claude, or neither uses `before` and the test pins the prompt's
      first instruction instead.
- [ ] The profile step's executor choice states the Codex-app-running
      condition.

## Notes

Raised 2026-08-22 after a first read suggested Codex could not reach
sessions; checking windup's installer and Codex's sandbox showed reads are
fine and the gaps are the ones above. Codex `exec` also accepts `--add-dir`
if a write outside `~/.lore` is ever needed; it is not today.

**Prioritization pass 2026-08-26:** No blockers on the lore-mcp side (the windup dependency is noted, not blocking); five concrete, independently-checkable gaps. Promoted `in-review` → `ready`.
