#!/usr/bin/env python3
"""Append one Node package's coverage line to the GitHub step summary (XC-098).

The three Workers (`lore/node`, `feedback-relay`, `checkout`) measure coverage
with vitest's istanbul provider, the only one `@cloudflare/vitest-pool-workers`
supports, and write `coverage/coverage-summary.json` (the `json-summary`
reporter). The desktop app runs `node --test --experimental-test-coverage`,
whose lcov reporter writes `coverage/lcov.info`. Both formats end here: one
Markdown line per package, statement (or line) and branch percentages, in
`$GITHUB_STEP_SUMMARY`.

Without `--floor` it is report-only: it never fails the job on a number. A
report that is missing or unreadable is a `::warning` annotation and a line
saying so, exit 0, so the job's colour still means "the tests passed".

`lore/node` passes two istanbul summaries: its two Workers (vitest.config.ts
and vitest.hosted.config.ts) partition src/ between them, so summing the two
`total` blocks is the package's number with no file counted twice. The desktop
passes two lcov files (XC-097: its unit and component tiers run as separate
steps) that cover the same sources, so those are unioned per line and branch
from their `DA:`/`BRDA:` records, never summed: a line both tiers hit is one
covered line.

node:test counts lines, not statements, so the desktop line says `lines`.
It also knows only the files the tests loaded: a module nothing requires
(renderer.js, main.cjs) is absent from the report, not reported at 0%.

XC-108: `--floor CONFIG` makes it a check. CONFIG is the package's JSON
config (the desktop's package.json), whose `coverageFloor` block names a
floor for `lines` (or `statements`) and `branches`. Below either, or with no
report to read, it prints an `::error` annotation and exits 1. The Workers do
not use this: vitest enforces their floors itself (`coverage.thresholds` in
each vitest config), so their summary steps stay report-only. The desktop
needs it here because its floor is on the union of two tiers' lcov files,
which only this script computes.

Usage:
    python3 .github/scripts/coverage_summary.py --name feedback-relay \\
        --istanbul coverage/coverage-summary.json
    python3 .github/scripts/coverage_summary.py --name lore/node \\
        --istanbul coverage/coverage-summary.json coverage/hosted/coverage-summary.json
    python3 .github/scripts/coverage_summary.py --name app/desktop \\
        --lcov coverage/unit.lcov coverage/component.lcov --floor package.json
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


def read_lcov_records(
    path: Path,
) -> tuple[dict[tuple[str, int], bool], dict[tuple[str, int, str, str], bool]]:
    """Every `DA:` line and `BRDA:` branch of an lcov file, keyed by source file, with whether it was hit.

    `DA:<line>,<count>` and `BRDA:<line>,<block>,<branch>,<taken>` (`-` when the
    branch's line never ran); node's lcov reporter writes both for every record.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ReportError(f"{path}: not found") from error
    except OSError as error:
        raise ReportError(f"{path}: unreadable ({error})") from error
    lines: dict[tuple[str, int], bool] = {}
    branches: dict[tuple[str, int, str, str], bool] = {}
    source = ""
    try:
        for line in text.splitlines():
            key, _, value = line.partition(":")
            if key == "SF":
                source = value
            elif key == "DA":
                number, count = value.split(",")[:2]
                where = (source, int(number))
                lines[where] = lines.get(where, False) or int(count) > 0
            elif key == "BRDA":
                number, block, branch, taken = value.split(",")[:4]
                at = (source, int(number), block, branch)
                branches[at] = branches.get(at, False) or (
                    taken != "-" and int(taken) > 0
                )
    except ValueError as error:
        raise ReportError(f"{path}: bad record {line!r}") from error
    if not lines:
        raise ReportError(
            f"{path}: no DA records; not an lcov file or nothing was covered"
        )
    return lines, branches


def union_lcov(paths: Iterable[Path]) -> Totals:
    """Several lcov files over the same sources as one: a line or branch any of them hit is covered once."""
    lines: dict[tuple[str, int], bool] = {}
    branches: dict[tuple[str, int, str, str], bool] = {}
    for path in paths:
        found_lines, found_branches = read_lcov_records(path)
        for where, hit in found_lines.items():
            lines[where] = lines.get(where, False) or hit
        for at, taken in found_branches.items():
            branches[at] = branches.get(at, False) or taken
    return Totals(
        "lines", sum(lines.values()), len(lines), sum(branches.values()), len(branches)
    )


def read_floor(path: Path) -> dict[str, float]:
    """The `coverageFloor` block of a package's JSON config: percentages keyed `lines` or `statements`, and `branches`.

    Other keys in the block (a note on where the numbers came from) are ignored.
    """
    try:
        block = json.loads(path.read_text(encoding="utf-8"))["coverageFloor"]
        floor = {
            key: float(block[key])
            for key in ("lines", "statements", "branches")
            if key in block
        }
    except FileNotFoundError as error:
        raise ReportError(f"{path}: not found") from error
    except (KeyError, TypeError, ValueError, OSError) as error:
        raise ReportError(f"{path}: no readable coverageFloor ({error})") from error
    if "branches" not in floor or ("lines" in floor) == ("statements" in floor):
        raise ReportError(
            f"{path}: coverageFloor needs `branches` and one of `lines` or `statements`"
        )
    return floor


def shortfalls(totals: Totals, floor: dict[str, float]) -> list[str]:
    """Each measure that is under its floor, as a sentence; empty when the package meets it."""
    if totals.statement_label not in floor:
        return [
            f"the floor names no `{totals.statement_label}`, which is what this report measures"
        ]
    found = []
    for label, covered, total, minimum in (
        (
            totals.statement_label,
            totals.statements_covered,
            totals.statements_total,
            floor[totals.statement_label],
        ),
        ("branches", totals.branches_covered, totals.branches_total, floor["branches"]),
    ):
        measured = 100 * covered / total if total else 100.0
        if measured < minimum:
            found.append(
                f"{label} {percent(covered, total)} ({covered}/{total}) is under the floor of {minimum:g}%"
            )
    return found


def describe(floor: dict[str, float] | None) -> str:
    """What the line is held to: `report-only`, or the floor's figures."""
    if floor is None:
        return "report-only"
    return "floor " + ", ".join(f"{key} {value:g}%" for key, value in floor.items())


def summarise(name: str, totals: Totals, floor: dict[str, float] | None = None) -> str:
    """The one Markdown line for the step summary."""
    return (
        f"**{name}** coverage ({describe(floor)}): "
        f"{totals.statement_label} {percent(totals.statements_covered, totals.statements_total)} "
        f"({totals.statements_covered}/{totals.statements_total}) · "
        f"branches {percent(totals.branches_covered, totals.branches_total)} "
        f"({totals.branches_covered}/{totals.branches_total})"
    )


def collect(istanbul: Iterable[Path], lcov: Iterable[Path]) -> Totals:
    """Every report as one `Totals`; raises ReportError on any bad file.

    Istanbul reports are summed (they partition the sources); two or more lcov
    files are unioned (they cover the same sources from different test tiers).
    """
    lcov_paths = list(lcov)
    parts = [read_istanbul(p) for p in istanbul]
    if len(lcov_paths) == 1:
        parts.append(read_lcov(lcov_paths[0]))
    elif lcov_paths:
        parts.append(union_lcov(lcov_paths))
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
        help="lcov files; two or more are unioned per line and branch",
    )
    parser.add_argument(
        "--floor",
        type=Path,
        metavar="CONFIG",
        help="a JSON config whose coverageFloor block the package must meet (XC-108); exit 1 below it",
    )
    args = parser.parse_args(argv)
    floor = None
    if args.floor is not None:
        try:
            floor = read_floor(args.floor)
        except ReportError as error:
            print(f"::error title=coverage floor {args.name}::{error}")
            return 1
    failures: list[str] = []
    try:
        totals = collect(args.istanbul, args.lcov)
        line = summarise(args.name, totals, floor)
        if floor is not None:
            failures = shortfalls(totals, floor)
    except ReportError as error:
        if floor is not None:
            failures = [
                f"coverage not measured, so the floor cannot be checked: {error}"
            ]
        else:
            print(
                f"::warning title=coverage {args.name}::coverage not measured: {error}"
            )
        line = f"**{args.name}** coverage ({describe(floor)}): not measured ({error})"
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    print(line)
    for failure in failures:
        print(f"::error title=coverage {args.name} below its floor::{failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
