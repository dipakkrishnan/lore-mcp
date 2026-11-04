"""XC-098: the script that turns a Node package's coverage report into one step-summary line."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock


def _load() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[1]
        / ".github"
        / "scripts"
        / "coverage_summary.py"
    )
    spec = importlib.util.spec_from_file_location("coverage_summary", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # The script's dataclass resolves its postponed annotations through
    # sys.modules[module.__name__], so register it before executing.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


coverage_summary = _load()


def _istanbul(statements: tuple[int, int], branches: tuple[int, int]) -> str:
    """A json-summary `total` block with the shape vitest's reporter writes."""
    covered, total = statements
    bcovered, btotal = branches
    return json.dumps(
        {
            "total": {
                "lines": {"total": 1, "covered": 1, "skipped": 0, "pct": 100},
                "statements": {
                    "total": total,
                    "covered": covered,
                    "skipped": 0,
                    "pct": 0,
                },
                "functions": {"total": 1, "covered": 1, "skipped": 0, "pct": 100},
                "branches": {
                    "total": btotal,
                    "covered": bcovered,
                    "skipped": 0,
                    "pct": 0,
                },
            },
            "src/a.ts": {},
        }
    )


LCOV = """TN:
SF:src/a.cjs
FNF:2
FNH:1
LF:10
LH:9
BRF:4
BRH:2
end_of_record
TN:
SF:src/b.mjs
LF:30
LH:21
BRF:6
BRH:3
end_of_record
"""


class Readers(unittest.TestCase):
    def test_istanbul_total_block(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder, "coverage-summary.json")
            path.write_text(_istanbul((202, 203), (178, 181)))
            totals = coverage_summary.read_istanbul(path)
        self.assertEqual(
            (
                totals.statement_label,
                totals.statements_covered,
                totals.statements_total,
                totals.branches_covered,
                totals.branches_total,
            ),
            ("statements", 202, 203, 178, 181),
        )

    def test_lcov_sums_every_record(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder, "lcov.info")
            path.write_text(LCOV)
            totals = coverage_summary.read_lcov(path)
        self.assertEqual(
            (
                totals.statement_label,
                totals.statements_covered,
                totals.statements_total,
                totals.branches_covered,
                totals.branches_total,
            ),
            ("lines", 30, 40, 5, 10),
        )

    def test_two_istanbul_reports_sum(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            main = Path(folder, "main.json")
            hosted = Path(folder, "hosted.json")
            main.write_text(_istanbul((100, 200), (10, 40)))
            hosted.write_text(_istanbul((50, 50), (5, 10)))
            totals = coverage_summary.collect([main, hosted], [])
        self.assertEqual(
            (totals.statements_covered, totals.statements_total), (150, 250)
        )
        self.assertEqual((totals.branches_covered, totals.branches_total), (15, 50))

    def test_a_missing_or_malformed_report_is_a_report_error(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            missing = Path(folder, "nope.json")
            with self.assertRaises(coverage_summary.ReportError):
                coverage_summary.read_istanbul(missing)
            with self.assertRaises(coverage_summary.ReportError):
                coverage_summary.read_lcov(missing)
            bad = Path(folder, "bad.json")
            bad.write_text('{"files": {}}')
            with self.assertRaises(coverage_summary.ReportError):
                coverage_summary.read_istanbul(bad)
            empty = Path(folder, "empty.info")
            empty.write_text("TN:\n")
            with self.assertRaises(coverage_summary.ReportError):
                coverage_summary.read_lcov(empty)


class Line(unittest.TestCase):
    def test_percentages_have_two_decimals_and_counts_follow(self) -> None:
        totals = coverage_summary.Totals("statements", 202, 203, 178, 181)
        self.assertEqual(
            coverage_summary.summarise("checkout", totals),
            "**checkout** coverage (report-only): statements 99.51% (202/203) · "
            "branches 98.34% (178/181)",
        )

    def test_nothing_to_cover_is_100(self) -> None:
        self.assertEqual(coverage_summary.percent(0, 0), "100.00%")


class Main(unittest.TestCase):
    def run_main(self, argv: list[str]) -> tuple[int, str, str]:
        with tempfile.TemporaryDirectory() as folder:
            summary = os.path.join(folder, "summary.md")
            with (
                mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": summary}),
                mock.patch("sys.stdout", new=io.StringIO()) as out,
            ):
                code = coverage_summary.main(argv)
            written = Path(summary).read_text() if os.path.exists(summary) else ""
            return code, written, out.getvalue()

    def test_appends_the_line_to_the_step_summary(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder, "lcov.info")
            path.write_text(LCOV)
            code, written, printed = self.run_main(
                ["--name", "app/desktop", "--lcov", str(path)]
            )
        self.assertEqual(code, 0)
        expected = (
            "**app/desktop** coverage (report-only): lines 75.00% (30/40) · "
            "branches 50.00% (5/10)\n"
        )
        self.assertEqual(written, expected)
        self.assertEqual(printed, expected)

    def test_a_missing_report_warns_and_still_exits_zero(self) -> None:
        code, written, printed = self.run_main(
            ["--name", "checkout", "--istanbul", "/nonexistent/coverage-summary.json"]
        )
        self.assertEqual(code, 0)
        self.assertIn("::warning title=coverage checkout::", printed)
        self.assertIn("**checkout** coverage (report-only): not measured", written)


if __name__ == "__main__":
    unittest.main()
