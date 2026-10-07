---
id: CLI-012
title: Accept -- before a path in connectors connect on every supported Python
priority: P1
effort: XS
component: cli-ux
status: in-progress
related: [APP-124, STO-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-07
---

## Problem

`lore connectors connect <app> -- <path>` fails on Python 3.10 and 3.11,
whose argparse rejects a positional after `--` in this subcommand. Because
`pyproject.toml` allows those versions (`requires-python = ">=3.10"`), a
seller running one of them can't connect a folder this way.

## Proposed approach

Either raise the floor to `>=3.12` (the version we test and ship), or stop
relying on `--` (take the locator as `--path`, or parse it ourselves). Pick
one and add a test for it.

## Acceptance criteria

- [ ] `connectors connect obsidian -- <path>` works on every Python version pyproject allows
- [ ] CI runs the CLI tests on the lowest allowed Python

## Notes

Filed from the 2026-10-06 new-seller audit.
