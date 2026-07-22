from __future__ import annotations

import os
import stat
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

from lore import automation
from lore.cli import configure_automation, manual, price, review
from lore.mcp import call_tool, dispatch, http
from lore.sources import scan
from lore.store import Memory, Store
from lore.ui import memory_card


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

        with patch("lore.cli.ask", return_value="p"), redirect_stdout(StringIO()):
            review("integration", "external", 0)
        with Store() as store:
            self.assertEqual(store.search("integration", status="private")[0].status, "private")

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
        synthesis = Path(os.environ["LORE_HOME"]) / "memories/codex"
        synthesis.mkdir(parents=True)
        (synthesis / "linked.md").symlink_to(root / "MEMORY.md")

        with Store() as store:
            report = scan(store, {"codex", "automation-codex"})
            self.assertEqual(report["codex"]["found"], 1)
            self.assertEqual(report["automation-codex"]["found"], 0)
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
            "models": {"claude": "opus", "codex": "gpt-test"},
            "cadence": "weekly",
            "hour": 9,
        }
        automation.save_profile(profile)

        prompt = automation.build_prompt("codex", profile)
        self.assertIn("opinions, preferences", prompt)
        self.assertIn("failed launches", prompt)
        self.assertIn("lore search --status private", prompt)
        self.assertIn("lore sync --source automation-codex", prompt)
        self.assertNotIn("sessions", prompt)
        setup = automation.setup_prompt("codex", profile)
        self.assertIn("weekly at 9:00 local time", setup)
        self.assertIn("Use model gpt-test", setup)
        codex = automation.setup_command("codex", profile)
        claude = automation.setup_command("claude", profile)
        self.assertEqual(codex[:2], ["codex", "exec"])
        self.assertIn(os.environ["CODEX_HOME"], codex)
        self.assertEqual(claude[:2], ["claude", "-p"])
        self.assertIn(os.environ["CLAUDE_HOME"], claude)
        self.assertEqual(codex[-2], "--")
        self.assertIn("LORE_SETUP_COMPLETE", codex[-1])

        completed = CompletedProcess(codex, 0, "LORE_SETUP_COMPLETE", "")
        with patch("lore.automation.subprocess.run", return_value=completed) as run:
            self.assertIn("LORE_SETUP_COMPLETE", automation.run_setup("codex", profile))
            self.assertEqual(run.call_args.kwargs["cwd"], Path(os.environ["LORE_HOME"]))
            self.assertEqual(run.call_args.kwargs["timeout"], 300)
        failed = CompletedProcess(codex, 0, "Could not configure it", "")
        with patch("lore.automation.subprocess.run", return_value=failed):
            with self.assertRaisesRegex(OSError, "Could not configure"):
                automation.run_setup("codex", profile)

        for path in (
            automation.profile_path(),
            automation.profile_path().parent / "codex-prompt.md",
        ):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        automation.save_profile({**profile, "agents": ["codex"]})
        self.assertFalse((automation.profile_path().parent / "claude-prompt.md").exists())

    def test_setup_configures_only_installed_agents(self) -> None:
        installed = lambda agent: f"/bin/{agent}" if agent == "codex" else None
        with (
            patch("lore.cli.shutil.which", side_effect=installed),
            patch("lore.automation.run_setup") as run_setup,
            redirect_stdout(StringIO()),
        ):
            configure_automation(True)
        run_setup.assert_called_once()
        self.assertEqual(run_setup.call_args.args[1]["agents"], ["codex"])

    def test_help_is_a_workflow_manual(self) -> None:
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(manual(), 0)
        self.assertIn("lore review", output.getvalue())
        self.assertIn("lore price", output.getvalue())

    def test_private_data_and_terminal_output_are_protected(self) -> None:
        with Store() as store:
            self.assertEqual(stat.S_IMODE(store.path.stat().st_mode), 0o600)
            with self.assertRaisesRegex(ValueError, "memory not found"):
                store.set_status(999, "private")
            with self.assertRaisesRegex(ValueError, "limit"):
                store.search("anything", limit=-1)
        memory = Memory(
            1, "test", "native", "Bad\x1b[2J", "Body\x07 text", "", "private", "", "now"
        )
        output = StringIO()
        with redirect_stdout(output):
            memory_card(memory)
        self.assertNotIn("\x1b", output.getvalue())
        self.assertNotIn("\x07", output.getvalue())

    def test_invalid_prices_and_mcp_inputs_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "finite"):
            price(float("nan"))
        self.assertEqual(dispatch([])["error"]["code"], -32600)  # type: ignore[index]
        for arguments in ({"query": 1}, {"query": "ok", "max_results": 11}):
            with self.assertRaises((TypeError, ValueError)):
                call_tool("answer", arguments)

    def test_remote_mcp_requires_authentication(self) -> None:
        with self.assertRaisesRegex(ValueError, "requires --token"):
            http("0.0.0.0", 0)

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
