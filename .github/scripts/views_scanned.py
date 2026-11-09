#!/usr/bin/env python3
"""Say in the step summary how many views the desktop walks' layout scan reached this run (XC-107).

Every `shot(label)` in app/desktop/support/edge.cjs runs the LAYOUT scan and
records `PASS|FAIL the text sits right in <label>` (and again with
`, 900px wide` for a walk that also scans narrow). support/views.json (APP-266)
files each label under the view it scans. This reads the walks' teed log,
maps every label it finds to its view, and appends one line:

    **Layout scan**: 25 of 25 views in views.json scanned this run (153 shots, 92 again at 900 px); 5 more listed with no walk that scans them

so a run in which a walk stopped early, or a change that dropped a shot, shows
as a smaller number on that run, not only when XC-108's guard reads the table.
Views the table expects a walk to scan but this run did not are named. A label
the table does not list is named too: views.test.cjs keeps the two in step, so
that would mean the table is stale.

Report-only: this never fails the job. A missing log (the walks never started)
is a `::warning` and a line saying so, exit 0.

Usage:
    python3 .github/scripts/views_scanned.py --log walks.log --views support/views.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SCAN = re.compile(r"(?:PASS|FAIL) the text sits right in (.+?)(?: — .*)?$", re.M)
NARROW = re.compile(r", (\d+)px wide$")


@dataclass(frozen=True)
class Scanned:
    views: int  # views in the table that some shot of this run scanned
    expected: int  # views the table says a live walk scans
    listed: int  # every view in the table, scanned or not
    shots: int  # distinct shot labels, at the window's width
    narrow: int  # of those, scanned again at the narrow width
    narrow_width: int | None
    missing: list[str]  # views the table expects that this run did not scan
    unknown: list[str]  # labels this run scanned that the table does not list

    def line(self) -> str:
        again = (
            f", {self.narrow} again at {self.narrow_width} px"
            if self.narrow_width
            else ""
        )
        text = (
            f"**Layout scan**: {self.views} of {self.expected} views in views.json "
            f"scanned this run ({self.shots} shots{again})"
        )
        if self.listed > self.expected:
            text += f"; {self.listed - self.expected} more listed with no walk that scans them"
        if self.missing:
            text += f". Not scanned this run: {', '.join(self.missing)}"
        if self.unknown:
            text += f". Shots views.json does not list: {', '.join(self.unknown)}"
        return text


def count(log: str, table: dict[str, object]) -> Scanned:
    views = table.get("views")
    assert isinstance(views, list)
    view_of: dict[str, set[str]] = {}
    expected: list[str] = []
    for view in views:
        scans = view.get("scans") or []
        if scans:
            expected.append(view["id"])
        for scan in scans:
            for shot in scan.get("shots", []):
                view_of.setdefault(shot, set()).add(view["id"])
    shots: set[str] = set()
    narrow: set[str] = set()
    widths: set[int] = set()
    for label in SCAN.findall(log):
        wide = NARROW.search(label)
        if wide:
            widths.add(int(wide.group(1)))
            narrow.add(label[: wide.start()])
        else:
            shots.add(label)
    seen: set[str] = set()
    for shot in shots | narrow:
        seen |= view_of.get(shot, set())
    return Scanned(
        views=len(seen & set(expected)),
        expected=len(expected),
        listed=len(views),
        shots=len(shots),
        narrow=len(narrow),
        narrow_width=max(widths) if widths else None,
        missing=[view for view in expected if view not in seen],
        unknown=sorted((shots | narrow) - set(view_of)),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--log", required=True, type=Path, help="the walks' teed output"
    )
    parser.add_argument(
        "--views", required=True, type=Path, help="app/desktop/support/views.json"
    )
    args = parser.parse_args(argv)
    try:
        log = args.log.read_text(encoding="utf-8", errors="replace")
        table = json.loads(args.views.read_text(encoding="utf-8"))
        line = count(log, table).line()
    except (OSError, ValueError, AssertionError, KeyError, AttributeError) as error:
        print(f"::warning title=layout scan::views not counted: {error}")
        line = f"**Layout scan**: not counted ({error})"
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
