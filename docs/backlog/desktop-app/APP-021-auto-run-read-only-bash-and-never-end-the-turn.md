---
id: APP-021
title: Auto-run read-only bash, guide instead of terminate, and load only bundled skills
priority: P0
effort: S
component: desktop-app
status: completed
related: [APP-004, APP-008, APP-020, XC-021]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

The first dogfood of the APP-020 build stalled on "Let's set up my Lore":
the model composed two sensible read-only compound commands (status +
checkpoint probe, `find` over agent memory piped to `head`) and the
exact-regex table blocked both with an unusable reason, showed two
attention lines, and — worse — silently swallowed `lore setup --yes`
inside the compound. Separately, pi's default skill discovery loaded the
stale `~/.agents/skills` copy installed by install.sh, shadowing the
bundled skills, so the desktop ran the old serial interview instead of
`propose_blueprint`. Card copy also ran long.

## Proposed approach

Keep the exact rows for writes and add a read-only fallback: a command is
auto-allowed when every `;`/`&&`/pipe segment starts with a read-only
binary (ls, cat, head, tail, grep, find, wc, which, printf, echo, …) or a
read-only `lore` subcommand, contains no substitution, backticks,
newlines, `..`, or redirects beyond `2>&1`/`2>/dev/null`, and every
absolute path stays under `.lore`/`.claude`/`.codex`. Everything else
blocks with one instructive reason and never terminates the turn — the
60-turn cap is the thrash guard. Pass `noSkills: true` so only the bundled
skills load, and add a brevity rule to the system prompt. The security
boundary story is unchanged and still lands with APP-008 (sandbox-first).

## Acceptance criteria

- [x] The two compound commands from the 2026-08-23 transcript that are
      read-only auto-run; the one containing `lore setup --yes` blocks
      with guidance naming the read-only set.
- [x] No policy block carries `terminate`; no "Lore stopped" line is
      emitted for out-of-policy commands.
- [x] Reads outside `.lore`/`.claude`/`.codex`, `..` traversal, `-exec`,
      substitution, and non-stderr redirects stay blocked.
- [x] Only bundled skills are visible to the desktop session.
- [x] The system prompt asks for short messages, questions, and options.
- [x] Desktop typecheck and tests pass.

## Notes

Grounded in `~/.lore/.pi/sessions/setup/` transcript from the first live
run. The stale `~/.agents/skills` and `~/.claude/skills` copies were also
refreshed from `plugins/lore/skills` for other hosts. This widening is
UX, not a boundary change: the boundary work remains APP-008.
