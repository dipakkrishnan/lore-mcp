#!/usr/bin/env python3
"""Append a job's per-tier table of test counts and seconds to the step summary (XC-097, XC-107).

Each tier of the suite (Python unit and integration, desktop unit and component,
each Worker's unit and component) runs as its own CI step with its output teed
to a log. This reads those logs and turns each runner's own closing lines into
one row of a Markdown table, so the shape of the pyramid (how many tests each
tier holds, how long it takes) is in the step summary of every run without a
reporter, a plugin or a second pass:

  * node:test's spec reporter ends with `ℹ tests N`, `ℹ pass N`, `ℹ fail N`,
    `ℹ skipped N`, `ℹ todo N` and `ℹ duration_ms N`.
  * pytest ends with `1111 passed, 2 skipped in 40.12s` (`-q`, with
    ` (0:01:35)` appended past a minute) or the same between `=` rules.
  * vitest ends each `vitest run` with `Tests  3 failed | 58 passed (61)` and
    `Duration  783ms (...)`. A step that runs vitest twice (lore/node's two
    Workers) is the sum of both blocks.

A Worker's instrumented run (`npm run test:coverage`) runs the unit project
again beside the workerd one, so its numbers include the unit tests a second
time. `--also-runs Component Unit` says so, and the Component row then shows
its own tests only: the step's counts less the Unit row's.

Report-only, on purpose: this never fails the job. A tier whose log does not
exist did not run (the unit tier failed first, or an earlier step did) and is
a `not run` row. A log with no closing line (the runner crashed before it) is a
`::warning` and a `not counted` row. Exit 0 either way, so the job's colour
still means "the tests passed".

Usage:
    python3 .github/scripts/tier_summary.py --title Python --tier Unit pytest.log
    python3 .github/scripts/tier_summary.py --title app/desktop \\
        --tier Unit unit.log --tier Component component.log
    python3 .github/scripts/tier_summary.py --title lore/node \\
        --tier Unit unit.log --tier Component component.log --also-runs Component Unit
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass, replace
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;]*m")
NODE_LINE = re.compile(
    r"^ℹ (tests|pass|fail|skipped|todo|cancelled|duration_ms) (\S+)$", re.M
)
PYTEST_LINE = re.compile(
    r"^(?:=+ )?(\d[\w ,]*?|no tests ran) in (\d+(?:\.\d+)?)s(?: \(\d+:\d\d:\d\d\))?(?: =+)?$",
    re.M,
)
PYTEST_COUNT = re.compile(r"\b(\d+) (passed|failed|errors?|skipped|xfailed|xpassed)\b")
VITEST_TESTS = re.compile(r"^\s*Tests\s+(.+?)\s+\((\d+)\)\s*$", re.M)
VITEST_COUNT = re.compile(r"(\d+) (passed|failed|skipped|todo)\b")
VITEST_DURATION = re.compile(
    r"^\s*Duration\s+(?:(\d+)m\s*)?(\d+(?:\.\d+)?)(ms|s)\b", re.M
)
HEADER = (
    "| Tier | Tests | Passed | Failed | Skipped | Other | Seconds |",
    "|---|---:|---:|---:|---:|---|---:|",
)


@dataclass(frozen=True)
class Tier:
    """One tier's closing numbers, as its runner printed them."""

    tests: int
    passed: int
    failed: int
    skipped: int
    seconds: float
    extra: dict[
        str, int
    ]  # todo (node, vitest), errors/xfailed/xpassed (pytest), when non-zero

    def row(self, name: str, note: str = "") -> str:
        other = ", ".join(f"{count} {label}" for label, count in self.extra.items())
        if note:
            other = f"{other}; {note}" if other else note
        return (
            f"| {name} | {self.tests} | {self.passed} | {self.failed} | {self.skipped}"
            f" | {other} | {self.seconds:.1f} |"
        )

    def less(self, other: Tier) -> Tier:
        """These counts without another tier's, which this step ran again; the seconds stay this step's."""
        extra = {
            label: max(0, count - other.extra.get(label, 0))
            for label, count in self.extra.items()
        }
        return replace(
            self,
            tests=max(0, self.tests - other.tests),
            passed=max(0, self.passed - other.passed),
            failed=max(0, self.failed - other.failed),
            skipped=max(0, self.skipped - other.skipped),
            extra={label: count for label, count in extra.items() if count},
        )


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
        count = {
            k: int(found.get(k, "0"))
            for k in ("tests", "pass", "fail", "skipped", "todo", "cancelled")
        }
        seconds = float(found["duration_ms"]) / 1000
    except ValueError as error:
        raise LogError(f"node:test summary has a bad number ({error})") from error
    extra = {k: count[k] for k in ("todo", "cancelled") if count[k]}
    return Tier(
        count["tests"], count["pass"], count["fail"], count["skipped"], seconds, extra
    )


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
    return Tier(
        passed + failed + skipped + sum(extra.values()),
        passed,
        failed,
        skipped,
        float(seconds),
        extra,
    )


def parse_vitest(text: str) -> Tier | None:
    """Every `vitest run` summary block in the log, summed: one step may run vitest twice."""
    blocks = VITEST_TESTS.findall(text)
    durations = VITEST_DURATION.findall(text)
    if not blocks or len(durations) < len(blocks):
        return None
    tests = passed = failed = skipped = todo = 0
    for summary, total in blocks:
        counts = {label: int(number) for number, label in VITEST_COUNT.findall(summary)}
        tests += int(total)
        passed += counts.get("passed", 0)
        failed += counts.get("failed", 0)
        skipped += counts.get("skipped", 0)
        todo += counts.get("todo", 0)
    seconds = 0.0
    for minutes, value, unit in durations[-len(blocks) :]:
        seconds += int(minutes or 0) * 60 + float(value) / (1000 if unit == "ms" else 1)
    return Tier(tests, passed, failed, skipped, seconds, {"todo": todo} if todo else {})


def read_tier(path: Path) -> Tier:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError as error:
        raise FileNotFoundError(f"{path}: not found") from error
    except OSError as error:
        raise LogError(f"{path}: unreadable ({error})") from error
    text = ANSI.sub("", text)
    tier = parse_node(text) or parse_vitest(text) or parse_pytest(text)
    if tier is None:
        raise LogError(f"{path}: no node:test, vitest or pytest summary line")
    return tier


def table(
    title: str, tiers: list[tuple[str, Path]], also_runs: dict[str, str]
) -> tuple[list[str], list[str]]:
    """The Markdown block for one job, and the warnings to print beside it."""
    read: dict[str, Tier] = {}
    rows: list[str] = []
    warnings: list[str] = []
    for name, log in tiers:
        try:
            tier = read_tier(log)
        except FileNotFoundError:
            rows.append(f"| {name} | — | — | — | — | not run | — |")
            continue
        except LogError as error:
            warnings.append(
                f"::warning title=tier {title} {name}::tests not counted: {error}"
            )
            rows.append(f"| {name} | — | — | — | — | not counted ({error}) | — |")
            continue
        read[name] = tier
        rerun = also_runs.get(name)
        if rerun and rerun in read:
            note = f"less the {read[rerun].tests} {rerun} tests this step runs again"
            rows.append(tier.less(read[rerun]).row(name, note))
        else:
            rows.append(tier.row(name))
    return [f"### Test tiers: {title}", "", *HEADER, *rows], warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--title", required=True, help='the job\'s package, e.g. "lore/node"'
    )
    parser.add_argument(
        "--tier",
        nargs=2,
        action="append",
        required=True,
        metavar=("NAME", "LOG"),
        help="a tier and its teed output, in the order the job runs them",
    )
    parser.add_argument(
        "--also-runs",
        nargs=2,
        action="append",
        default=[],
        metavar=("NAME", "OTHER"),
        help="tier NAME's step runs tier OTHER's tests again; its row shows its own",
    )
    args = parser.parse_args(argv)
    tiers = [(name, Path(log)) for name, log in args.tier]
    lines, warnings = table(args.title, tiers, dict(args.also_runs))
    text = "\n".join(lines) + "\n"
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(text + "\n")
    for warning in warnings:
        print(warning)
    print(text, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
