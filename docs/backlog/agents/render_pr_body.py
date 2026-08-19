#!/usr/bin/env python3
"""Render a backlog PR body from a reference template (XC-007).

Every recurring backlog PR shape — a new item filed, an item taken to
`completed`, an `audit` pass that only regenerates `INDEX.md`, a GitHub issue
cataloged — has a template under `pr-templates/`. This fills one in from
`--var KEY=VALUE` pairs instead of composing the body freehand each time.

Usage:
    python3 docs/backlog/agents/render_pr_body.py --template completed-item \\
        --var problem="..." --var changes="..." --var test_plan="- [x] ..."

    gh pr create --title "XC-007: ..." --body "$(python3 \\
        docs/backlog/agents/render_pr_body.py --template completed-item ...)"

Prints the rendered body to stdout and exits 0. Exits 1 (via SystemExit) with
a message on stderr for an unknown template or a missing required variable —
there is no partial/best-effort render.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

TEMPLATE_DIR = Path(__file__).parent / "pr-templates"
PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def available_templates() -> list[str]:
    return sorted(p.stem for p in TEMPLATE_DIR.glob("*.md"))


def load_template(name: str) -> tuple[list[str], str]:
    path = TEMPLATE_DIR / f"{name}.md"
    if not path.exists():
        raise SystemExit(
            f"Unknown template {name!r}. Available: {', '.join(available_templates())}"
        )
    body = path.read_text()
    required = sorted(set(PLACEHOLDER_RE.findall(body)))
    return required, body


def render(name: str, values: dict[str, str]) -> str:
    required, body = load_template(name)
    missing = [key for key in required if key not in values]
    if missing:
        raise SystemExit(
            f"Template {name!r} is missing required vars: {', '.join(missing)}"
        )
    return PLACEHOLDER_RE.sub(lambda match: values[match.group(1)], body)


def parse_vars(pairs: list[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    for pair in pairs:
        if "=" not in pair:
            raise SystemExit(f"--var must be KEY=VALUE, got {pair!r}")
        key, _, value = pair.partition("=")
        values[key.strip()] = value
    return values


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--template", required=True, help=f"one of: {', '.join(available_templates())}"
    )
    parser.add_argument(
        "--var",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="repeatable; fills one {{KEY}} placeholder",
    )
    args = parser.parse_args(argv)
    values = parse_vars(args.var)
    sys.stdout.write(render(args.template, values))
    return 0


if __name__ == "__main__":
    sys.exit(main())
