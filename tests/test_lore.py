from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
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
        path = Path(os.environ["CODEX_HOME"]) / "memories/MEMORY.md"
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

    def test_codex_import_ignores_intermediate_memory_files(self) -> None:
        root = Path(os.environ["CODEX_HOME"]) / "memories"
        root.mkdir(parents=True)
        (root / "MEMORY.md").write_text("# Durable\n\nKeep this.")
        (root / "raw_memories.md").write_text("# Raw\n\nDuplicate evidence.")
        summaries = root / "rollout_summaries"
        summaries.mkdir()
        (summaries / "task.md").write_text("# Task\n\nDuplicate summary.")

        with Store() as store:
            report = scan(store, {"codex"})
            self.assertEqual(report["codex"]["found"], 1)
            self.assertEqual(store.search("Keep this")[0].title, "Durable")
            self.assertEqual(store.search("Duplicate"), [])

    def test_native_automation_prompt_hands_off_execution(self) -> None:
        profile = {
            "role": "maintainer",
            "domains": "developer tools",
            "valuable_context": "failed launches",
            "preferences": "small changes",
            "boundaries": "secrets",
            "agents": ["claude", "codex"],
        }
        automation.save_profile(profile)

        prompt = automation.build_prompt("codex", profile)
        self.assertIn("opinions, preferences", prompt)
        self.assertIn("failed launches", prompt)
        self.assertIn("lore search --status private", prompt)
        self.assertIn("lore sync --source automation-codex", prompt)
        self.assertNotIn("sessions", prompt)
        self.assertIn("codex://automations", automation.setup_instructions("codex"))
        self.assertIn("New routine → Local", automation.setup_instructions("claude"))

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
