#!/usr/bin/env python3
"""Validate a pull request title against the backlog id convention (XC-010).

A title must either:
  - start with a real backlog id, "ID: summary" (e.g. "XC-010: ..."), where
    the id resolves to a file under docs/backlog/, or
  - start with one of the allowed exception prefixes, for pull requests that
    genuinely have no single owning item (multi-item backlog PRs, chores,
    reverts).
"""

import glob
import os
import re
import sys

BACKLOG_DIR = "docs/backlog"
TITLE_RE = re.compile(r"^([A-Z]{2,5}-\d{3}): \S")
ALLOWED_PREFIXES = ("Backlog:", "chore:", "revert:")


def main() -> int:
    title = os.environ.get("PR_TITLE", "")

    match = TITLE_RE.match(title)
    if match:
        item_id = match.group(1)
        if glob.glob(f"{BACKLOG_DIR}/*/{item_id}-*.md"):
            print(f"OK: title references {item_id}, which exists under {BACKLOG_DIR}/.")
            return 0
        print(
            f"::error::PR title references '{item_id}', but no file matches "
            f"{BACKLOG_DIR}/*/{item_id}-*.md. Fix the id, or file the item first."
        )
        return 1

    if title.startswith(ALLOWED_PREFIXES):
        print(
            f"OK: title matches an allowed exception prefix ({', '.join(ALLOWED_PREFIXES)})."
        )
        return 0

    print(
        "::error::PR title must start with a backlog id ('XC-010: summary') or one "
        f"of the allowed exception prefixes ({', '.join(ALLOWED_PREFIXES)}). "
        f"Got: {title!r}"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
