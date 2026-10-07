---
id: CLI-012
title: Accept -- before a path in connectors connect on every supported Python
priority: P1
effort: XS
component: cli-ux
status: completed
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

- [x] `connectors connect obsidian -- <path>` works on every Python version pyproject allows
- [x] CI runs the CLI tests on the lowest allowed Python

## Notes

Filed from the 2026-10-06 new-seller audit.

**Implemented 2026-10-07.** Chose "parse it ourselves" and kept the `>=3.10`
floor; raising it would have rewritten `uv.lock` for a ten-line fix.

What was measured, on 3.10.21, 3.11.15, 3.12.14 and 3.14.6:

- The command is `lore sources connect <app> [locator]`; there is no
  `connectors` command.
- `sources connect obsidian -- <path>` on its own already worked everywhere.
  What failed on 3.10 and 3.11 is an option between the app and the locator:
  `obsidian --json -- <path>`, `obsidian --replace old --json -- <path>` (the
  shape the desktop app sends, `app/desktop/src/state.cjs`), and
  `obsidian --json <path>`. Older argparse spends the optional locator on
  nothing as soon as it meets the option, then reports the path as
  `unrecognized arguments`.
- Only 3.12.14 was measured on the 3.12 line, so "older argparse" may include
  early 3.12 patch releases. The fix does not depend on the version.

`lore.cli._parse` now parses with `parse_known_args` and, for `sources connect`
with no locator, takes a single leftover as the locator. Anything else left
over is still `unrecognized arguments`, exit 2, on every command. Two shapes
are deliberately not recovered, because nothing sends them: a bare trailing
`--` with no path, and a path starting with `-` that isn't behind `--`.

CI: `.github/workflows/python-floor.yml` runs `tests/test_cli.py` on Python
3.10. It is a separate workflow so it doesn't collide with open edits to
`tests.yml`. A test in `tests/test_cli.py` fails if its `--python` version
stops matching `requires-python`.

For a future reader:

- The new check is advisory. It is not in `.github/rulesets/protect-main.json`,
  so a red run doesn't block a merge until an admin adds it there.
- Only the CLI tests run on 3.10. The rest of the suite passes on 3.10 except
  `tests/test_automation.py`, which imports `tomllib` (3.11+). Two `setUp`
  methods in `tests/test_cli.py` used `enterContext` (3.11+) and were changed
  to `start()`/`addCleanup(stop)`; before that, 37 CLI tests had never run on 3.10.
- Python 3.10 reaches end of life in October 2026. The floor was kept knowingly;
  raising it is a separate decision.
