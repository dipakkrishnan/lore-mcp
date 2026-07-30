from __future__ import annotations

import hashlib
import json
import os
import stat
import sys
import tempfile
import tomllib
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from lore import automation, blueprint, extract
from lore.cli import blueprint_apply, blueprint_show, manual, price, review, setup
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

    def test_changed_native_memory_requires_review_again(self) -> None:
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
            self.assertEqual(updated.status, "pending")
            self.assertEqual(store.counts()["pending"], 1)

    def test_codex_import_ignores_intermediate_memory_files(self) -> None:
        root = Path(os.environ["CODEX_HOME"]) / "memories"
        root.mkdir(parents=True)
        (root / "MEMORY.md").write_text("# Durable\n\nKeep this.")
        (root / "raw_memories.md").write_text("# Raw\n\nDuplicate evidence.")
        summaries = root / "rollout_summaries"
        summaries.mkdir()
        (summaries / "task.md").write_text("# Task\n\nDuplicate summary.")
        synthesis = Path(os.environ["LORE_HOME"]) / "memories"
        synthesis.mkdir(parents=True)
        (synthesis / "linked.md").symlink_to(root / "MEMORY.md")

        with Store() as store:
            report = scan(store, {"codex", "automation"})
            self.assertEqual(report["codex"]["found"], 1)
            self.assertEqual(report["automation"]["found"], 0)
            self.assertEqual(store.search("Keep this")[0].title, "Durable")
            self.assertEqual(store.search("Duplicate"), [])

    def test_native_automation_prompt_hands_off_execution(self) -> None:
        profile = {
            "role": "maintainer",
            "domains": "developer tools",
            "valuable_context": "failed launches",
            "preferences": "small changes",
            "boundaries": "secrets",
            "executor": "codex",
            "model": "gpt-test",
            "cadence": "weekly",
            "hour": 9,
        }
        automation.save_profile(profile)

        prompt = automation.build_prompt(profile)
        self.assertIn("topic-based memory library", prompt)
        self.assertIn("perform a cold-start pass", prompt)
        self.assertIn("delegate coherent slices", prompt)
        self.assertIn("/INDEX.md", prompt)
        self.assertIn("failed launches", prompt)
        self.assertIn("lore search --status private", prompt)
        self.assertIn("-m lore sync --source automation", prompt)
        self.assertIn("prior agent sessions", prompt)

        with patch("lore.automation.remove_task") as remove:
            definition = automation.install(profile).read_text()
        self.assertEqual(remove.call_args.args[0].agent, automation.Agent.CLAUDE)
        self.assertIn('id = "lore-memory-synthesis"', definition)
        self.assertIn('rrule = "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0"', definition)
        self.assertIn('model = "gpt-test"', definition)
        self.assertIn('execution_environment = "local"', definition)
        self.assertTrue(
            tomllib.loads(definition)["prompt"].endswith(automation.build_prompt(profile))
        )

        for path in (
            automation.profile_path(),
            automation.prompt_path(),
        ):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        claude_profile = automation.save_profile({
            **profile, "executor": "claude", "model": "opus"
        })
        with (
            patch("lore.automation.remove_task") as remove,
            patch("lore.automation.install_task", return_value=Path("task")) as install,
        ):
            automation.install(claude_profile)
        self.assertEqual(remove.call_args.args[0].agent, automation.Agent.CODEX)
        task = install.call_args.args[0]
        self.assertEqual(task.agent, automation.Agent.CLAUDE)
        self.assertEqual(task.prompt_path, automation.prompt_path())
        self.assertEqual(task.model, "opus")
        self.assertEqual(
            task.before,
            (
                "env",
                f"LORE_HOME={Path(os.environ['LORE_HOME'])}",
                sys.executable,
                "-m",
                "lore",
                "sync",
            ),
        )
        self.assertEqual(
            task.allowed_tools, ("Read", "Glob", "Grep", "Write", "Bash", "Agent")
        )
        self.assertEqual(
            task.add_dirs,
            (
                Path(os.environ["CLAUDE_HOME"]),
                Path(os.environ["CODEX_HOME"]),
            ),
        )
        self.assertEqual(dict(task.environment)["LORE_HOME"], os.environ["LORE_HOME"])
        with (
            patch("lore.automation.remove_task"),
            patch("lore.automation.install_task", return_value=Path("task")) as install,
        ):
            automation.install(profile)
        task = install.call_args.args[0]
        self.assertEqual(task.allowed_tools, ())
        self.assertEqual(task.environment, ())

    def test_save_profile_drops_checkpoint_only_fields(self) -> None:
        automation.save_profile({
            "role": "maintainer", "executor": "codex",
            "phase1_done": True,
        })
        saved = json.loads(automation.profile_path().read_text())
        self.assertEqual(saved["role"], "maintainer")
        self.assertEqual(saved["executor"], "codex")
        self.assertNotIn("phase1_done", saved)
        with self.assertRaisesRegex(ValueError, "cadence"):
            automation.save_profile({"executor": "codex", "cadence": "monthly"})
        with self.assertRaisesRegex(ValueError, "cadence"):
            automation.save_profile({"executor": "codex", "cadence": []})
        with self.assertRaisesRegex(ValueError, "hour"):
            automation.save_profile({"executor": "codex", "hour": "9"})
        profile = automation.save_profile(
            {
                "executor": "codex",
                "role": "software\nengineer",
                "model": None,
                "hour": None,
            }
        )
        self.assertEqual(profile["role"], "software engineer")
        self.assertNotIn("model", profile)
        self.assertNotIn("hour", profile)

    def test_synthesis_index_is_not_imported_as_memory(self) -> None:
        root = Path(os.environ["LORE_HOME"]) / "memories"
        root.mkdir(parents=True)
        topic = root / "projects/agent-systems.md"
        topic.parent.mkdir()
        topic.write_text("# Agent systems\n\nA durable lesson.")
        (root / "INDEX.md").write_text("# Lore memory index\n\nRead agent-systems.md.")

        with Store() as store:
            report = scan(store, {"automation"})
            memory = store.search("durable")[0]
            store.set_status(memory.id, "external")

        self.assertEqual(report["automation"]["found"], 1)
        topic.write_text(
            "# Agent systems\n\nA durable lesson with new private context."
        )
        with Store() as store:
            scan(store, {"automation"})
            self.assertEqual(store.search("private context")[0].status, "pending")
            memory = store.search("private context")[0]
            store.set_status(memory.id, "discarded")
        topic.write_text(
            "# Agent systems\n\nA durable lesson changed after rejection."
        )
        with Store() as store:
            scan(store, {"automation"})
            self.assertEqual(store.search("after rejection")[0].status, "discarded")

    def test_setup_imports_then_hands_off_to_agent(self) -> None:
        memory = Path(os.environ["CODEX_HOME"]) / "memories/MEMORY.md"
        memory.parent.mkdir(parents=True)
        memory.write_text("# Preference\n\nKeep setup short.")
        output = StringIO()

        with redirect_stdout(output):
            self.assertEqual(setup(True), 0)

        self.assertIn("Imported 1 candidate memories", output.getvalue())
        self.assertIn("Onboard me to Lore", output.getvalue())
        automation_dir = Path(os.environ["LORE_HOME"]) / "automation"
        self.assertEqual(stat.S_IMODE(automation_dir.stat().st_mode), 0o700)

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
            "executor": "codex",
            "model": "",
            "cadence": "daily",
            "hour": 21,
        }
        prompt = automation.build_prompt(profile)
        for marker in (
            "organizing_axis",
            "topic_outline",
            "section_labels",
            "depth_default",
            "professor",
            "distributed systems",
        ):
            self.assertNotIn(marker, prompt)


class ExtractTest(unittest.TestCase):
    """Text extraction for manually captured files (issue #8, shared plumbing)."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def _write(self, name: str, data: bytes | str) -> Path:
        path = self.root / name
        if isinstance(data, str):
            path.write_text(data, encoding="utf-8")
        else:
            path.write_bytes(data)
        return path

    def test_normalize_type_accepts_suffixes_aliases_and_mime(self) -> None:
        for declared, expected in [
            (".MD", "md"),
            ("md", "md"),
            ("markdown", "md"),
            ("  .TxT ", "txt"),
            ("text", "txt"),
            ("text/plain", "txt"),
            ("application/json", "json"),
            ("text/csv", "csv"),
            ("pdf", "pdf"),
        ]:
            self.assertEqual(extract.normalize_type(declared), expected, declared)

    def test_normalize_type_tolerates_non_strings(self) -> None:
        for declared in (None, 7, [], {}):
            self.assertEqual(extract.normalize_type(declared), "")
            self.assertFalse(extract.supported_type(declared))

    def test_supported_types_are_the_stdlib_text_types(self) -> None:
        for kind in ("txt", "md", "csv", "json"):
            self.assertTrue(extract.supported_type(kind), kind)
        for kind in ("pdf", "docx", "png", "zip", ""):
            self.assertFalse(extract.supported_type(kind), kind)

    def test_every_text_type_extracts_and_strips(self) -> None:
        for kind, body in [
            ("txt", "a plain note"),
            ("md", "# Heading\n\nclaim plus evidence"),
            ("csv", "name,value\nada,1"),
            ("json", '{"prefers": "claim-shaped notes"}'),
        ]:
            result = extract.extract_file(self._write(f"note.{kind}", f"\n  {body}  \n"))
            self.assertEqual(result.kind, kind)
            self.assertEqual(result.text, body)
            self.assertEqual(result.reason, "")
            self.assertTrue(result.indexed)

    def test_fingerprint_is_sha256_of_raw_bytes(self) -> None:
        data = b"stable content"
        result = extract.extract_bytes(data, "txt")
        self.assertEqual(result.fingerprint, hashlib.sha256(data).hexdigest())
        self.assertEqual(result.byte_size, len(data))

    def test_rescanning_identical_content_fingerprints_identically(self) -> None:
        # Dedup discipline: the dropbox must treat a re-dropped file as a no-op.
        first = extract.extract_file(self._write("one.md", "same body"))
        second = extract.extract_file(self._write("two.md", "same body"))
        self.assertEqual(first.fingerprint, second.fingerprint)

    def test_unsupported_type_is_not_indexed_but_still_described(self) -> None:
        path = self._write("scan.pdf", b"%PDF-1.7 binary")
        result = extract.extract_file(path)
        self.assertIsNone(result.text)
        self.assertFalse(result.indexed)
        self.assertEqual(result.reason, "unsupported-type")
        self.assertEqual(result.kind, "pdf")
        # Size survives so review can show the row as "not indexed".
        self.assertEqual(result.byte_size, path.stat().st_size)

    def test_unsupported_file_is_never_read_into_memory(self) -> None:
        path = self._write("big.docx", b"x" * 4096)
        result = extract.extract_file(path, max_bytes=16)
        self.assertEqual(result.reason, "unsupported-type")
        self.assertEqual(result.fingerprint, "")

    def test_declared_type_overrides_the_suffix(self) -> None:
        path = self._write("note.pdf", "actually plain text")
        self.assertEqual(extract.extract_file(path, "txt").text, "actually plain text")
        text_file = self._write("n.md", "hi")
        self.assertEqual(extract.extract_file(text_file, "pdf").reason, "unsupported-type")

    def test_oversized_file_is_rejected_on_stat(self) -> None:
        path = self._write("long.txt", "y" * 100)
        result = extract.extract_file(path, max_bytes=10)
        self.assertEqual(result.reason, "too-large")
        self.assertIsNone(result.text)
        self.assertEqual(result.byte_size, 100)
        self.assertEqual(result.fingerprint, "")

    def test_oversized_bytes_are_rejected(self) -> None:
        result = extract.extract_bytes(b"y" * 100, "txt", max_bytes=10)
        self.assertEqual(result.reason, "too-large")

    def test_size_cap_is_inclusive(self) -> None:
        data = b"y" * 10
        at_cap = extract.extract_file(self._write("at.txt", data), max_bytes=10)
        self.assertEqual(extract.extract_bytes(data, "txt", max_bytes=10).text, "y" * 10)
        self.assertEqual(at_cap.text, "y" * 10)

    def test_default_cap_is_low_single_digit_mb(self) -> None:
        self.assertEqual(extract.MAX_BYTES, 2_000_000)
        self.assertEqual(extract.SETTING_MAX_BYTES, "capture_max_bytes")

    def test_cap_default_is_configurable_through_a_setting(self) -> None:
        # The cap is an owner setting; extract stays pure and takes it as an argument.
        with Store(self.root / "lore.db") as store:
            store.set_setting(extract.SETTING_MAX_BYTES, 4)
            cap = store.setting(extract.SETTING_MAX_BYTES, extract.MAX_BYTES)
        result = extract.extract_bytes(b"toolong", "txt", max_bytes=cap)
        self.assertEqual(result.reason, "too-large")

    def test_binary_content_wearing_a_text_suffix_is_rejected(self) -> None:
        result = extract.extract_file(self._write("sneaky.txt", b"text\x00\x01binary"))
        self.assertEqual(result.reason, "binary")
        self.assertIsNone(result.text)

    def test_undecodable_bytes_are_rejected(self) -> None:
        result = extract.extract_file(self._write("latin.md", b"caf\xe9 not utf8"))
        self.assertEqual(result.reason, "undecodable")
        self.assertIsNone(result.text)

    def test_empty_and_whitespace_only_files_are_not_indexed(self) -> None:
        for name, body in [("blank.txt", ""), ("spaces.md", "  \n\t\n  ")]:
            result = extract.extract_file(self._write(name, body))
            self.assertEqual(result.reason, "empty", name)
            self.assertIsNone(result.text)

    def test_symlinks_are_refused(self) -> None:
        secret = self._write("secret.txt", "private key material")
        link = self.root / "link.txt"
        link.symlink_to(secret)
        result = extract.extract_file(link)
        self.assertEqual(result.reason, "symlink")
        self.assertIsNone(result.text)

    def test_directories_are_refused(self) -> None:
        folder = self.root / "processed.txt"
        folder.mkdir()
        self.assertEqual(extract.extract_file(folder).reason, "not-a-file")

    def test_missing_file_is_unreadable_rather_than_raising(self) -> None:
        result = extract.extract_file(self.root / "gone.txt")
        self.assertEqual(result.reason, "unreadable")
        self.assertIsNone(result.text)

    def test_unreadable_file_is_reported_rather_than_raising(self) -> None:
        path = self._write("locked.txt", "content")
        with patch.object(Path, "read_bytes", side_effect=PermissionError("denied")):
            result = extract.extract_file(path)
        self.assertEqual(result.reason, "unreadable")
        self.assertIsNone(result.text)


if __name__ == "__main__":
    unittest.main()
