from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess

from lore import automation
from lore.mcp import dispatch
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

    def test_agent_synthesis_is_saved_and_searchable(self) -> None:
        automation.save_profile(
            {
                "role": "maintainer",
                "domains": "developer tools",
                "valuable_context": "failed launches",
                "preferences": "small changes",
                "boundaries": "secrets",
                "agents": ["claude"],
                "lookback_days": 3,
            }
        )

        def fake_runner(command: list[str], **_: object) -> CompletedProcess[str]:
            self.assertIn("failed launches", command[-1])
            return CompletedProcess(command, 0, "# Memory synthesis\n\n## Failures and lessons\n- Launch slowly.", "")

        path = automation.run("claude", runner=fake_runner)
        self.assertTrue(path.is_file())
        with Store() as store:
            result = store.search("Launch slowly")
            self.assertEqual(result[0].origin, "automation")
            self.assertEqual(result[0].status, "pending")

    def test_schedule_update_preserves_other_cron_jobs(self) -> None:
        existing = "0 8 * * * backup\n# lore-memory-start\nold\n# lore-memory-end\n"
        updated = automation._replace_cron(
            existing, "# lore-memory-start\n0 21 * * * lore\n# lore-memory-end"
        )
        self.assertIn("0 8 * * * backup", updated)
        self.assertNotIn("\nold\n", updated)
        self.assertEqual(updated.count("# lore-memory-start"), 1)

    def test_mcp_returns_only_external_memories(self) -> None:
        with Store() as store:
            for title, status in (("Public lesson", "external"), ("Private lesson", "private")):
                store.put(
                    source="test",
                    origin="native",
                    source_path=title,
                    source_key=title,
                    fingerprint=title,
                    title=title,
                    content=f"{title} about deployment",
                )
                memory = store.search(title)[0]
                store.set_status(memory.id, status)
        response = dispatch(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "answer", "arguments": {"query": "deployment"}},
            }
        )
        text = response["result"]["content"][0]["text"]  # type: ignore[index]
        self.assertIn("Public lesson", text)
        self.assertNotIn("Private lesson", text)


if __name__ == "__main__":
    unittest.main()
