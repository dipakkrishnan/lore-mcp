"""XC-131: `regenerate_index.py --check` fails when INDEX.md drifts from its items
or holds a conflict marker, and never writes."""

from __future__ import annotations

import importlib.util
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import ModuleType


def _load() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[1]
        / "docs"
        / "backlog"
        / "agents"
        / "regenerate_index.py"
    )
    spec = importlib.util.spec_from_file_location("regenerate_index", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


regenerate_index = _load()

ITEM = """---
id: {id}
title: {title}
priority: P1
effort: S
component: capture
status: {status}
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-11-12
updated: 2026-11-12
---

## Problem

Something.
"""


class CheckModeTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        folder = self.root / "capture"
        folder.mkdir()
        (folder / "README.md").write_text("# capture\n\nPrefix: `CAP`\n")
        self.item("CAP-001", "First", "ready")
        self.item("CAP-002", "Second", "ideation")
        self.index = self.root / "INDEX.md"
        self.index.write_text("# Backlog Index\n\n" + regenerate_index.TABLE_HEADER)
        self.assertEqual(self.run_script("--write")[0], 0)

    def item(self, item_id: str, title: str, status: str) -> None:
        path = self.root / "capture" / f"{item_id}-{title.lower()}.md"
        path.write_text(ITEM.format(id=item_id, title=title, status=status))

    def run_script(self, *flags: str) -> tuple[int, str]:
        out = io.StringIO()
        with redirect_stdout(out):
            code = regenerate_index.main([*flags, str(self.root)])
        return code, out.getvalue()

    def test_a_current_index_passes(self) -> None:
        code, said = self.run_script("--check")
        self.assertEqual(code, 0, said)
        self.assertIn("INDEX.md is current", said)

    def test_a_status_changed_without_regenerating_fails_and_names_the_item(
        self,
    ) -> None:
        self.item("CAP-002", "Second", "completed")
        before = self.index.read_bytes()
        code, said = self.run_script("--check")
        self.assertEqual(code, 1)
        self.assertIn("CAP-002", said)
        self.assertNotIn("CAP-001", said)
        self.assertIn("--write", said)
        self.assertEqual(self.index.read_bytes(), before, "--check wrote INDEX.md")

    def test_a_missing_or_extra_row_fails(self) -> None:
        self.item("CAP-003", "Third", "ready")
        code, said = self.run_script("--check")
        self.assertEqual(code, 1)
        self.assertIn("CAP-003", said)
        (self.root / "capture" / "CAP-003-third.md").unlink()
        self.index.write_text(
            self.index.read_text()
            + "| [CAP-009](./capture/CAP-009-gone.md) | Gone | P1 | S | capture "
            "| ready | — | — | — | — |\n"
        )
        code, said = self.run_script("--check")
        self.assertEqual(code, 1)
        self.assertIn("CAP-009", said)

    def test_a_duplicated_row_fails(self) -> None:
        rows = self.index.read_text().splitlines()
        self.index.write_text("\n".join([*rows, rows[-1]]) + "\n")
        code, said = self.run_script("--check")
        self.assertEqual(code, 1)
        self.assertIn("stray lines", said)

    def test_a_conflict_marker_fails_even_with_every_row_present(self) -> None:
        clean = self.index.read_text()
        for marker in ("<<<<<<< HEAD", "=======", ">>>>>>> origin/main"):
            with self.subTest(marker=marker):
                self.index.write_text(clean + marker + "\n")
                before = self.index.read_bytes()
                code, said = self.run_script("--check")
                self.assertEqual(code, 1)
                self.assertIn("conflict marker", said)
                self.assertEqual(self.index.read_bytes(), before)

    def test_check_and_write_together_are_refused(self) -> None:
        code, said = self.run_script("--check", "--write")
        self.assertEqual(code, 2)
        self.assertIn("not both", said)


if __name__ == "__main__":
    unittest.main()
