from __future__ import annotations

import json
import os
import stat
import tempfile
import tomllib
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

from lore import automation, blueprint
from lore.cli import blueprint_apply, blueprint_show, configure_automation, manual, price, review
from lore.mcp import call_tool, dispatch, http
from lore.sources import scan
from lore.store import Memory, Store
from lore.ui import memory_card


def _blueprint_input(*, persona: str = "professor", name: str = "Ada") -> dict:
    """Build a minimal, valid blueprint interview payload for tests."""
    return {
        "version": 1,
        "name": name,
        "persona": persona,
        "topic_outline": ["distributed systems", "consensus"],
        "focus_topics": ["consensus tradeoffs"],
        "general_areas": ["intro networking"],
        "storytelling": "Short claim-plus-evidence notes; lecture tone.",
    }


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
        setup = automation.setup_prompt("claude", profile)
        self.assertIn("weekly at 9:00 local time", setup)
        self.assertIn("Use model opus", setup)
        claude = automation.setup_command("claude", profile)
        self.assertEqual(claude[:2], ["claude", "-p"])
        self.assertIn(os.environ["CLAUDE_HOME"], claude)
        self.assertEqual(claude[-2], "--")
        self.assertIn("LORE_SETUP_COMPLETE", claude[-1])

        automation.install("codex", profile)
        definition = automation.codex_automation_path().read_text()
        self.assertIn('id = "lore-memory-synthesis"', definition)
        self.assertIn('rrule = "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0"', definition)
        self.assertIn('model = "gpt-test"', definition)
        self.assertIn('execution_environment = "local"', definition)
        self.assertEqual(
            tomllib.loads(definition)["prompt"], automation.build_prompt("codex", profile)
        )

        completed = CompletedProcess(claude, 0, "LORE_SETUP_COMPLETE", "")
        with patch("lore.automation.subprocess.run", return_value=completed) as run:
            self.assertIn("LORE_SETUP_COMPLETE", automation.install("claude", profile))
            self.assertEqual(run.call_args.kwargs["cwd"], Path(os.environ["LORE_HOME"]))
            self.assertEqual(run.call_args.kwargs["timeout"], 300)
        failed = CompletedProcess(claude, 0, "Could not configure it", "")
        with patch("lore.automation.subprocess.run", return_value=failed):
            with self.assertRaisesRegex(OSError, "Could not configure"):
                automation.install("claude", profile)

        for path in (
            automation.profile_path(),
            automation.profile_path().parent / "codex-prompt.md",
        ):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        automation.save_profile({**profile, "agents": ["codex"]})
        self.assertFalse((automation.profile_path().parent / "claude-prompt.md").exists())

    def test_save_profile_drops_checkpoint_only_fields(self) -> None:
        automation.save_profile({
            "role": "maintainer", "agents": ["codex"],
            "phase1_done": True, "backfill_weeks": 8, "backfill_done": ["week"],
        })
        saved = json.loads(automation.profile_path().read_text())
        self.assertEqual(saved["role"], "maintainer")
        for leaked in ("phase1_done", "backfill_weeks", "backfill_done"):
            self.assertNotIn(leaked, saved)

    def test_setup_configures_only_installed_agents(self) -> None:
        installed = lambda agent: f"/bin/{agent}" if agent == "codex" else None
        with (
            patch("lore.cli.shutil.which", side_effect=installed),
            patch("lore.automation.install") as run_setup,
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

    def _write_blueprint_input(self, data: dict) -> Path:
        path = Path(os.environ["LORE_HOME"]) / "blueprint-input.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
        return path

    def test_blueprint_apply_happy_path(self) -> None:
        data = _blueprint_input()
        data["topic_outline"] = ["distributed systems", "consensus", "distributed systems"]
        path = self._write_blueprint_input(data)
        result = blueprint.apply(path)
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["name"], "Ada")
        self.assertEqual(result["persona"], "professor")
        self.assertIn("captured_at", result)
        self.assertEqual(result["topic_outline"], ["distributed systems", "consensus"])

    def test_blueprint_persona_seeds_axis_when_omitted(self) -> None:
        result = blueprint.normalize(_blueprint_input(persona="professor"))
        self.assertEqual(result["organizing_axis"], "knowledge")

    def test_blueprint_axis_override_wins(self) -> None:
        data = _blueprint_input(persona="professor")
        data["organizing_axis"] = "chronological"
        result = blueprint.normalize(data)
        self.assertEqual(result["organizing_axis"], "chronological")

    def test_blueprint_resolved_structure_matches_persona(self) -> None:
        result = blueprint.normalize(_blueprint_input(persona="executive"))
        profile = blueprint.PERSONA_PROFILES["executive"]
        self.assertEqual(result["depth_default"], profile["depth_default"])
        self.assertEqual(result["section_labels"], profile["section_labels"])

    def test_blueprint_registry_is_complete_for_every_persona(self) -> None:
        for persona in blueprint.PERSONAS:
            profile = blueprint.PERSONA_PROFILES[persona]
            self.assertIn(profile["axis"], blueprint.AXES)
            self.assertTrue(profile["depth_default"])
            self.assertEqual(
                set(profile["section_labels"]), {"outline", "focus", "general", "voice"}
            )

    def test_blueprint_rejects_command_authored_fields(self) -> None:
        for field, value in (
            ("captured_at", "2020-01-01T00:00:00Z"),
            ("depth_default", "deep"),
            ("section_labels", {}),
        ):
            data = _blueprint_input()
            data[field] = value
            with self.assertRaisesRegex(ValueError, "unexpected blueprint field"):
                blueprint.normalize(data)

    def test_blueprint_files_are_owner_private(self) -> None:
        blueprint.apply(self._write_blueprint_input(_blueprint_input()))
        self.assertEqual(stat.S_IMODE(blueprint.blueprint_path().stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(blueprint.lore_map_path().stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(blueprint.blueprint_path().parent.stat().st_mode), 0o700)

    def test_blueprint_rejects_unknown_persona(self) -> None:
        data = _blueprint_input()
        data["persona"] = "wizard"
        with self.assertRaisesRegex(ValueError, "unknown persona"):
            blueprint.normalize(data)

    def test_blueprint_rejects_bad_axis_and_version(self) -> None:
        data = _blueprint_input()
        data["organizing_axis"] = "alphabetical"
        with self.assertRaisesRegex(ValueError, "unknown organizing axis"):
            blueprint.normalize(data)
        data = _blueprint_input()
        data["version"] = 2
        with self.assertRaisesRegex(ValueError, "unsupported blueprint version"):
            blueprint.normalize(data)

    def test_blueprint_rejects_missing_required(self) -> None:
        data = _blueprint_input()
        data["name"] = "   "
        with self.assertRaisesRegex(ValueError, "name cannot be empty"):
            blueprint.normalize(data)
        data = _blueprint_input()
        data["topic_outline"] = []
        with self.assertRaisesRegex(ValueError, "topic_outline cannot be empty"):
            blueprint.normalize(data)

    def test_blueprint_normalizes_lists(self) -> None:
        data = _blueprint_input()
        data["topic_outline"] = ["  a  ", "", "a", "b"]
        result = blueprint.normalize(data)
        self.assertEqual(result["topic_outline"], ["a", "b"])

    def test_blueprint_overwrite_is_idempotent(self) -> None:
        blueprint.apply(self._write_blueprint_input(_blueprint_input(name="Ada")))
        result = blueprint.apply(self._write_blueprint_input(_blueprint_input(name="Grace")))
        self.assertEqual(result["name"], "Grace")
        self.assertEqual(blueprint.load_blueprint()["name"], "Grace")
        self.assertEqual(stat.S_IMODE(blueprint.blueprint_path().stat().st_mode), 0o600)

    def test_lore_map_render_uses_persona_section_labels(self) -> None:
        result = blueprint.normalize(_blueprint_input(persona="professor"))
        rendered = blueprint.render_map(result)
        self.assertIn("Professor Ada", rendered)
        self.assertIn("Course outline", rendered)
        self.assertIn("distributed systems", rendered)
        self.assertIn("Deep dives", rendered)
        self.assertIn("Short claim-plus-evidence", rendered)

    def test_blueprint_sanitizes_control_characters(self) -> None:
        data = _blueprint_input()
        data["name"] = "Bad\x1b[2J"
        data["storytelling"] = "Body\x07 text"
        result = blueprint.normalize(data)
        rendered = blueprint.render_map(result)
        self.assertNotIn("\x1b", rendered)
        self.assertNotIn("\x07", rendered)

    def test_blueprint_show_without_blueprint(self) -> None:
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(blueprint_show(), 0)
        self.assertIn("No blueprint yet", output.getvalue())

    def test_blueprint_cli_apply_and_show(self) -> None:
        path = self._write_blueprint_input(_blueprint_input(persona="storyteller"))
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(blueprint_apply(str(path)), 0)
        self.assertIn("captured", output.getvalue().lower())
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(blueprint_show(), 0)
        self.assertIn("Chapters", output.getvalue())

    def test_build_prompt_ignores_blueprint(self) -> None:
        blueprint.apply(self._write_blueprint_input(_blueprint_input()))
        profile = {
            "role": "maintainer",
            "domains": "",
            "valuable_context": "",
            "preferences": "",
            "boundaries": "",
            "agents": [],
            "models": {},
            "cadence": "daily",
            "hour": 21,
        }
        prompt = automation.build_prompt("codex", profile)
        for marker in (
            "organizing_axis",
            "topic_outline",
            "section_labels",
            "depth_default",
            "professor",
            "distributed systems",
        ):
            self.assertNotIn(marker, prompt)


if __name__ == "__main__":
    unittest.main()
