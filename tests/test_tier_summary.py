"""XC-097, XC-107: the script that turns each test tier's closing lines into a step-summary table."""

from __future__ import annotations

import importlib.util
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock


def _load() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[1] / ".github" / "scripts" / "tier_summary.py"
    )
    spec = importlib.util.spec_from_file_location("tier_summary", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


tier_summary = _load()

NODE_LOG = """\
✔ a card resolves with the owner's answer, once (2.1ms)
✖ the agent's shell cannot change Lore's database (24.8ms) # Known gap
ℹ tests 94
ℹ suites 0
ℹ pass 93
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 24584.062125
ℹ start of coverage report
ℹ file | line % | branch % | funcs % | uncovered lines
"""

QUIET_PYTEST_LOG = """\
...............                                      [100%]
15 passed, 20 subtests passed in 0.03s
| `lore/cli.py` | 95.1% | 91.0% | ok |
"""

DECORATED_PYTEST_LOG = """\
tests/test_a.py ..F.s                                                    [100%]
=================================== FAILURES ===================================
============== 1 failed, 3 passed, 1 skipped, 2 warnings in 1.50s ==============
"""

# As vitest 4 prints it in CI: coloured, since CI is set.
VITEST_UNIT_LOG = """\
 \x1b[32m✓\x1b[39m \x1b[30m\x1b[43m node \x1b[49m\x1b[39m test/unit/price.test.ts \x1b[2m(\x1b[22m\x1b[2m4 tests\x1b[22m\x1b[2m)\x1b[22m\x1b[32m 13\x1b[2mms\x1b[22m\x1b[39m

\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m7 passed\x1b[39m\x1b[22m\x1b[90m (7)\x1b[39m
\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m61 passed\x1b[39m\x1b[22m\x1b[90m (61)\x1b[39m
\x1b[2m   Start at \x1b[22m 05:24:00
\x1b[2m   Duration \x1b[22m 783ms\x1b[2m (transform 155ms, setup 0ms, import 563ms, tests 128ms, environment 1ms)\x1b[22m
"""

# lore/node's test:coverage: two `vitest run`s, the second for the hosted Worker.
VITEST_TWO_RUNS_LOG = """\
 Test Files  1 failed | 24 passed (25)
      Tests  2 failed | 205 passed | 1 skipped | 1 todo (209)
   Start at  05:24:03
   Duration  81.77s (transform 6.83s, setup 291ms, import 19.13s, tests 55.22s, environment 3ms)
Statements   : 91.2% ( 1200/1315 )

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  3.24s (transform 1.13s, setup 0ms, import 2.09s, tests 613ms, environment 0ms)
"""


class Parsing(unittest.TestCase):
    def test_node_test_summary_block(self) -> None:
        tier = tier_summary.parse_node(NODE_LOG)
        assert tier is not None
        self.assertEqual(
            (tier.tests, tier.passed, tier.failed, tier.skipped), (94, 93, 0, 0)
        )
        self.assertEqual(tier.extra, {"todo": 1})
        self.assertAlmostEqual(tier.seconds, 24.584, places=3)
        self.assertEqual(
            tier.row("Component"), "| Component | 94 | 93 | 0 | 0 | 1 todo | 24.6 |"
        )

    def test_quiet_pytest_line_counts_tests_not_subtests(self) -> None:
        tier = tier_summary.parse_pytest(QUIET_PYTEST_LOG)
        assert tier is not None
        self.assertEqual(
            (tier.tests, tier.passed, tier.failed, tier.skipped), (15, 15, 0, 0)
        )
        self.assertEqual(tier.extra, {})
        self.assertEqual(tier.row("Unit"), "| Unit | 15 | 15 | 0 | 0 |  | 0.0 |")

    def test_quiet_pytest_line_past_a_minute_carries_the_clock(self) -> None:
        tier = tier_summary.parse_pytest(
            "1118 passed, 1 skipped, 2498 subtests passed in 95.82s (0:01:35)\n"
        )
        assert tier is not None
        self.assertEqual((tier.tests, tier.skipped, tier.seconds), (1119, 1, 95.82))

    def test_decorated_pytest_line_with_failures_and_warnings(self) -> None:
        tier = tier_summary.parse_pytest(DECORATED_PYTEST_LOG)
        assert tier is not None
        self.assertEqual(
            (tier.tests, tier.passed, tier.failed, tier.skipped), (5, 3, 1, 1)
        )
        self.assertEqual(tier.extra, {}, "warnings are not tests")
        self.assertEqual(tier.seconds, 1.5)

    def test_pytest_errors_and_no_tests(self) -> None:
        tier = tier_summary.parse_pytest("2 passed, 1 error in 0.20s\n")
        assert tier is not None
        self.assertEqual((tier.tests, tier.extra), (3, {"error": 1}))
        none = tier_summary.parse_pytest("no tests ran in 0.01s\n")
        assert none is not None
        self.assertEqual((none.tests, none.seconds), (0, 0.01))

    def test_vitest_summary_through_its_colours(self) -> None:
        tier = tier_summary.parse_vitest(tier_summary.ANSI.sub("", VITEST_UNIT_LOG))
        assert tier is not None
        self.assertEqual(
            (tier.tests, tier.passed, tier.failed, tier.skipped), (61, 61, 0, 0)
        )
        self.assertAlmostEqual(tier.seconds, 0.783)

    def test_two_vitest_runs_in_one_step_are_summed(self) -> None:
        tier = tier_summary.parse_vitest(VITEST_TWO_RUNS_LOG)
        assert tier is not None
        self.assertEqual(
            (tier.tests, tier.passed, tier.failed, tier.skipped), (212, 208, 2, 1)
        )
        self.assertEqual(tier.extra, {"todo": 1})
        self.assertAlmostEqual(tier.seconds, 85.01)

    def test_vitest_minutes_and_a_summary_with_no_duration(self) -> None:
        tier = tier_summary.parse_vitest(
            "      Tests  4 passed (4)\n   Duration  1m 5.5s\n"
        )
        assert tier is not None
        self.assertAlmostEqual(tier.seconds, 65.5)
        self.assertIsNone(tier_summary.parse_vitest("      Tests  4 passed (4)\n"))

    def test_less_takes_out_a_tier_the_step_ran_again(self) -> None:
        whole = tier_summary.parse_vitest(VITEST_TWO_RUNS_LOG)
        unit = tier_summary.parse_vitest(tier_summary.ANSI.sub("", VITEST_UNIT_LOG))
        assert whole is not None and unit is not None
        own = whole.less(unit)
        self.assertEqual((own.tests, own.passed, own.failed), (151, 147, 2))
        self.assertEqual(own.seconds, whole.seconds, "the step's own seconds")
        self.assertEqual(own.extra, {"todo": 1})
        self.assertEqual(unit.less(whole).tests, 0, "never below zero")

    def test_a_log_with_no_closing_line_is_a_log_error(self) -> None:
        self.assertIsNone(tier_summary.parse_node("✔ one (1ms)\n"))
        self.assertIsNone(tier_summary.parse_pytest("collecting ...\n"))
        self.assertIsNone(tier_summary.parse_vitest("Test Files  1 passed (1)\n"))
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder, "run.log")
            log.write_text("the runner crashed\n")
            with self.assertRaises(tier_summary.LogError):
                tier_summary.read_tier(log)
            with self.assertRaises(FileNotFoundError):
                tier_summary.read_tier(Path(folder, "missing.log"))
            folder_as_log = Path(folder)
            with self.assertRaises(tier_summary.LogError):
                tier_summary.read_tier(folder_as_log)


class Main(unittest.TestCase):
    def run_main(self, argv: list[str]) -> tuple[int, str, str]:
        with tempfile.TemporaryDirectory() as folder:
            summary = os.path.join(folder, "summary.md")
            with (
                mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": summary}),
                mock.patch("sys.stdout", new=io.StringIO()) as out,
            ):
                code = tier_summary.main(argv)
            written = Path(summary).read_text() if os.path.exists(summary) else ""
            return code, written, out.getvalue()

    def test_appends_one_table_for_the_job_to_the_step_summary(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            unit, component = Path(folder, "unit.log"), Path(folder, "component.log")
            unit.write_text(QUIET_PYTEST_LOG)
            component.write_text(NODE_LOG)
            code, written, printed = self.run_main(
                ["--title", "app/desktop"]
                + ["--tier", "Unit", str(unit), "--tier", "Component", str(component)]
            )
        self.assertEqual(code, 0)
        expected = (
            "### Test tiers: app/desktop\n\n"
            "| Tier | Tests | Passed | Failed | Skipped | Other | Seconds |\n"
            "|---|---:|---:|---:|---:|---|---:|\n"
            "| Unit | 15 | 15 | 0 | 0 |  | 0.0 |\n"
            "| Component | 94 | 93 | 0 | 0 | 1 todo | 24.6 |\n"
        )
        self.assertEqual(written, expected + "\n")
        self.assertEqual(printed, expected)

    def test_also_runs_shows_the_component_tier_less_the_unit_rerun(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            unit, component = Path(folder, "unit.log"), Path(folder, "component.log")
            unit.write_text(VITEST_UNIT_LOG)
            component.write_text(VITEST_TWO_RUNS_LOG)
            _, written, _ = self.run_main(
                ["--title", "lore/node", "--tier", "Unit", str(unit)]
                + ["--tier", "Component", str(component)]
                + ["--also-runs", "Component", "Unit"]
            )
        self.assertIn("| Unit | 61 | 61 | 0 | 0 |  | 0.8 |", written)
        self.assertIn(
            "| Component | 151 | 147 | 2 | 1 | 1 todo; less the 61 Unit tests this step runs again | 85.0 |",
            written,
        )

    def test_a_tier_that_did_not_run_is_a_row_not_a_warning(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            unit = Path(folder, "unit.log")
            unit.write_text("ℹ tests 3\nℹ pass 2\nℹ fail 1\nℹ duration_ms 10\n")
            code, written, printed = self.run_main(
                ["--title", "app/desktop", "--tier", "Unit", str(unit)]
                + ["--tier", "Component", str(Path(folder, "component.log"))]
            )
        self.assertEqual(code, 0)
        self.assertIn("| Unit | 3 | 2 | 1 | 0 |  | 0.0 |", written)
        self.assertIn("| Component | — | — | — | — | not run | — |", written)
        self.assertNotIn("::warning", printed)

    def test_a_log_with_no_summary_warns_and_still_exits_zero(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder, "pytest.log")
            log.write_text("Segmentation fault\n")
            code, written, printed = self.run_main(
                ["--title", "Python", "--tier", "Unit", str(log)]
            )
        self.assertEqual(code, 0)
        self.assertIn("::warning title=tier Python Unit::", printed)
        self.assertIn("| Unit | — | — | — | — | not counted (", written)


if __name__ == "__main__":
    unittest.main()
