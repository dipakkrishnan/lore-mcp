from __future__ import annotations

import json
import os
import sqlite3
import stat
import sys
import tempfile
import tomllib
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from lore import automation, blueprint
from lore.cli import (
    blueprint_apply,
    blueprint_show,
    manual,
    price,
    review,
    setup,
    status,
)
from lore.mcp import call_tool, dispatch, http
from lore.sources import scan
from lore import store as store_module
from lore.store import STATUSES, Memory, PublicationKind, Status, Store
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
            self.assertIs(found[0].status, Status.PRIVATE)
            store.set_status(found[0].id, "discarded")
            self.assertIs(store.search("integration", status="discarded")[0].status, Status.DISCARDED)

        # Reviewing the discarded queue can bring a memory back to private.
        with patch("lore.cli.ask", return_value="k"), redirect_stdout(StringIO()):
            review("integration", "discarded", 0)
        with Store() as store:
            self.assertIs(store.search("integration", status="private")[0].status, Status.PRIVATE)

    def test_legacy_database_is_normalized_on_open(self) -> None:
        # A database created before the retention-only model holds rows in
        # statuses `Status` now rejects. CREATE TABLE IF NOT EXISTS leaves the
        # old table in place, so without normalization any search touching such
        # a row crashes with a validation error — and there is no CLI remedy,
        # because reclassifying needs an id and ids come from search.
        home = Path(os.environ["LORE_HOME"])
        home.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(home / "lore.db")
        db.executescript(
            """
            CREATE TABLE memories (
                id INTEGER PRIMARY KEY, source TEXT NOT NULL,
                origin TEXT NOT NULL DEFAULT 'native', source_path TEXT NOT NULL,
                source_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
                title TEXT NOT NULL, content TEXT NOT NULL,
                project TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','private','external','discarded')),
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE VIRTUAL TABLE memories_fts USING fts5(
                title, content, project,
                content='memories', content_rowid='id',
                tokenize='unicode61 remove_diacritics 2');
            CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid,title,content,project)
                VALUES (new.id,new.title,new.content,new.project); END;
            """
        )
        for index, legacy in enumerate(("pending", "external", "private", "discarded")):
            db.execute(
                """INSERT INTO memories(source,origin,source_path,source_key,
                   fingerprint,title,content,status,created_at,updated_at)
                   VALUES ('codex','native',?,?,?,?,?,?,'2026-07-01','2026-07-01')""",
                (f"p{index}", f"k{index}", f"f{index}", f"Lesson {legacy}", "a lesson body", legacy),
            )
        db.commit()
        db.close()
        with Store() as store:
            counts = store.counts()
            # pending and external became plain private rows; discarded survived.
            self.assertEqual(counts["private"], 3)
            self.assertEqual(counts["discarded"], 1)
            # Unfiltered search maps every row through the Status enum — the
            # crash this migration prevents. All four must validate.
            found = store.search("lesson")
            self.assertEqual(len(found), 4)
            self.assertEqual({m.status for m in found}, {Status.PRIVATE, Status.DISCARDED})

    def test_disclosure_is_not_a_memory_status(self) -> None:
        # `external` and `pending` are gone: retention is the only thing a status
        # expresses, and neither one can be set or queried any more.
        self.assertEqual(STATUSES, ("private", "discarded"))
        self._seed_memory("A lesson", "private")
        with Store() as store:
            memory = store.search("lesson")[0]
            for retired in ("external", "pending"):
                with self.assertRaisesRegex(ValueError, "invalid status"):
                    store.set_status(memory.id, retired)
                with self.assertRaisesRegex(ValueError, "invalid status"):
                    store.search("lesson", status=retired)

    def test_changed_memory_keeps_its_status_and_flags_its_publications(self) -> None:
        path = Path(os.environ["CODEX_HOME"]) / "memories/MEMORY.md"
        path.parent.mkdir(parents=True)
        path.write_text("# Project\n\nFirst version")
        with Store() as store:
            scan(store, {"codex"})
            memory = store.search("First")[0]
            fresh = store.add_publication(
                title="Project claim", content="a claim", provenance=[memory.id]
            )
            unrelated = store.add_publication(
                title="Other claim", content="another claim", provenance=[memory.id + 900]
            )

            path.write_text("# Project\n\nSecond version")
            scan(store, {"codex"})

            # The memory stays private: a change must not rebuild a review queue.
            updated = store.search("Second")[0]
            self.assertIs(updated.status, Status.PRIVATE)
            self.assertEqual(store.counts()["private"], 1)

            # Its publication is flagged for re-approval, and only its own.
            self.assertEqual([p.id for p in store.stale_publications()], [fresh])
            by_id = {p.id: p for p in store.list_publications()}
            self.assertIsNotNone(by_id[fresh].source_changed_at)
            self.assertIsNone(by_id[unrelated].source_changed_at)

            # Flagged is not revoked: the approved text stays externally readable.
            self.assertIn(fresh, [p.id for p in store.list_publications(active_only=True)])
            store.clear_publication_flag(fresh)
            self.assertEqual(store.stale_publications(), [])

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

    def test_profile_without_executor_saves_but_cannot_schedule(self) -> None:
        profile = automation.save_profile({"role": "maintainer", "executor": ""})
        self.assertEqual(profile.get("executor", ""), "")
        with self.assertRaisesRegex(ValueError, "no-schedule"):
            automation.install(profile)
        with self.assertRaisesRegex(ValueError, "unknown executor"):
            automation.save_profile({"executor": "cursor"})

    def test_prompt_states_the_thesis_and_derives_statuses(self) -> None:
        prompt = automation.build_prompt({"role": "maintainer"})
        self.assertIn("You never publish and never change disclosure", prompt)
        self.assertIn("Worth publishing", prompt)
        self.assertIn("What earns a place in memory", prompt)
        for status in store_module.STATUSES:
            if status == "discarded":
                self.assertNotIn(f"--status {status}", prompt)
            else:
                self.assertIn(f"search --status {status} --limit 0 --json", prompt)

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
            store.set_status(memory.id, "private")

        self.assertEqual(report["automation"]["found"], 1)
        topic.write_text(
            "# Agent systems\n\nA durable lesson with new private context."
        )
        with Store() as store:
            scan(store, {"automation"})
            self.assertIs(store.search("private context")[0].status, Status.PRIVATE)
            memory = store.search("private context")[0]
            store.set_status(memory.id, "discarded")
        topic.write_text(
            "# Agent systems\n\nA durable lesson changed after rejection."
        )
        with Store() as store:
            scan(store, {"automation"})
            self.assertIs(store.search("after rejection")[0].status, Status.DISCARDED)

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
            id=1, source="test", origin="native", title="Bad\x1b[2J",
            content="Body\x07 text", project="", status="private",
            source_path="", updated_at="now",
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

    def _seed_memory(self, title: str, status: str) -> None:
        with Store() as store:
            store.put(
                source="test",
                origin="native",
                source_path=title,
                source_key=title,
                fingerprint=title,
                title=title,
                content=f"{title} about deployment",
            )
            store.set_status(store.search(title)[0].id, status)

    def _answer(self, query: str) -> str:
        response = dispatch(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "answer", "arguments": {"query": query}},
            }
        )
        return response["result"]["content"][0]["text"]  # type: ignore[index]

    def test_new_imports_default_to_private(self) -> None:
        with Store() as store:
            store.put(
                source="test",
                origin="native",
                source_path="fresh",
                source_key="fresh",
                fingerprint="fresh",
                title="Fresh import",
                content="a freshly imported memory",
            )
            self.assertIs(store.search("Fresh")[0].status, Status.PRIVATE)
            self.assertNotIn("pending", store.counts())

    def test_publications_add_list_revoke(self) -> None:
        with Store() as store:
            pid = store.add_publication(
                title="Pricing claim",
                content="a bounded claim about pricing agent APIs",
                provenance=[1, 2],
            )
            active = store.list_publications(active_only=True)
            self.assertEqual(len(active), 1)
            self.assertIs(active[0].kind, PublicationKind.CLAIM)
            self.assertEqual(active[0].provenance, [1, 2])
            doc_id = store.add_publication(
                title="Doc", content="verbatim", kind=PublicationKind.CONTENT
            )
            self.assertGreater(doc_id, 0)
            with self.assertRaisesRegex(ValueError, "not a valid PublicationKind"):
                store.add_publication(title="Bad", content="x", kind="secret")
            store.revoke_publication(pid)
            self.assertEqual([p.id for p in store.list_publications(active_only=True)], [doc_id])
            self.assertEqual(len(store.list_publications()), 2)  # revoked still listed
            self.assertEqual(store.search_publications("pricing"), [])  # revoked not searchable

    def test_publication_kind_accepts_a_plain_string(self) -> None:
        # Callers (and the future `lore publication apply`) may pass raw strings;
        # the enum normalizes them and rejects anything else.
        with Store() as store:
            store.add_publication(title="Str", content="x", kind="content")
            self.assertIs(
                store.list_publications()[0].kind, PublicationKind.CONTENT
            )

    def test_review_defaults_to_the_private_library(self) -> None:
        # Nothing is ever 'pending' now, so review's default queue must be the
        # private library or the command is a permanent no-op.
        self._seed_memory("Kept lesson", "private")
        self._seed_memory("Other lesson", "private")
        with patch("lore.cli.ask", return_value="d"), redirect_stdout(StringIO()):
            review()
        with Store() as store:
            self.assertEqual(store.counts()["discarded"], 2)
            self.assertEqual(store.counts()["private"], 0)

    def test_status_counts_private_and_discarded_separately(self) -> None:
        self._seed_memory("Kept lesson", "private")
        self._seed_memory("Dropped lesson", "discarded")
        buffer = StringIO()
        with redirect_stdout(buffer):
            status()
        text = buffer.getvalue()
        self.assertIn("1 private", text)
        self.assertIn("1 discarded", text)
        self.assertIn("0 active publications", text)
        # A discarded memory must never be counted as private.
        self.assertNotIn("2 private", text)

    def test_answer_never_discloses_private_memory_ids(self) -> None:
        # Provenance is owner-visible; buyers must not learn the ids or the
        # number of private rows behind a publication.
        with Store() as store:
            store.add_publication(
                title="Deployment guide",
                content="deployment guidance",
                provenance=[41, 42, 43],
            )
        payload = json.loads(self._answer("deployment"))
        entry = payload["answer_context"][0]
        self.assertEqual(entry["title"], "Deployment guide")
        # Assert on the payload shape, not on substrings: an ISO timestamp
        # happens to contain two-digit numbers and would mask a real leak.
        self.assertEqual(set(entry["provenance"]), {"kind", "updated_at"})

    def test_mcp_reads_only_active_publications_never_memories(self) -> None:
        # Memories of every disclosure status must be unreachable from MCP.
        self._seed_memory("Discarded memory", "discarded")
        self._seed_memory("Private memory", "private")
        with Store() as store:
            active_id = store.add_publication(title="Deployment guide", content="deployment guidance")
            revoked_id = store.add_publication(title="Old deployment note", content="stale deployment text")
            store.revoke_publication(revoked_id)
        text = self._answer("deployment")
        self.assertIn("Deployment guide", text)
        self.assertNotIn("Discarded memory", text)  # no memory is reachable
        self.assertNotIn("Private memory", text)  # private memory unreachable
        self.assertNotIn("Old deployment note", text)  # revoked publication excluded
        # Revoking the last active publication removes it from MCP immediately.
        with Store() as store:
            store.revoke_publication(active_id)
        self.assertNotIn("Deployment guide", self._answer("deployment"))

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


if __name__ == "__main__":
    unittest.main()
