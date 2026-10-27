"""XC-083: the script that measures the CI items' trailing-window criteria."""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock


def _load() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[1]
        / "docs"
        / "backlog"
        / "agents"
        / "measure_ci_window.py"
    )
    spec = importlib.util.spec_from_file_location("measure_ci_window", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # dataclasses resolve a class's annotations through sys.modules[cls.__module__].
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


measure = _load()

LOG = """2026-10-27T05:40:18.6351290Z Cache restored successfully
2026-10-27T05:45:47.2597540Z ##[group]FAIL agents (alone) (208s, load 45.2), retrying
2026-10-27T05:50:00.0000000Z ##[group]PASS schedule on retry (39s, load 69.1)
2026-10-27T05:53:00.0000000Z ##[group]PASS agents on retry (alone) (230s, load 40.0)
2026-10-27T05:53:05.9235070Z 21/21 walks passed in 646s, 2 at a time.
2026-10-27T05:53:05.9235610Z 2 of 21 walks passed on retry.
2026-10-27T05:53:06.9766910Z Cache not found for input keys: packaging-macOS-ARM64-f63d
2026-10-27T05:54:23.4907790Z Cache saved with key: packaging-macOS-ARM64-f63d
"""


def run(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": 1,
        "event": "pull_request",
        "head_branch": "feature",
        "created_at": "2026-10-28T10:00:00Z",
        "conclusion": "success",
        "desktop_conclusion": "success",
        "desktop_started_at": "2026-10-28T10:00:10Z",
        "desktop_completed_at": "2026-10-28T10:10:10Z",
        "agents_first_attempt": "PASS",
        "agents_first_seconds": 210,
        "walks_retried": 0,
        "walks_total": 21,
        "retried_walks": [],
        "cache": "hit",
    }
    base.update(overrides)
    return base


class ParseWalksLog(unittest.TestCase):
    def test_reads_the_first_agents_attempt_the_retry_count_and_the_cache(self) -> None:
        facts = measure.parse_walks_log(LOG)
        self.assertEqual(facts["agents_first_attempt"], "FAIL")
        self.assertEqual(facts["agents_first_seconds"], 208)
        self.assertEqual(facts["walks_retried"], 2)
        self.assertEqual(facts["walks_total"], 21)
        self.assertEqual(facts["retried_walks"], ["schedule", "agents"])
        self.assertEqual(facts["cache"], "miss")

    def test_a_log_without_the_lines_says_nothing(self) -> None:
        self.assertEqual(
            measure.parse_walks_log("nothing here\n"), {"retried_walks": []}
        )

    def test_an_agents_pass_without_the_alone_mark_still_counts(self) -> None:
        facts = measure.parse_walks_log("##[group]PASS agents (229s, load 69.7)\n")
        self.assertEqual(facts["agents_first_attempt"], "PASS")


class Figures(unittest.TestCase):
    def rows(self, runs: list[dict[str, object]]) -> dict[str, object]:
        return {
            row.item: row for row in measure.figures([measure.Run(**r) for r in runs])
        }

    def test_a_short_window_reports_values_but_no_verdict(self) -> None:
        rows = self.rows(
            [
                run(id=1),
                run(id=2, desktop_conclusion="failure", agents_first_attempt="FAIL"),
            ]
        )
        self.assertEqual(rows["XC-077"].value, "1 of 2 (50.0%)")
        self.assertIsNone(rows["XC-077"].inside)
        self.assertEqual(rows["XC-084"].value, "1 of 2 (50.0%)")

    def test_fifty_clean_runs_land_inside_every_fifty_run_criterion(self) -> None:
        # Half the PRs touch nothing the desktop job walks, so their job is skipped (XC-078); the rest run green.
        skipped: dict[str, object] = {
            "desktop_conclusion": "skipped",
            "agents_first_attempt": None,
            "walks_retried": None,
        }
        runs = [
            run(
                id=i,
                created_at=f"2026-10-28T{10 + i // 60:02d}:{i % 60:02d}:00Z",
                head_branch=f"b{i}",
                **(skipped if i % 2 else {}),
            )
            for i in range(50)
        ]
        rows = self.rows(runs)
        for item in ("XC-077", "XC-078", "XC-080", "XC-084"):
            self.assertTrue(rows[item].inside, item)
        self.assertIsNone(rows["XC-081"].inside, "200 PR runs are needed")
        self.assertTrue(rows["APP-247"].inside, rows["APP-247"].value)

    def test_skipped_desktop_jobs_count_for_xc_078_but_not_for_failure_rates(
        self,
    ) -> None:
        runs = [
            run(
                id=i,
                head_branch=f"b{i}",
                desktop_conclusion="skipped",
                agents_first_attempt=None,
                walks_retried=None,
            )
            for i in range(30)
        ]
        runs += [run(id=100 + i, head_branch=f"c{i}") for i in range(20)]
        rows = self.rows(runs)
        self.assertEqual(rows["XC-078"].value, "20 of 50 (40.0%)")
        self.assertEqual(rows["XC-077"].value, "0 of 20 (0.0%)")

    def test_a_superseded_pr_run_is_counted_for_xc_081(self) -> None:
        first = run(
            id=1,
            head_branch="same",
            created_at="2026-10-28T10:00:00Z",
            desktop_completed_at="2026-10-28T10:12:00Z",
        )
        second = run(
            id=2,
            head_branch="same",
            created_at="2026-10-28T10:05:00Z",
            desktop_completed_at="2026-10-28T10:17:00Z",
        )
        rows = self.rows([first, second])
        self.assertEqual(rows["XC-081"].value, "1")

    def test_the_report_is_markdown_with_one_row_per_item(self) -> None:
        text = measure.report([measure.Run(**run())], "2026-10-27T13:50:00Z")
        self.assertIn("| XC-077 |", text)
        self.assertIn("| XC-084 |", text)
        self.assertIn("XC-082 cache: 1 hits, 0 misses", text)

    def test_main_reads_facts_from_json_without_calling_gh(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "runs.json"
            path.write_text(json.dumps([run()]))
            with (
                mock.patch.object(
                    measure.subprocess,
                    "run",
                    side_effect=AssertionError("gh must not run"),
                ),
                mock.patch("sys.stdout", new=io.StringIO()) as out,
            ):
                code = measure.main(["--from-json", str(path)])
            self.assertEqual(code, 0)
            self.assertIn("1 runs read", out.getvalue())


if __name__ == "__main__":
    unittest.main()
