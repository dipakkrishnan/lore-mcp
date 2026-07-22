from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from lore.sources import scan
from lore.store import Store


class LoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        os.environ["LORE_HOME"] = str(root / "lore")
        os.environ["CLAUDE_HOME"] = str(root / "claude")
        os.environ["CODEX_HOME"] = str(root / "codex")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_import_search_and_review(self) -> None:
        path = Path(os.environ["CLAUDE_HOME"]) / "projects/demo/memory/testing.md"
        path.parent.mkdir(parents=True)
        path.write_text("# Testing preference\n\nUse focused integration tests.")

        with Store() as store:
            report = scan(store, {"claude"})
            self.assertEqual(report["claude"]["added"], 1)
            found = store.search("integration tests")
            self.assertEqual(found[0].title, "Testing preference")
            store.set_status(found[0].id, "external")
            self.assertEqual(store.search("integration", status="external")[0].status, "external")

    def test_changed_file_updates_without_resetting_status(self) -> None:
        path = Path(os.environ["CODEX_HOME"]) / "memories/project.md"
        path.parent.mkdir(parents=True)
        path.write_text("# Project\n\nFirst version")
        with Store() as store:
            scan(store, {"codex"})
            memory = store.search("First")[0]
            store.set_status(memory.id, "private")
            path.write_text("# Project\n\nSecond version")
            scan(store, {"codex"})
            updated = store.search("Second")[0]
            self.assertEqual(updated.status, "private")
            self.assertEqual(store.counts()["private"], 1)


if __name__ == "__main__":
    unittest.main()
