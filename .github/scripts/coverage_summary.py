#!/usr/bin/env python3
"""Append one Node package's coverage line to the GitHub step summary (XC-098).

The three Workers (`lore/node`, `feedback-relay`, `checkout`) measure coverage
with vitest's istanbul provider, the only one `@cloudflare/vitest-pool-workers`
supports, and write `coverage/coverage-summary.json` (the `json-summary`
reporter). The desktop app runs `node --test --experimental-test-coverage`,
whose lcov reporter writes `coverage/lcov.info`. Both formats end here: one
Markdown line per package, statement (or line) and branch percentages, in
`$GITHUB_STEP_SUMMARY`.

Report-only, on purpose. This script never fails the job on a number; XC-108
sets floors once a few weeks of numbers exist. A report that is missing or
unreadable is a `::warning` annotation and a line saying so, exit 0, so the
job's colour still means "the tests passed" and nothing else.

`lore/node` passes two istanbul summaries: its two Workers (vitest.config.ts
and vitest.hosted.config.ts) partition src/ between them, so summing the two
`total` blocks is the package's number with no file counted twice.

node:test counts lines, not statements, so the desktop line says `lines`.
It also knows only the files the tests loaded: a module nothing requires
(renderer.js, main.cjs) is absent from the report, not reported at 0%.

Usage:
    python3 .github/scripts/coverage_summary.py --name feedback-relay \\
        --istanbul coverage/coverage-summary.json
    python3 .github/scripts/coverage_summary.py --name lore/node \\
        --istanbul coverage/coverage-summary.json coverage/hosted/coverage-summary.json
    python3 .github/scripts/coverage_summary.py --name app/desktop \\
        --lcov coverage/lcov.info
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Totals:
    """Covered-over-total counts for one package."""

    statement_label: str  # "statements" (istanbul) or "lines" (node:test)
    statements_covered: int = 0
    statements_total: int = 0
    branches_covered: int = 0
    branches_total: int = 0

    def __add__(self, other: Totals) -> Totals:
        if other.statement_label != self.statement_label:
            raise ValueError("cannot add statement and line counts")
        return Totals(
            self.statement_label,
            self.statements_covered + other.statements_covered,
            self.statements_total + other.statements_total,
            self.branches_covered + other.branches_covered,
            self.branches_total + other.branches_total,
        )


class ReportError(Exception):
    """A coverage report that is missing or not in the shape expected."""


def percent(covered: int, total: int) -> str:
    """`covered` out of `total` as a percentage with two decimals; 100% of nothing."""
    if total == 0:
        return "100.00%"
    return f"{100 * covered / total:.2f}%"


def read_istanbul(path: Path) -> Totals:
    """The `total` block of an istanbul `json-summary` report."""
    try:
        total = json.loads(path.read_text(encoding="utf-8"))["total"]
        return Totals(
            "statements",
            int(total["statements"]["covered"]),
            int(total["statements"]["total"]),
            int(total["branches"]["covered"]),
            int(total["branches"]["total"]),
        )
    except FileNotFoundError as error:
        raise ReportError(f"{path}: not found") from error
    except (KeyError, TypeError, ValueError, OSError) as error:
        raise ReportError(f"{path}: not an istanbul json-summary ({error})") from error


def read_lcov(path: Path) -> Totals:
    """Line and branch counts summed over every record of an lcov file.

    Each `SF:` record carries `LF`/`LH` (lines found/hit) and `BRF`/`BRH`
    (branches found/hit); node's lcov reporter writes all four per file.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ReportError(f"{path}: not found") from error
    except OSError as error:
        raise ReportError(f"{path}: unreadable ({error})") from error
    counts = {"LF": 0, "LH": 0, "BRF": 0, "BRH": 0}
    records = 0
    for line in text.splitlines():
        key, _, value = line.partition(":")
        if key == "SF":
            records += 1
        elif key in counts:
            try:
                counts[key] += int(value)
            except ValueError as error:
                raise ReportError(f"{path}: bad {key} line {line!r}") from error
    if records == 0:
        raise ReportError(
            f"{path}: no SF records; not an lcov file or nothing was covered"
        )
    return Totals("lines", counts["LH"], counts["LF"], counts["BRH"], counts["BRF"])


def summarise(name: str, totals: Totals) -> str:
    """The one Markdown line for the step summary."""
    return (
        f"**{name}** coverage (report-only): "
        f"{totals.statement_label} {percent(totals.statements_covered, totals.statements_total)} "
        f"({totals.statements_covered}/{totals.statements_total}) · "
        f"branches {percent(totals.branches_covered, totals.branches_total)} "
        f"({totals.branches_covered}/{totals.branches_total})"
    )


def collect(istanbul: Iterable[Path], lcov: Iterable[Path]) -> Totals:
    """Every report summed into one `Totals`; raises ReportError on any bad file."""
    parts = [read_istanbul(p) for p in istanbul] + [read_lcov(p) for p in lcov]
    if not parts:
        raise ReportError("no report given")
    total = parts[0]
    for part in parts[1:]:
        total = total + part
    return total


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--name", required=True, help="the package, e.g. lore/node")
    parser.add_argument(
        "--istanbul",
        nargs="+",
        default=[],
        type=Path,
        metavar="SUMMARY_JSON",
        help="istanbul json-summary files, summed",
    )
    parser.add_argument(
        "--lcov",
        nargs="+",
        default=[],
        type=Path,
        metavar="LCOV",
        help="lcov files, summed",
    )
    args = parser.parse_args(argv)
    try:
        line = summarise(args.name, collect(args.istanbul, args.lcov))
    except ReportError as error:
        print(f"::warning title=coverage {args.name}::coverage not measured: {error}")
        line = f"**{args.name}** coverage (report-only): not measured ({error})"
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
