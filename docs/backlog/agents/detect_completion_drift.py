#!/usr/bin/env python3
"""Flag backlog items whose own body contradicts their `status` field.

Two independent signals, either one is enough to flag an item:

1. Every checkbox under `## Acceptance criteria` is `[x]`, but `status` is
   not `completed` or `obsolete`.
2. The body contains language a person or agent writes when they believe an
   item is done ("Completed", "Closed out", "shipped and merged", "all N
   acceptance criteria ... met/addressed/checked"), but `status` disagrees.

Both signals showed up for real, independently, in the same backlog within
one week: `MCP-001`, `MON-004`, `MCP-002`, `CLI-001`, `MON-006`, and `DOC-002`
each had a closing note (signal 2, `MON-006` also had signal 1's inverse —
prose claiming completion while every checkbox was still `[ ]`) that nobody
ever turned into a status change. This exists to catch the next one instead
of finding it by accident during an unrelated pass.

This is informational only — it does not change any file, and a hit is not
proof the item is actually done, only that its own text disagrees with
itself. Someone still has to verify the claim against the real deliverable
(code, tests, a shipped doc) before flipping `status` to `completed` — that
verification is `implementation`'s job, not this script's.

Usage:
    python3 docs/backlog/agents/detect_completion_drift.py [docs/backlog]

Prints one line per finding to stdout and exits 0 always — see the module
docstring above for why this is advisory, not a hard failure.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SKIP_DIRS = {"agents", "automation", "_template"}
TERMINAL_STATUSES = {"completed", "obsolete"}

COMPLETION_PHRASES = [
    re.compile(r"^\*\*Completed\b", re.M),
    re.compile(r"^\*\*Closed out\b", re.M),
    re.compile(r"\bshipped and merged\b", re.I),
    re.compile(
        r"\ball\s+(?:\d+|one|two|three|four|five|six|seven|eight)\s+"
        r"acceptance criteria\s+(?:are\s+|is\s+)?(?:all\s+)?"
        r"(?:met|addressed|checked|satisfied)\b",
        re.I | re.S,
    ),
]

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)
FIELD_RE = re.compile(r"^(\w+):\s*(.*)$", re.M)
AC_SECTION_RE = re.compile(
    r"^## Acceptance criteria\n(.*?)(?=^## |\Z)", re.M | re.DOTALL
)
CHECKBOX_RE = re.compile(r"^\s*- \[( |x)\]", re.M)


def parse_status(frontmatter: str) -> str | None:
    for match in FIELD_RE.finditer(frontmatter):
        if match.group(1) == "status":
            return match.group(2).strip()
    return None


def all_criteria_checked(body: str) -> bool:
    section = AC_SECTION_RE.search(body)
    if not section:
        return False
    boxes = CHECKBOX_RE.findall(section.group(1))
    return bool(boxes) and all(b == "x" for b in boxes)


def find_completion_language(body: str) -> list[str]:
    return [p.pattern for p in COMPLETION_PHRASES if p.search(body)]


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    root = Path(argv[0]) if argv else Path("docs/backlog")

    findings = []
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root)
        if not rel.parts or rel.parts[0] in SKIP_DIRS or path.name == "README.md":
            continue
        text = path.read_text()
        match = FRONTMATTER_RE.match(text)
        if not match:
            continue
        frontmatter, body = match.groups()
        status = parse_status(frontmatter)
        if status is None or status in TERMINAL_STATUSES:
            continue

        reasons = []
        if all_criteria_checked(body):
            reasons.append("every acceptance-criteria checkbox is [x]")
        phrases = find_completion_language(body)
        if phrases:
            reasons.append(f"completion language in body ({len(phrases)} match(es))")

        if reasons:
            findings.append((rel, status, reasons))

    if not findings:
        print("No completion-drift findings.")
        return 0

    print(f"{len(findings)} item(s) whose body disagrees with status:\n")
    for rel, status, reasons in findings:
        print(f"  {rel}  (status: {status})")
        for reason in reasons:
            print(f"    - {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
