#!/usr/bin/env python3
"""Decide whether a pull request's changed files can reach the desktop CI job (XC-078).

`Desktop macOS checks` (`.github/workflows/tests.yml`, job `desktop-check`) runs
`npm run check`, `npm test`, the 22 Electron walks and `npm run package` for
`app/desktop`. About a third of merged pull requests touch none of what that
job reads (a backlog item, the site, the Worker, a Python test), yet each one
held a macOS runner for about 19 minutes. The `changes` job pipes the pull
request's changed paths (`git diff --no-renames --name-only HEAD^1 HEAD` on the
merge commit) into this script, which writes `desktop=true|false` to
`$GITHUB_OUTPUT`; `desktop-check` runs unless that output is exactly `false`.

The rules name every path outside `app/desktop` the job reads (checked against
the sources on 2026-10-26; see XC-078's Proposed approach for the evidence):

- `app/desktop/`: the job's working directory.
- `lore/` except `lore/node/`: the walks drive the real CLI through `uv run lore`.
  The two files under `lore/node/` that a walk's stand-in deploy still reads
  (`lore/deploy.py:_build`) are back in: `src/price.ts` and `wrangler.jsonc`.
  Nothing else under `lore/node/` runs in a walk; the Worker has its own jobs.
- `plugins/lore/skills/`: the unpackaged app loads skills from here and
  `npm run package` bundles the folder.
- `tests/fixtures/`: the connectors/reading walks copy exports and feeds from
  it and run `granola.py`; the agents walk runs `tests.fixtures.inbox`.
- `pyproject.toml`, `uv.lock`: what `uv run lore` resolves.
- `.github/workflows/tests.yml` and this file: a change to the filter must run
  the job it gates.

Anything not listed (docs, site, bridge, feedback-relay, checkout, the rest of
lore/node, Python tests outside fixtures) cannot change what the job runs.
`uv build` in packaging also reads the root `README.md` and `LICENSE`, which
cannot break the build; they are left out on purpose.

Fail open: no changed paths at all (a diff that produced nothing) still runs
the job, with a warning, so a broken filter can never silently skip it.

Usage (in the workflow, pull_request events only):
    git diff --no-renames --name-only HEAD^1 HEAD | python3 .github/scripts/desktop_inputs.py
"""

from __future__ import annotations

import os
import sys
from collections.abc import Iterable

PREFIXES = (
    "app/desktop/",
    "lore/",
    "plugins/lore/skills/",
    "tests/fixtures/",
)
EXCLUDED_PREFIXES = ("lore/node/",)
FILES = frozenset(
    {
        "pyproject.toml",
        "uv.lock",
        ".github/workflows/tests.yml",
        ".github/scripts/desktop_inputs.py",
        "lore/node/src/price.ts",
        "lore/node/wrangler.jsonc",
    }
)


def is_desktop_input(path: str) -> bool:
    """True when a change to `path` can reach what the desktop job runs."""
    if path in FILES:
        return True
    if path.startswith(EXCLUDED_PREFIXES):
        return False
    return path.startswith(PREFIXES)


def desktop_inputs(paths: Iterable[str]) -> list[str]:
    """The changed paths that are desktop inputs, in order, blanks dropped."""
    return [
        path for path in (p.strip() for p in paths) if path and is_desktop_input(path)
    ]


def main(argv: list[str], stdin: Iterable[str]) -> int:
    paths = [line.rstrip("\n") for line in stdin]
    paths = [path for path in paths if path.strip()]
    if not paths:
        print(
            "::warning title=desktop_inputs::No changed paths were given; running the desktop job to be safe."
        )
        decision = True
    else:
        matched = desktop_inputs(paths)
        decision = bool(matched)
        if matched:
            print(
                f"{len(matched)} of {len(paths)} changed paths reach the desktop job:"
            )
            for path in matched:
                print(f"  {path}")
        else:
            print(
                f"None of the {len(paths)} changed paths reach the desktop job; it is skipped."
            )
    output = os.environ.get("GITHUB_OUTPUT")
    line = f"desktop={'true' if decision else 'false'}"
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:], sys.stdin))
