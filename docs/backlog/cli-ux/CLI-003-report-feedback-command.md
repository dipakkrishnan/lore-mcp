---
id: CLI-003
title: Add `lore report-feedback` for interactive and scripted bug reports
priority: P2
effort: M
component: cli-ux
status: completed
related: [XC-028, APP-104]
blockers: [XC-028]
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

There is no CLI command that lets an owner report a problem. `XC-028` builds
the shared delivery core and relay; this item is the `lore` command that
drives it.

## Proposed approach

Add `lore report-feedback` to `lore/cli.py`:

- Interactive with no flags: prompt for title, optional email, and a
  multi-line description (new `ask_lines()` helper in `lore/ui.py`), then
  submit immediately — no confirmation step, matching the product decision
  that submission goes straight out.
- Non-interactive via `--title`, `--email`, and one of `--description` /
  `--description-file` (the latter accepting `-` for stdin, the repo's
  existing file-argument convention). Non-interactive mode requires `--title`
  and exactly one description source.
- Gated by `_owner_action()` like `push`/`publication revoke`/`node secret` —
  it must run from a real terminal or the attended Desktop surface, not an
  unattended pipe, since the Desktop agent's sandboxed Bash gets unrestricted
  network access during the `deploy` task.
- `--json` prints the relay's receipt (`{"url": ..., "number": ...}`) for the
  Desktop app to parse.

## Acceptance criteria

- [x] `lore report-feedback` (no flags) walks an interactive prompt and files
      a report.
- [x] `lore report-feedback --title T --email E --description-file F --json`
      files a report non-interactively and prints machine-readable output.
- [x] Piped/unattended invocation without the Desktop marker is refused.
- [x] `lore help` documents the command.
- [x] Parser and dispatch tables in `tests/test_cli.py` cover every new
      branch; `tests/gate.py`'s per-file coverage floor holds for
      `lore/cli.py` (98.4%/95.4%).

## Notes

Blocked on `XC-028` landing `lore/feedback.py` first — this item only adds
the argparse surface and prompting around it.

Done 2026-09-07. Verified end-to-end (interactive and non-interactive) against
a local stub relay, including the unattended-pipe refusal. Reports the
correct `source` ("cli" from a real terminal, "desktop" when the Desktop app
drives it via `LORE_ATTENDED_SURFACE=desktop`) — see `XC-028`'s notes for the
bug this caught during `APP-104` integration.
