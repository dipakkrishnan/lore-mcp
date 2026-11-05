#!/usr/bin/env python3
"""Append one test tier's count and duration to the GitHub step summary (XC-097).

Each tier of the suite (Python unit and integration, desktop unit and component)
runs as its own CI step with its output teed to a log. This reads that log and
turns the runner's own closing lines into one Markdown line, so the shape of the
pyramid (how many tests each tier holds, how long it takes) is in the step
summary of every run without a reporter, a plugin or a second pass:

  * node:test's spec reporter ends with `ℹ tests N`, `ℹ pass N`, `ℹ fail N`,
    `ℹ skipped N`, `ℹ todo N` and `ℹ duration_ms N`.
  * pytest ends with `1111 passed, 2 skipped in 40.12s` (`-q`) or the same
    between `=` rules.

Report-only, on purpose: this never fails the job. A log with no closing line
(the runner crashed before it, or the step was skipped) is a `::warning` and a
line saying so, exit 0, so the job's colour still means "the tests passed".

Usage:
    python3 .github/scripts/tier_summary.py --name "Python unit tests" --log pytest.log
    python3 .github/scripts/tier_summary.py --name "Desktop unit tests" --log unit.log
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

NODE_LINE = re.compile(r"^ℹ (tests|pass|fail|skipped|todo|cancelled|duration_ms) (\S+)$", re.M)
PYTEST_LINE = re.compile(
    r"^(?:=+ )?(\d[\w ,]*?|no tests ran) in (\d+(?:\.\d+)?)s(?: =+)?$", re.M
)
PYTEST_COUNT = re.compile(r"\b(\d+) (passed|failed|errors?|skipped|xfailed|xpassed)\b")


@dataclass(frozen=True)
class Tier:
    """One tier's closing numbers, as its runner printed them."""

    tests: int
    passed: int
    failed: int
    skipped: int
    seconds: float
    extra: dict[str, int]  # todo (node), errors/xfailed/xpassed (pytest), when non-zero

    def line(self, name: str) -> str:
        parts = [
            f"{self.tests} tests",
            f"{self.passed} passed",
            f"{self.failed} failed",
            f"{self.skipped} skipped",
            *(f"{count} {label}" for label, count in self.extra.items()),
            f"{self.seconds:.1f} s",
        ]
        return f"**{name}**: " + " · ".join(parts)


class LogError(Exception):
    """A log with no closing line this script knows."""


def parse_node(text: str) -> Tier | None:
    """node:test's spec summary; the last block in the log wins."""
    found: dict[str, str] = {}
    for key, value in NODE_LINE.findall(text):
        found[key] = value
    if "tests" not in found or "duration_ms" not in found:
        return None
    try:
        count = {k: int(found.get(k, "0")) for k in ("tests", "pass", "fail", "skipped", "todo", "cancelled")}
        seconds = float(found["duration_ms"]) / 1000
    except ValueError as error:
        raise LogError(f"node:test summary has a bad number ({error})") from error
    extra = {k: count[k] for k in ("todo", "cancelled") if count[k]}
    return Tier(count["tests"], count["pass"], count["fail"], count["skipped"], seconds, extra)


def parse_pytest(text: str) -> Tier | None:
    """pytest's closing line, quiet or between `=` rules; the last one in the log wins."""
    matches = PYTEST_LINE.findall(text)
    if not matches:
        return None
    summary, seconds = matches[-1]
    counts: dict[str, int] = {}
    for number, label in PYTEST_COUNT.findall(summary):
        counts[label.rstrip("s") if label.startswith("error") else label] = int(number)
    passed = counts.pop("passed", 0)
    failed = counts.pop("failed", 0)
    skipped = counts.pop("skipped", 0)
    extra = {label: count for label, count in counts.items() if count}
    return Tier(passed + failed + skipped + sum(extra.values()), passed, failed, skipped, float(seconds), extra)


def read_tier(path: Path) -> Tier:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError as error:
        raise LogError(f"{path}: not found") from error
    except OSError as error:
        raise LogError(f"{path}: unreadable ({error})") from error
    tier = parse_node(text) or parse_pytest(text)
    if tier is None:
        raise LogError(f"{path}: no node:test or pytest summary line")
    return tier


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--name", required=True, help='the tier, e.g. "Python unit tests"')
    parser.add_argument("--log", required=True, type=Path, help="the tier's teed output")
    args = parser.parse_args(argv)
    try:
        line = read_tier(args.log).line(args.name)
    except LogError as error:
        print(f"::warning title=tier {args.name}::tests not counted: {error}")
        line = f"**{args.name}**: not counted ({error})"
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
