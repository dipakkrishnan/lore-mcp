from __future__ import annotations

import json
import os
import sqlite3
import stat
import subprocess
import sys
import tempfile
import tomllib
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from lore import automation, blueprint
from lore import deploy as deploy_module
from lore.cli import (
    blueprint_apply,
    blueprint_show,
    manual,
    parser,
    price,
    publication_apply as cli_publication_apply,
    publication_list as cli_publication_list,
    publication_reapprove as cli_publication_reapprove,
    publication_revoke as cli_publication_revoke,
    review,
    setup,
    status,
)
from lore.mcp import call_tool, dispatch, http
from lore.sources import scan
from lore import store as store_module
from lore.store import (
    STATUSES,
    Memory,
    PublicationKind,
    Status,
    Store,
    new_public_id,
    valid_public_id,
)
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
        # HOME is redirected too: windup resolves a Claude schedule's plist through
        # Path.home(), so an unsandboxed test that installed or removed one would
        # reach into the developer's real ~/Library/LaunchAgents.
        self.environment = {
            key: os.environ.get(key)
            for key in ("LORE_HOME", "CLAUDE_HOME", "CODEX_HOME", "HOME")
        }
        os.environ["LORE_HOME"] = str(root / "lore")
        os.environ["CLAUDE_HOME"] = str(root / "claude")
        os.environ["CODEX_HOME"] = str(root / "codex")
        os.environ["HOME"] = str(root / "home")
        (root / "home").mkdir()

    def tearDown(self) -> None:
        for key, value in self.environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
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
        unrelated_memory_id = self._seed_memory("Unrelated evidence", "private")
        with Store() as store:
            scan(store, {"codex"})
            memory = store.search("First")[0]
            fresh = store.add_publication(
                title="Project claim", content="a claim", topic="projects",
                provenance=[memory.id],
            )
            unrelated = store.add_publication(
                title="Other claim", content="another claim", topic="other",
                provenance=[unrelated_memory_id],
            )

            path.write_text("# Project\n\nSecond version")
            scan(store, {"codex"})

            # The memory stays private: a change must not rebuild a review queue.
            updated = store.search("Second")[0]
            self.assertIs(updated.status, Status.PRIVATE)
            self.assertEqual(store.counts()["private"], 2)

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

    def test_node_deploy_materializes_without_dev_artifacts(self) -> None:
        target = deploy_module.materialize()
        self.assertTrue((target / "src/index.ts").is_file())
        self.assertTrue((target / "scripts/pay.ts").is_file())
        self.assertTrue((target / ".buyer.env.example").is_file())
        self.assertFalse((target / "node_modules").exists())
        self.assertFalse((target / ".buyer.env").exists())
        # Secrets live here, so the directory is owner-only like the rest of ~/.lore.
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
        # Re-running upgrades the source but never touches the owner's secrets file,
        # and the D1 id the owner pasted into wrangler.jsonc survives the upgrade.
        (target / ".buyer.env").write_text("BUYER_TEST_PRIVATE_KEY=untouched")
        config = target / "wrangler.jsonc"
        config.write_text(
            config.read_text().replace("REPLACE_WITH_YOUR_D1_ID", "d1-id-owner-pasted")
        )
        deploy_module.materialize()
        self.assertEqual((target / ".buyer.env").read_text(), "BUYER_TEST_PRIVATE_KEY=untouched")
        self.assertIn('"database_id": "d1-id-owner-pasted"', config.read_text())
        self.assertNotIn("REPLACE_WITH_YOUR_D1_ID", config.read_text())

    def test_node_deploy_drives_wrangler_and_records_the_url(self) -> None:
        def fake_run(args, **kwargs):
            stdout = ""
            if args[0].endswith("wrangler") and args[1] == "deploy":
                stdout = "Deployed lore-x402-canary\n  https://lore.example.workers.dev\n"
            if args[0].endswith("wrangler") and args[1:3] == ("d1", "create"):
                stdout = '"database_id": "11111111-2222-3333-4444-555555555555"\n'
            return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr="")

        with (
            patch("lore.deploy.subprocess.run", side_effect=fake_run) as run,
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli.push") as push,
            redirect_stdout(StringIO()),
        ):
            self.assertEqual(deploy_module.deploy("0x" + "1" * 40), 0)
        commands = [call.args[0] for call in run.call_args_list]
        self.assertIn(("npm", "install", "--no-fund", "--no-audit"), commands)
        wrangler_calls = [
            c[1:] for c in commands if c[0].endswith("node_modules/.bin/wrangler")
        ]
        # The placeholder is resolved before wrangler validates the D1 binding
        # at deploy, and the created id is written into the staged config.
        self.assertLess(
            wrangler_calls.index(("d1", "create", "lore-publications")),
            wrangler_calls.index(("deploy",)),
        )
        config = Path(os.environ["LORE_HOME"]) / "node/wrangler.jsonc"
        self.assertIn(
            '"database_id": "11111111-2222-3333-4444-555555555555"', config.read_text()
        )
        self.assertIn(("secret", "put", "LORE_WALLET"), wrangler_calls)
        # The first push creates the publications table before the smoke check.
        push.assert_called_once()
        self.assertIn(
            ("npm", "run", "smoke", "--", "https://lore.example.workers.dev/mcp"), commands
        )
        with Store() as store:
            self.assertEqual(
                store.setting("node_url"), "https://lore.example.workers.dev/mcp"
            )

    def test_node_deploy_records_the_url_before_the_secret_put(self) -> None:
        # If `secret put` fails, the node is already live — the URL must have
        # been recorded so `lore status` can recover it.
        def fake_run(args, **kwargs):
            if args[1:] == ("secret", "put", "LORE_WALLET"):
                return subprocess.CompletedProcess(args, 1, stdout="", stderr="vault down")
            stdout = ""
            if args[1:] == ("deploy",):
                stdout = "https://lore.example.workers.dev\n"
            if args[1:] == ("d1", "create", "lore-publications"):
                stdout = 'database_id = "11111111-2222-3333-4444-555555555555"\n'
            return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr="")

        with (
            patch("lore.deploy.subprocess.run", side_effect=fake_run),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli.push"),
            redirect_stdout(StringIO()),
            self.assertRaisesRegex(OSError, "LORE_WALLET"),
        ):
            deploy_module.deploy("0x" + "1" * 40)
        with Store() as store:
            self.assertEqual(
                store.setting("node_url"), "https://lore.example.workers.dev/mcp"
            )

    def test_node_deploy_on_custom_route_keeps_the_recorded_url(self) -> None:
        # A successful deploy that prints no workers.dev address means a custom
        # route, not a dead node — the previously recorded URL must survive.
        with Store() as store:
            store.set_setting("node_url", "https://lore.example.workers.dev/mcp")

        def fake_run(args, **kwargs):
            stdout = ""
            if args[1:] == ("d1", "create", "lore-publications"):
                stdout = '"database_id": "11111111-2222-3333-4444-555555555555"\n'
            return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr="")

        with (
            patch("lore.deploy.subprocess.run", side_effect=fake_run),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli.push"),
            redirect_stdout(StringIO()),
        ):
            self.assertEqual(deploy_module.deploy("0x" + "1" * 40), 0)
        with Store() as store:
            self.assertEqual(
                store.setting("node_url"), "https://lore.example.workers.dev/mcp"
            )

    def test_node_deploy_finds_an_already_created_d1_database(self) -> None:
        # `d1 create` on a rerun says "already exists"; the id is then
        # recovered from `d1 list` instead of failing the deploy.
        def fake_run(args, **kwargs):
            if args[1:] == ("d1", "create", "lore-publications"):
                return subprocess.CompletedProcess(
                    args, 1, stdout="", stderr="a database with that name already exists"
                )
            stdout = ""
            if args[1:] == ("d1", "list", "--json"):
                stdout = json.dumps(
                    [{"uuid": "22222222-3333-4444-5555-666666666666", "name": "lore-publications"}]
                )
            if args[1:] == ("deploy",):
                stdout = "https://lore.example.workers.dev\n"
            return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr="")

        with (
            patch("lore.deploy.subprocess.run", side_effect=fake_run),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli.push"),
            redirect_stdout(StringIO()),
        ):
            self.assertEqual(deploy_module.deploy("0x" + "1" * 40), 0)
        config = Path(os.environ["LORE_HOME"]) / "node/wrangler.jsonc"
        self.assertIn(
            '"database_id": "22222222-3333-4444-5555-666666666666"', config.read_text()
        )

    def test_node_deploy_fails_closed_on_bad_input(self) -> None:
        with self.assertRaisesRegex(ValueError, "public EVM address"):
            deploy_module.deploy("0xnothex")
        with (
            patch("lore.deploy.shutil.which", return_value=None),
            self.assertRaisesRegex(OSError, "nodejs.org"),
        ):
            deploy_module.deploy("0x" + "1" * 40)

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
        for name, arguments in (
            ("get", {}),  # id is required
            ("get", {"id": 1}),  # ids are opaque strings, never integers
            ("get", {"id": True}),
            ("get", {"id": "  "}),
            ("discover", {"query": "no server-side search exists"}),
            ("answer", {"query": "retired tool"}),
        ):
            with self.assertRaises((TypeError, ValueError)):
                call_tool(name, arguments)

    def test_damaged_public_id_is_rejected_before_lookup(self) -> None:
        public_id = new_public_id()
        self.assertTrue(valid_public_id(public_id))
        damaged = ("0" if public_id[0] != "0" else "1") + public_id[1:]
        self.assertFalse(valid_public_id(damaged))
        with self.assertRaisesRegex(ValueError, "run discover again"):
            call_tool("get", {"id": damaged})

    def test_remote_mcp_requires_authentication(self) -> None:
        with self.assertRaisesRegex(ValueError, "requires --token"):
            http("0.0.0.0", 0)

    def _seed_memory(self, title: str, status: str) -> int:
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
            memory_id = store.search(title)[0].id
            store.set_status(memory_id, status)
            return memory_id

    def _call(self, name: str, arguments: dict[str, object]) -> str:
        response = dispatch(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            }
        )
        return response["result"]["content"][0]["text"]  # type: ignore[index]

    def _discover(self) -> dict[str, object]:
        return json.loads(self._call("discover", {}))

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

    def test_manifest_renders_only_advertised_publications(self) -> None:
        # The manifest is the whole free surface: teasers grouped by topic,
        # never content or title. A publication without a teaser was never
        # given an advertisement, so it must not render at all.
        memory_id = self._seed_memory("Course evidence", "private")
        with Store() as store:
            advertised = store.add_publication(
                title="Lab conversion results",
                content="Replacing two lecture hours with a graded lab raised median scores.",
                topic="course design",
                teaser="What happened to median scores when lectures became a graded lab",
                provenance=[memory_id],
            )
            store.add_publication(
                title="Unadvertised claim", content="secret-ish detail",
                topic="course design", provenance=[memory_id],
            )
            manifest = store.manifest()
            advertised_public = next(
                p for p in store.list_publications() if p.id == advertised
            )
        self.assertEqual(manifest["publication_count"], 1)
        entries = manifest["topics"]["course design"]
        self.assertEqual(
            [set(entry) for entry in entries], [{"id", "teaser", "kind", "updated_at"}]
        )
        # Buyer-facing ids are the opaque tokens, never the sequential row ids:
        # a sequence would advertise every withdrawal as a visible gap.
        self.assertEqual(entries[0]["id"], advertised_public.public_id)
        self.assertNotEqual(entries[0]["id"], advertised)
        # Freshness is day-precision only; full timestamps reveal the owner's
        # approval-session structure.
        self.assertEqual(len(entries[0]["updated_at"]), 10)
        text = json.dumps(manifest)
        self.assertNotIn("Lab conversion results", text)  # titles are paid
        self.assertNotIn("raised median scores", text)  # content is paid
        self.assertNotIn("Unadvertised", text)

    def test_manifest_is_byte_identical_under_private_row_changes(self) -> None:
        # MCP-001 AC 2: everything a buyer observes derives exclusively from
        # owner-approved fields of active publications. The invariant holds
        # today because manifest() touches one table — this pins it, so a
        # future join against memories (a count, a freshness signal) fails
        # loudly instead of leaking the private library's shape.
        memory_id = self._seed_memory("Stable evidence", "private")
        with Store() as store:
            store.add_publication(
                title="Stable claim", content="the paid content", topic="stability",
                teaser="What stayed true across changes", provenance=[memory_id],
            )
            before = json.dumps(store.manifest(), sort_keys=True)

            # Add a private row.
            store.put(
                source="test", origin="native", source_path="new.md",
                source_key="new.md", fingerprint="v1",
                title="Newly private", content="never disclosed",
            )
            # Edit one (changed fingerprint re-puts and flags publications).
            store.put(
                source="test", origin="native", source_path="new.md",
                source_key="new.md", fingerprint="v2",
                title="Newly private", content="edited, still never disclosed",
            )
            # Discard one.
            store.set_status(memory_id, "discarded")

            after = json.dumps(store.manifest(), sort_keys=True)
        self.assertEqual(before, after)

    def _drafted_candidates(self) -> str:
        with Store() as store:
            store.put(
                source="test", origin="native", source_path="demo.md",
                source_key="demo.md", fingerprint="pub-flow",
                title="Demo evidence",
                content="Live demos: 7/10 trials versus 0/12 for cold decks.",
            )
            memory_id = store.search("Demo evidence")[0].id
        path = Path(os.environ["LORE_HOME"]) / "publish-candidates.json"
        path.write_text(json.dumps([
            {
                "title": "Live demos beat cold decks",
                "teaser": "What outperformed cold decks in one launch, with counts",
                "content": "3 live demos produced 7/10 follow-ups; cold decks 0/12.",
                "kind": "claim",
                "topic": "go-to-market lessons",
                "provenance": [memory_id],
            },
            {
                "title": "Second claim",
                "teaser": "A second lesson from the same launch",
                "content": "Another bounded claim.",
                "topic": "go-to-market lessons",
                "provenance": [memory_id],
            },
        ]))
        return str(path)

    def test_publication_apply_requires_an_owner_at_a_terminal(self) -> None:
        path = self._drafted_candidates()
        args = parser().parse_args(["publication", "review", path])
        self.assertEqual(args.publication_command, "review")
        with patch("lore.cli._interactive", return_value=False):
            with self.assertRaisesRegex(ValueError, "interactive terminal"):
                cli_publication_apply(path)

    def test_publication_apply_approve_edit_reject(self) -> None:
        path = self._drafted_candidates()
        answers = iter(["e", "Sharper title", "", "", "a", "r"])
        with (
            patch("lore.cli._interactive", return_value=True),
            patch("lore.cli.ask", side_effect=lambda *a, **k: next(answers)),
            redirect_stdout(StringIO()),
        ):
            self.assertEqual(cli_publication_apply(path), 0)
        with Store() as store:
            published = store.list_publications()
            self.assertEqual(len(published), 1)
            self.assertEqual(published[0].title, "Sharper title")
            self.assertEqual(len(published[0].provenance), 1)
            # The owner-approved grouping label survives approval intact.
            self.assertEqual(published[0].topic, "go-to-market lessons")
            # The unedited teaser survives too — it is the free surface.
            self.assertEqual(
                published[0].teaser,
                "What outperformed cold decks in one launch, with counts",
            )

    def test_push_sql_replaces_everything_and_escapes_quotes(self) -> None:
        from lore.cli import _push_sql
        from lore.store import Publication, PublicationKind

        publication = Publication(
            id=7, public_id="ab12cd34ef56ab78", title="It's a title",
            content="O'Brien said so", kind=PublicationKind.CLAIM,
            topic="war stories", teaser="What O'Brien learned", provenance=[],
            active=1, created_at="", updated_at="2026-08-02T00:00:00+00:00",
        )
        script = _push_sql([publication])
        # Full replace including schema: a revoked publication is gone because
        # only this set survives, and an old node converges on the new columns.
        self.assertIn("DROP TABLE IF EXISTS publications;", script)
        self.assertIn("'It''s a title'", script)
        self.assertIn("'O''Brien said so'", script)
        self.assertIn("'war stories'", script)
        self.assertIn("'What O''Brien learned'", script)
        # The edge is keyed on the opaque public id; the local sequential id
        # must not appear in the script at all.
        self.assertIn("'ab12cd34ef56ab78'", script)
        self.assertNotIn("(7,", script)
        # Executable by SQLite exactly as wrangler d1 will run it — including
        # against a node created before the current columns existed.
        with sqlite3.connect(":memory:") as db:
            db.execute(
                "CREATE TABLE publications (id INTEGER PRIMARY KEY, title TEXT NOT NULL, "
                "content TEXT NOT NULL, kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '')"
            )
            db.executescript(script)
            self.assertEqual(
                db.execute(
                    "SELECT public_id, title, topic, teaser FROM publications"
                ).fetchone(),
                ("ab12cd34ef56ab78", "It's a title", "war stories", "What O'Brien learned"),
            )

    def test_topic_and_teaser_columns_added_to_databases_created_before_them(self) -> None:
        db_path = Path(os.environ["LORE_HOME"]) / "lore.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(db_path) as db:
            db.execute(
                """CREATE TABLE publications (
                    id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'claim', provenance TEXT NOT NULL DEFAULT '[]',
                    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL, source_changed_at TEXT
                )"""
            )
            db.execute(
                "INSERT INTO publications(title,content,kind,provenance,active,"
                "created_at,updated_at) VALUES ('legacy','lc','claim','[]',1,'t0','t0')"
            )
        with Store() as store:
            store.put(
                source="test", origin="native", source_path="migration.md",
                source_key="migration.md", fingerprint="migration",
                title="Migration evidence", content="Evidence for the publication.",
            )
            memory_id = store.search("Migration evidence")[0].id
            store.add_publication(
                title="t", content="c", topic="migrated", teaser="an advertisement",
                provenance=[memory_id],
            )
            by_title = {p.title: p for p in store.list_publications()}
            self.assertEqual(by_title["t"].topic, "migrated")
            self.assertEqual(by_title["t"].teaser, "an advertisement")
            # public_id is minted for new rows and backfilled for legacy ones,
            # and the two never collide.
            self.assertEqual(len(by_title["t"].public_id), 24)
            self.assertEqual(len(by_title["legacy"].public_id), 24)
            self.assertNotEqual(by_title["t"].public_id, by_title["legacy"].public_id)

    def test_publication_apply_rejects_bad_candidates(self) -> None:
        base = Path(os.environ["LORE_HOME"])
        base.mkdir(parents=True, exist_ok=True)
        memory_id = self._seed_memory("Candidate evidence", "private")
        valid = {
            "title": "x", "content": "y", "topic": "topic", "teaser": "an ad",
            "provenance": [memory_id],
        }
        cases = [
            ([{**valid, "provenance": [999]}], "unknown memories"),
            ([{**valid, "title": ""}], "non-empty title"),
            ([{**valid, "topic": ""}], "non-empty title"),
            ([{**valid, "teaser": ""}], "non-empty teaser"),
            ([{k: v for k, v in valid.items() if k != "teaser"}], "non-empty teaser"),
            ([{**valid, "provenance": []}], "non-empty list"),
            ([{**valid, "kind": "secret"}], "PublicationKind"),
            ([{**valid, "extra": 1}], "unexpected candidate field"),
            ([], "non-empty JSON array"),
        ]
        for payload, message in cases:
            candidates = base / "bad.json"
            candidates.write_text(json.dumps(payload))
            with patch("lore.cli._interactive", return_value=True), \
                    redirect_stdout(StringIO()):
                with self.assertRaisesRegex(ValueError, message):
                    cli_publication_apply(str(candidates))

    def test_publication_list_revoke_reapprove_commands(self) -> None:
        memory_id = self._seed_memory("Command evidence", "private")
        with Store() as store:
            pid = store.add_publication(
                title="Claim", content="bounded", topic="commands", provenance=[memory_id]
            )
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(cli_publication_list(), 0)
            self.assertEqual(cli_publication_revoke(pid), 0)
        self.assertIn("Claim", output.getvalue())
        with Store() as store:
            self.assertEqual(store.list_publications(active_only=True), [])
            store.db.execute(
                "UPDATE publications SET active=1, source_changed_at='now' WHERE id=?", (pid,)
            )
            store.db.commit()
        with redirect_stdout(StringIO()):
            self.assertEqual(cli_publication_reapprove(pid), 0)
        with Store() as store:
            self.assertIsNone(store.list_publications()[0].source_changed_at)

    def test_publications_add_list_revoke(self) -> None:
        first = self._seed_memory("Pricing evidence", "private")
        second = self._seed_memory("Document evidence", "private")
        with Store() as store:
            pid = store.add_publication(
                title="Pricing claim",
                content="a bounded claim about pricing agent APIs",
                topic="pricing",
                provenance=[first, second],
            )
            active = store.list_publications(active_only=True)
            self.assertEqual(len(active), 1)
            self.assertIs(active[0].kind, PublicationKind.CLAIM)
            self.assertEqual(active[0].provenance, [first, second])
            doc_id = store.add_publication(
                title="Doc", content="verbatim", kind=PublicationKind.CONTENT,
                topic="documents", provenance=[second],
            )
            self.assertGreater(doc_id, 0)
            with self.assertRaisesRegex(ValueError, "not a valid PublicationKind"):
                store.add_publication(title="Bad", content="x", kind="secret")
            revoked_public_id = next(
                p.public_id for p in store.list_publications() if p.id == pid
            )
            store.revoke_publication(pid)
            self.assertEqual([p.id for p in store.list_publications(active_only=True)], [doc_id])
            self.assertEqual(len(store.list_publications()), 2)  # revoked still listed
            with self.assertRaisesRegex(ValueError, "not found"):
                store.get_publication(revoked_public_id)  # revoked is not fetchable

    def test_publication_store_requires_topic_and_real_provenance(self) -> None:
        memory_id = self._seed_memory("Boundary evidence", "private")
        with Store() as store:
            for topic, provenance, message in (
                ("", [memory_id], "topic cannot be empty"),
                ("boundary", [], "non-empty list"),
                ("boundary", [memory_id + 999], "unknown memories"),
            ):
                with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                    store.add_publication(
                        title="Bounded claim", content="Supported content",
                        topic=topic, provenance=provenance,
                    )

    def test_publication_kind_accepts_a_plain_string(self) -> None:
        # Callers (including `lore publication review`) may pass raw strings;
        # the enum normalizes them and rejects anything else.
        memory_id = self._seed_memory("String kind evidence", "private")
        with Store() as store:
            store.add_publication(
                title="Str", content="x", kind="content", topic="strings",
                provenance=[memory_id],
            )
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

    def test_buyer_payloads_never_disclose_private_memory_ids(self) -> None:
        # Provenance is owner-visible; buyers must not learn the ids or the
        # number of private rows behind a publication — from either tool.
        memory_ids = [
            self._seed_memory(f"Private source {index}", "private") for index in range(3)
        ]
        with Store() as store:
            store.add_publication(
                title="Deployment guide",
                content="deployment guidance",
                topic="deployment",
                teaser="How this node deploys things",
                provenance=memory_ids,
            )
        # Assert on the payload shapes, not on substrings: an ISO timestamp
        # happens to contain two-digit numbers and would mask a real leak.
        entry = self._discover()["topics"]["deployment"][0]
        self.assertEqual(set(entry), {"id", "teaser", "kind", "updated_at"})
        publication = json.loads(self._call("get", {"id": entry["id"]}))["publication"]
        self.assertEqual(
            set(publication), {"id", "title", "content", "topic", "kind", "updated_at"}
        )
        self.assertEqual(publication["title"], "Deployment guide")
        self.assertEqual(publication["id"], entry["id"])  # the opaque token round-trips

    def test_mcp_reads_only_active_publications_never_memories(self) -> None:
        # Memories of every disclosure status must be unreachable from MCP.
        discarded_id = self._seed_memory("Discarded memory", "discarded")
        private_id = self._seed_memory("Private memory", "private")
        with Store() as store:
            active_id = store.add_publication(
                title="Deployment guide", content="deployment guidance",
                topic="deployment", teaser="How this node deploys",
                provenance=[private_id],
            )
            revoked_id = store.add_publication(
                title="Old deployment note", content="stale deployment text",
                topic="deployment", teaser="An older deployment lesson",
                provenance=[discarded_id],
            )
            store.revoke_publication(revoked_id)
            by_id = {p.id: p.public_id for p in store.list_publications()}
        manifest_text = self._call("discover", {})
        self.assertIn("How this node deploys", manifest_text)
        self.assertNotIn("Discarded memory", manifest_text)  # no memory is reachable
        self.assertNotIn("Private memory", manifest_text)  # private memory unreachable
        self.assertNotIn("An older deployment lesson", manifest_text)  # revoked excluded
        content_text = self._call("get", {"id": by_id[active_id]})
        self.assertIn("Deployment guide", content_text)
        self.assertNotIn("Private memory", content_text)
        with self.assertRaisesRegex(ValueError, "not found"):
            call_tool("get", {"id": by_id[revoked_id]})  # revoked content unreachable
        # Revoking the last active publication removes it from MCP immediately:
        # the manifest is a live view, never a stale artifact.
        with Store() as store:
            store.revoke_publication(active_id)
        self.assertEqual(self._discover()["publication_count"], 0)
        with self.assertRaisesRegex(ValueError, "not found"):
            call_tool("get", {"id": by_id[active_id]})

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
