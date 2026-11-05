"""XC-097: the script that turns one test tier's closing lines into a step-summary line."""

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
            tier.line("Desktop component tests"),
            "**Desktop component tests**: 94 tests · 93 passed · 0 failed · 0 skipped · 1 todo · 24.6 s",
        )

    def test_quiet_pytest_line_counts_tests_not_subtests(self) -> None:
        tier = tier_summary.parse_pytest(QUIET_PYTEST_LOG)
        assert tier is not None
        self.assertEqual(
            (tier.tests, tier.passed, tier.failed, tier.skipped), (15, 15, 0, 0)
        )
        self.assertEqual(tier.extra, {})
        self.assertEqual(
            tier.line("Python unit tests"),
            "**Python unit tests**: 15 tests · 15 passed · 0 failed · 0 skipped · 0.0 s",
        )

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

    def test_a_log_with_no_closing_line_is_a_log_error(self) -> None:
        self.assertIsNone(tier_summary.parse_node("✔ one (1ms)\n"))
        self.assertIsNone(tier_summary.parse_pytest("collecting ...\n"))
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder, "run.log")
            log.write_text("the runner crashed\n")
            with self.assertRaises(tier_summary.LogError):
                tier_summary.read_tier(log)
            with self.assertRaises(tier_summary.LogError):
                tier_summary.read_tier(Path(folder, "missing.log"))


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

    def test_appends_the_line_to_the_step_summary(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder, "unit.log")
            log.write_text(NODE_LOG)
            code, written, printed = self.run_main(
                ["--name", "Desktop component tests", "--log", str(log)]
            )
        self.assertEqual(code, 0)
        expected = "**Desktop component tests**: 94 tests · 93 passed · 0 failed · 0 skipped · 1 todo · 24.6 s\n"
        self.assertEqual(written, expected)
        self.assertEqual(printed, expected)

    def test_a_missing_log_warns_and_still_exits_zero(self) -> None:
        code, written, printed = self.run_main(
            ["--name", "Python unit tests", "--log", "/nonexistent/pytest.log"]
        )
        self.assertEqual(code, 0)
        self.assertIn("::warning title=tier Python unit tests::", printed)
        self.assertIn("**Python unit tests**: not counted", written)


if __name__ == "__main__":
    unittest.main()
