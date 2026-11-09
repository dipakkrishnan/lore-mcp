"""XC-107: the script that counts the views the desktop walks' layout scan reached in one run."""

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

ROOT = Path(__file__).resolve().parents[1]


def _load() -> ModuleType:
    path = ROOT / ".github" / "scripts" / "views_scanned.py"
    spec = importlib.util.spec_from_file_location("views_scanned", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


views_scanned = _load()

TABLE: dict[str, object] = {
    "views": [
        {
            "id": "welcome",
            "scans": [
                {"walk": "provision", "shots": ["provision-failed"]},
                {"walk": "fresh", "shots": ["welcome-usage"]},
            ],
        },
        {"id": "today", "scans": [{"walk": "today", "shots": ["today", "today-busy"]}]},
        {"id": "settings", "scans": [{"walk": "settings", "shots": ["settings"]}]},
        {"id": "first-run", "scans": []},
    ]
}

LOG = """\
::group::PASS provision (8s, load 1.2)
PASS the text sits right in provision-failed
::endgroup::
::group::FAIL today (40s, load 2.0), retrying
PASS the text sits right in today
PASS the text sits right in today, 900px wide
FAIL the text sits right in today-busy, 900px wide — .row b: cut off at the side, with no ellipsis
::endgroup::
::group::PASS today on retry (41s, load 2.0)
PASS the text sits right in today
PASS the text sits right in today, 900px wide
PASS the text sits right in today-busy
PASS the text sits right in today-busy, 900px wide
PASS the text sits right in brand-new-shot
::endgroup::
"""


class Count(unittest.TestCase):
    def test_counts_views_once_however_many_shots_and_retries_reach_them(self) -> None:
        found = views_scanned.count(LOG, TABLE)
        self.assertEqual((found.views, found.expected, found.listed), (2, 3, 4))
        self.assertEqual((found.shots, found.narrow, found.narrow_width), (4, 2, 900))
        self.assertEqual(found.missing, ["settings"])
        self.assertEqual(found.unknown, ["brand-new-shot"])
        self.assertEqual(
            found.line(),
            "**Layout scan**: 2 of 3 views in views.json scanned this run"
            " (4 shots, 2 again at 900 px); 1 more listed with no walk that scans them."
            " Not scanned this run: settings. Shots views.json does not list: brand-new-shot",
        )

    def test_a_failed_scan_still_counts_as_scanned(self) -> None:
        found = views_scanned.count(
            "FAIL the text sits right in settings — overlap\n", TABLE
        )
        self.assertEqual(found.views, 1)
        self.assertEqual(
            found.line().split(" (")[1],
            "1 shots); 1 more listed with no walk that scans them. Not scanned this run: welcome, today",
        )

    def test_the_repo_table_against_a_log_naming_every_shot(self) -> None:
        table = json.loads((ROOT / "app/desktop/support/views.json").read_text())
        shots = [
            shot
            for view in table["views"]
            for scan in view["scans"]
            for shot in scan["shots"]
        ]
        log = "".join(f"PASS the text sits right in {shot}\n" for shot in shots)
        found = views_scanned.count(log, table)
        self.assertEqual(found.views, found.expected)
        self.assertEqual((found.missing, found.unknown), ([], []))


class Main(unittest.TestCase):
    def run_main(self, argv: list[str]) -> tuple[int, str, str]:
        with tempfile.TemporaryDirectory() as folder:
            summary = os.path.join(folder, "summary.md")
            with (
                mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": summary}),
                mock.patch("sys.stdout", new=io.StringIO()) as out,
            ):
                code = views_scanned.main(argv)
            written = Path(summary).read_text() if os.path.exists(summary) else ""
            return code, written, out.getvalue()

    def test_appends_the_line_to_the_step_summary(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            log, table = Path(folder, "walks.log"), Path(folder, "views.json")
            log.write_text(LOG)
            table.write_text(json.dumps(TABLE))
            code, written, printed = self.run_main(
                ["--log", str(log), "--views", str(table)]
            )
        self.assertEqual(code, 0)
        self.assertTrue(written.startswith("**Layout scan**: 2 of 3 views"))
        self.assertEqual(written, printed)

    def test_a_missing_log_warns_and_still_exits_zero(self) -> None:
        code, written, printed = self.run_main(
            ["--log", "/nonexistent/walks.log", "--views", "/nonexistent/views.json"]
        )
        self.assertEqual(code, 0)
        self.assertIn("::warning title=layout scan::", printed)
        self.assertIn("**Layout scan**: not counted", written)


if __name__ == "__main__":
    unittest.main()
