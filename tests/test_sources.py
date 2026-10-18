"""Tests for `lore.sources` — what Lore is allowed to read off the owner's disk.

The import boundary is a promise: agent-written *memory* files only. Session
transcripts, intermediate scratch files, and Lore's own synthesis index stay out.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stderr
from datetime import datetime
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from helpers import LoreTestCase

from lore import capture as capture_module
from lore import sources as sources_module
from lore.snapshot import build
from lore.sources import Connector, Obsidian, Registry, Source, State, available_sources
from lore.store import Status, Store


class SourceRegistryTest(LoreTestCase):
    def test_the_three_sources_point_at_the_configured_homes(self) -> None:
        by_name = {source.name: source for source in available_sources()}
        self.assertEqual(set(by_name), {"codex", "claude", "automation"})
        self.assertEqual(Path(by_name["codex"].locator), self.codex_home / "memories")
        self.assertEqual(Path(by_name["claude"].locator), self.claude_home / "projects")
        self.assertEqual(
            Path(by_name["automation"].locator), self.lore_home / "memories"
        )
        self.assertEqual(by_name["automation"].origin, "automation")
        self.assertEqual(by_name["claude"].origin, "native")

    def test_an_agents_history_switches_on_and_off_and_keeps_what_it_brought(
        self,
    ) -> None:
        (self.claude_home / "projects").mkdir(parents=True, exist_ok=True)
        with Store() as store:
            on = Registry(store).switch("claude", True)
            self.assertEqual((on["name"], on["enabled"]), ("claude", True))
            self.assertEqual(store.setting("sources", []), ["claude"])
            off = Registry(store).switch("claude", False)
            self.assertFalse(off["enabled"])
            self.assertEqual(store.setting("sources", []), [])
            with self.assertRaisesRegex(sources_module.SourceError, "unknown source"):
                Registry(store).switch("obsidian-1", True)

    def test_a_missing_root_reads_nothing_instead_of_raising(self) -> None:
        source = Source("ghost", "Ghost", str(self.lore_home / "nowhere"), "*.md")
        reader = source.reader()
        self.assertEqual(list(reader.items()), [])
        self.assertIs(reader.probe(), State.UNREACHABLE)

    def test_invalid_saved_records_fail_before_they_can_import(self) -> None:
        with Store() as store:
            for records in (
                [{"name": "missing-fields"}],
                [{"name": "bad", "label": "Bad", "locator": "/tmp", "kind": "unknown"}],
            ):
                store.set_setting("owner_sources", records)
                with self.assertRaises(sources_module.SourceError):
                    sources_module.Registry(store)
            store.set_setting("owner_sources", [])
            store.set_setting(
                "source_reads", {"codex": {"state": "invented", "at": "today"}}
            )
            with self.assertRaises(sources_module.SourceError):
                sources_module.Registry(store)
            self.assertEqual(store.counts()["private"], 0)
        with self.assertRaises(sources_module.SourceError):
            Source.owner("/tmp", kind="unknown")


class ScanTest(LoreTestCase):
    def test_import_titles_projects_and_search(self) -> None:
        path = self.claude_home / "projects/demo/memory/testing.md"
        path.parent.mkdir(parents=True)
        path.write_text("# Testing preference\n\nUse focused integration tests.")

        with Store() as store:
            report = Registry(store).scan({"claude"})
            self.assertEqual(report["claude"]["added"], 1)
            found = store.search("integration tests")
            self.assertEqual(found[0].title, "Testing preference")
            self.assertEqual(found[0].project, "demo")
            self.assertIs(found[0].status, Status.PRIVATE)

    def test_a_file_without_a_heading_is_titled_from_its_name(self) -> None:
        path = self.codex_home / "memories/MEMORY.md"
        path.parent.mkdir(parents=True)
        path.write_text("no heading here, just a body")
        with Store() as store:
            Registry(store).scan({"codex"})
            self.assertEqual(store.search("body")[0].title, "Memory")

    def test_codex_memories_are_flat_and_carry_no_project(self) -> None:
        # Codex's pattern is the literal `MEMORY.md`, so a nested file is not an
        # import at all — the project it would have been given never applies.
        root = self.codex_home / "memories"
        (root / "atlas").mkdir(parents=True)
        (root / "MEMORY.md").write_text("# Top\n\ntop level lesson")
        (root / "atlas/MEMORY.md").write_text("# Nested\n\nnested lesson")
        with Store() as store:
            report = Registry(store).scan({"codex"})
            self.assertEqual(report["codex"]["found"], 1)
            self.assertEqual(store.search("top level")[0].project, "")
            self.assertEqual(store.search("nested"), [])

    def test_claude_codes_memory_index_is_not_a_memory(self) -> None:
        root = self.claude_home / "projects/demo/memory"
        root.mkdir(parents=True)
        (root / "MEMORY.md").write_text("- [Testing](testing.md) — focused tests")
        (root / "testing.md").write_text("# Testing\n\nUse focused integration tests.")
        with Store() as store:
            self.assertEqual(Registry(store).scan({"claude"})["claude"]["added"], 1)

    def test_synthesis_memories_are_labelled_personal(self) -> None:
        root = self.lore_home / "memories"
        root.mkdir(parents=True)
        (root / "topic.md").write_text("# Topic\n\na synthesized lesson")
        with Store() as store:
            Registry(store).scan({"automation"})
            self.assertEqual(store.search("synthesized")[0].project, "personal")

    def test_scanning_without_names_covers_every_source(self) -> None:
        (self.codex_home / "memories").mkdir(parents=True)
        (self.codex_home / "memories/MEMORY.md").write_text("# C\n\ncodex lesson")
        with Store() as store:
            report = Registry(store).scan()
        self.assertEqual(set(report), {"codex", "claude", "automation"})
        self.assertEqual(report["codex"]["added"], 1)
        self.assertEqual(report["claude"]["found"], 0)

    def test_codex_import_ignores_intermediate_memory_files(self) -> None:
        root = self.codex_home / "memories"
        root.mkdir(parents=True)
        (root / "MEMORY.md").write_text("# Durable\n\nKeep this.")
        (root / "raw_memories.md").write_text("# Raw\n\nDuplicate evidence.")
        summaries = root / "rollout_summaries"
        summaries.mkdir()
        (summaries / "task.md").write_text("# Task\n\nDuplicate summary.")
        synthesis = self.lore_home / "memories"
        synthesis.mkdir(parents=True)
        (synthesis / "linked.md").symlink_to(root / "MEMORY.md")

        with Store() as store:
            report = Registry(store).scan({"codex", "automation"})
            self.assertEqual(report["codex"]["found"], 1)
            # A symlink into the codex tree would import the same memory twice.
            self.assertEqual(report["automation"]["found"], 0)
            self.assertEqual(store.search("Keep this")[0].title, "Durable")
            self.assertEqual(store.search("Duplicate"), [])

    def test_the_synthesis_index_is_not_imported_as_a_memory(self) -> None:
        root = self.lore_home / "memories"
        (root / "projects").mkdir(parents=True)
        (root / "projects/agent-systems.md").write_text(
            "# Agent systems\n\nA durable lesson."
        )
        (root / "INDEX.md").write_text("# Lore memory index\n\nRead agent-systems.md.")
        with Store() as store:
            report = Registry(store).scan({"automation"})
            self.assertEqual(report["automation"]["found"], 1)
            self.assertEqual(store.search("memory index"), [])

    def test_a_changed_memory_keeps_the_status_the_owner_gave_it(self) -> None:
        # A re-import must not resurrect a discarded memory; that would rebuild
        # the review queue this retention model exists to remove.
        root = self.lore_home / "memories"
        root.mkdir(parents=True)
        topic = root / "topic.md"
        topic.write_text("# Agent systems\n\nA durable lesson.")
        with Store() as store:
            Registry(store).scan({"automation"})
            store.set_status(store.search("durable")[0].id, "discarded")
        topic.write_text("# Agent systems\n\nA durable lesson changed after rejection.")
        with Store() as store:
            report = Registry(store).scan({"automation"})
            self.assertEqual(report["automation"]["updated"], 1)
            self.assertIs(store.search("after rejection")[0].status, Status.DISCARDED)

    def test_unchanged_files_are_counted_and_not_rewritten(self) -> None:
        root = self.lore_home / "memories"
        root.mkdir(parents=True)
        (root / "topic.md").write_text("# Topic\n\nstable lesson")
        with Store() as store:
            Registry(store).scan({"automation"})
            report = Registry(store).scan({"automation"})
        self.assertEqual(report["automation"]["unchanged"], 1)
        self.assertEqual(report["automation"]["added"], 0)

    def test_a_topic_written_under_work_is_labelled_work_and_the_rest_personal(
        self,
    ) -> None:
        # AUT-005: the library keeps the owner's job apart, and the Memories tab says so.
        root = self.lore_home / "memories"
        (root / "work").mkdir(parents=True)
        (root / "work/launch-review.md").write_text("# Launch review\n\nwork lesson")
        (root / "receipts.md").write_text("# Receipts beat surveys\n\nown lesson")
        with Store() as store:
            Registry(store).scan({"automation"})
            self.assertEqual(store.search("work lesson")[0].project, "work")
            self.assertEqual(store.search("own lesson")[0].project, "personal")

    def test_an_empty_file_is_found_but_never_stored(self) -> None:
        root = self.lore_home / "memories"
        root.mkdir(parents=True)
        (root / "blank.md").write_text("   \n\n  ")
        with Store() as store:
            report = Registry(store).scan({"automation"})
            self.assertEqual(store.search(""), [])
        self.assertEqual(report["automation"]["found"], 1)
        self.assertEqual(report["automation"]["added"], 0)

    def test_an_unreadable_file_is_counted_as_an_error_not_a_crash(self) -> None:
        # One corrupt file in an agent's memory directory must not abort the
        # whole import: the other files are still worth having.
        root = self.lore_home / "memories"
        root.mkdir(parents=True)
        (root / "good.md").write_text("# Good\n\na readable lesson")
        (root / "binary.md").write_bytes(b"\xff\xfe\x00 not utf-8")
        with Store() as store:
            report = Registry(store).scan({"automation"})
            self.assertEqual(store.search("readable")[0].title, "Good")
        self.assertEqual(report["automation"]["errors"], 1)
        self.assertEqual(report["automation"]["added"], 1)


def owned(store: Store) -> list[dict[str, object]]:
    return [
        entry for entry in sources_module.Registry(store).entries() if entry["owned"]
    ]


class OwnerFolderTest(LoreTestCase):
    """A folder the owner connected: their notes, not an agent's memory files."""

    def vault(self, **files: str) -> Path:
        root = Path(self.tmp.name) / "vault"
        root.mkdir(exist_ok=True)
        for name, text in files.items():
            path = root / name.replace("__", "/").replace("_md", ".md")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        return root

    def test_a_folder_is_read_as_private_memories_the_moment_it_is_added(self) -> None:
        root = self.vault(
            dated_md="---\ndate: 2024-03-02\n---\n\n# Dated\n\n"
            + "A lesson long enough to be worth keeping.",
            plain_md="# Plain\n\nAnother lesson long enough to be worth keeping.",
        )
        os.utime(root / "plain.md", (0, datetime(2025, 5, 4).timestamp()))
        with Store() as store:
            entry = sources_module.Registry(store).add(str(root))
            self.assertEqual(entry["label"], "vault")
            self.assertEqual(entry["kind"], "folder")
            self.assertEqual(entry["locator"], str(root.resolve()))
            self.assertIs(entry["owned"], True)
            self.assertIs(entry["enabled"], True)
            self.assertEqual(entry["state"], "connected")
            self.assertEqual(entry["imported"], 2)
            self.assertIsNotNone(entry["last_read_at"])
            self.assertIs(store.search("worth keeping")[0].status, Status.PRIVATE)
        # Frontmatter first, file mtime second.
        self.assertEqual(
            sources_module.preview(str(root))["from"],
            "2024-03-02",
        )
        self.assertEqual(sources_module.preview(str(root))["to"], "2025-05-04")

    def test_the_four_states_that_are_not_connected(self) -> None:
        missing = Path(self.tmp.name) / "gone"
        self.assertEqual(sources_module.preview(str(missing))["state"], "unreachable")
        empty = self.vault()
        self.assertEqual(sources_module.preview(str(empty))["state"], "nothing_found")
        locked = self.vault(note_md="# Note\n\n" + "x" * 60)
        os.chmod(locked, 0o000)
        self.addCleanup(os.chmod, locked, 0o700)
        if os.geteuid() != 0:
            self.assertEqual(
                sources_module.preview(str(locked))["state"], "needs_permission"
            )
        (self.claude_home / "projects").mkdir(parents=True)
        with Store() as store:
            store.set_setting("sources", ["codex"])
            states = {
                entry["name"]: entry["state"]
                for entry in sources_module.Registry(store).entries()
            }
        self.assertEqual(states["claude"], "off")

    def test_an_agent_that_is_not_on_this_mac_is_not_offered(self) -> None:
        with Store() as store:
            names = [e["name"] for e in sources_module.Registry(store).entries()]
            self.assertEqual(names, [])
            (self.codex_home / "memories").mkdir(parents=True)
            names = [e["name"] for e in sources_module.Registry(store).entries()]
            self.assertEqual(names, ["codex"])

    def test_read_failures_keep_preview_unhealthy_even_with_other_good_notes(
        self,
    ) -> None:
        root = self.vault(
            good_md="# Good\n\nA readable note long enough to keep in Lore.",
            locked_md="# Locked\n\nA private note long enough to keep in Lore.",
        )
        original = Path.read_text

        def read_text(path: Path, *args: object, **kwargs: object) -> str:
            if path.name == "locked.md":
                raise PermissionError("denied")
            return original(path, *args, **kwargs)

        with patch.object(Path, "read_text", read_text):
            found = sources_module.preview(str(root))
            self.assertEqual((found["count"], found["state"]), (1, "needs_permission"))

            (root / "good.md").unlink()
            found = sources_module.preview(str(root))
            self.assertEqual((found["count"], found["state"]), (0, "needs_permission"))

        with patch.object(Path, "read_text", side_effect=OSError("offline")):
            self.assertEqual(sources_module.preview(str(root))["state"], "unreachable")

    def test_preview_counts_what_would_be_kept_and_writes_nothing(self) -> None:
        root = self.vault(
            long_md="# Long\n\nA note long enough to count as a real memory.",
            short_md="# Short",
            templates__blank_md="# Template\n\n" + "x" * 60,
        )
        found = sources_module.preview(str(root))
        self.assertEqual(found["count"], 1)
        self.assertEqual(found["skipped"], 1)
        self.assertEqual(found["state"], "connected")
        with Store() as store:
            self.assertEqual(store.counts()["private"], 0)
            self.assertEqual(owned(store), [])

    def test_adding_the_same_folder_twice_returns_the_same_source(self) -> None:
        root = self.vault(note_md="# Note\n\nA note long enough to be a memory here.")
        with Store() as store:
            first = sources_module.Registry(store).add(str(root))
            again = sources_module.Registry(store).add(str(root) + "/", label="Second")
            # The same place read once: the second add brings nothing new in.
            self.assertEqual((first.pop("added"), again.pop("added")), (1, 0))
            self.assertEqual(first, again)
            self.assertEqual(len(owned(store)), 1)
            self.assertEqual(store.counts()["private"], 1)

    def test_since_keeps_undated_and_recent_items_only(self) -> None:
        root = self.vault(
            old_md="---\ndate: 2020-01-01\n---\n\nAn old note, long enough to keep.",
            new_md="---\ncreated: 2026-01-01\n---\n\nA new note, long enough to keep.",
        )
        with Store() as store:
            entry = sources_module.Registry(store).add(str(root), since="2025-01-01")
            self.assertEqual(entry["imported"], 1)
            self.assertEqual(store.search("new note")[0].title, "New")
            self.assertEqual(store.search("old note"), [])

    def test_an_unreadable_day_is_rejected_before_anything_is_stored(self) -> None:
        root = self.vault(note_md="# Note\n\nA note long enough to be a memory here.")
        with Store() as store:
            with self.assertRaises(sources_module.SourceError):
                sources_module.Registry(store).add(str(root), since="last tuesday")
            with self.assertRaises(sources_module.SourceError):
                sources_module.Registry(store).add(str(root / "nowhere"))
            self.assertEqual(owned(store), [])

    def test_remove_keep_leaves_the_memories_behind(self) -> None:
        root = self.vault(note_md="# Note\n\nA note long enough to be a memory here.")
        with Store() as store:
            name = str(sources_module.Registry(store).add(str(root))["name"])
            self.assertEqual(
                sources_module.Registry(store).remove(name, delete=False),
                {"name": name, "removed": True, "memories": {"kept": 1}},
            )
            self.assertEqual(store.counts()["private"], 1)
            self.assertEqual(owned(store), [])

    def test_remove_delete_keeps_only_what_a_publication_cites(self) -> None:
        root = self.vault(
            cited_md="# Cited\n\nA note long enough to be a memory, and published.",
            other_md="# Other\n\nA note long enough to be a memory, unpublished.",
        )
        with Store() as store:
            name = str(sources_module.Registry(store).add(str(root))["name"])
            cited = store.search("published")[0].id
            store.add_publication(
                title="Claim", content="text", topic="ops", provenance=[cited]
            )
            self.assertEqual(
                sources_module.Registry(store).remove(name, delete=True)["memories"],
                {"deleted": 1, "kept": 1},
            )
            self.assertIsNotNone(store.get(cited))
            self.assertEqual(store.search("unpublished"), [])

    def test_a_built_in_source_can_never_be_removed(self) -> None:
        with Store() as store:
            with self.assertRaises(sources_module.SourceError):
                sources_module.Registry(store).remove("codex", delete=False)
            with self.assertRaises(sources_module.SourceError):
                sources_module.Registry(store).remove("folder-deadbeef", delete=False)

    def test_vault_plumbing_is_never_imported(self) -> None:
        root = self.vault(
            keep_md="# Keep\n\nA note long enough to be a memory here.",
            **{
                ".obsidian__workspace_md": "# Workspace\n\n" + "x" * 60,
                ".trash__deleted_md": "# Deleted\n\n" + "x" * 60,
                "templates__daily_md": "# Daily\n\n" + "x" * 60,
            },
        )
        with Store() as store:
            self.assertEqual(
                sources_module.Registry(store).add(str(root))["imported"], 1
            )
            self.assertEqual(store.search("Workspace"), [])

    def test_reading_an_owner_folder_leaves_the_agent_sources_alone(self) -> None:
        (self.codex_home / "memories").mkdir(parents=True)
        (self.codex_home / "memories/MEMORY.md").write_text("# C\n\ncodex lesson")
        root = self.vault(note_md="# Note\n\nA note long enough to be a memory here.")
        with Store() as store:
            store.set_setting("sources", ["codex"])
            name = str(sources_module.Registry(store).add(str(root))["name"])
            reads = sources_module.Registry(store).read()
            # Claude Code is not in the `sources` setting, so a bare read
            # leaves it alone exactly as `lore sync` does.
            self.assertEqual([item["name"] for item in reads], ["codex", name])
            self.assertEqual(
                [item for item in reads if item["name"] == "codex"],
                [
                    {
                        "name": "codex",
                        "label": "Codex",
                        "connector": None,
                        "app": None,
                        "added": 1,
                        "updated": 0,
                        "unchanged": 0,
                        "removed": 0,
                        "errors": 0,
                        "state": "connected",
                    }
                ],
            )
            ordered = sources_module.Registry(store).read([name, "codex"])
            self.assertEqual([item["name"] for item in ordered], [name, "codex"])
            # A short codex memory is still a memory: the sentence floor is for
            # folders the owner points at, not for agent-written files.
            self.assertEqual(store.search("codex lesson")[0].title, "C")
            with self.assertRaises(sources_module.SourceError):
                sources_module.Registry(store).read(["nope"])


class ConnectorTest(LoreTestCase):
    """An app the owner names, found and read without them learning what a source is."""

    def setUp(self) -> None:
        super().setUp()
        self.obsidian_home = Path(self.tmp.name) / "obsidian"
        os.environ["OBSIDIAN_HOME"] = str(self.obsidian_home)
        self.addCleanup(os.environ.pop, "OBSIDIAN_HOME", None)

    def registry(self, text: str) -> None:
        self.obsidian_home.mkdir(exist_ok=True)
        (self.obsidian_home / "obsidian.json").write_text(text)

    def test_obsidian_offers_every_vault_it_knows_the_open_one_first(self) -> None:
        self.registry(
            json.dumps(
                {
                    "vaults": {
                        "a1": {"path": "/notes/Work", "ts": 1},
                        "b2": {"path": "/notes/Personal", "ts": 2, "open": True},
                    }
                }
            )
        )
        choices = Connector.named("obsidian").choices()
        self.assertEqual([choice.label for choice in choices], ["Personal", "Work"])
        self.assertEqual(choices[0].locator, "/notes/Personal")
        self.assertIs(choices[0].open, True)
        self.assertIs(choices[1].open, False)

    def test_a_vault_is_offered_under_the_path_its_connected_source_keeps(self) -> None:
        # APP-215: the first-run chat leaves out vaults Lore already reads by comparing paths, so a vault Obsidian
        # names by another spelling (a link, /var for /private/var) must come back as the one a source records.
        vault = Path(self.tmp.name) / "Real Vault"
        vault.mkdir()
        linked = Path(self.tmp.name) / "Linked Vault"
        linked.symlink_to(vault)
        self.registry(json.dumps({"vaults": {"a1": {"path": str(linked), "ts": 1}}}))
        (choice,) = Connector.named("obsidian").choices()
        kept = Source.owner(str(linked), kind="folder", connector="obsidian")
        self.assertEqual(choice.locator, kept.locator)
        self.assertEqual(choice.label, "Linked Vault")

    def test_a_vault_whose_path_loops_is_offered_as_named_and_hides_no_other(
        self,
    ) -> None:
        # APP-215: one bad entry in Obsidian's list must not cost the owner every healthy vault.
        healthy = Path(self.tmp.name) / "Healthy"
        healthy.mkdir()
        looping = Path(self.tmp.name) / "Looping"
        looping.symlink_to(looping)
        self.registry(
            json.dumps(
                {
                    "vaults": {
                        "a1": {"path": str(looping), "ts": 1},
                        "b2": {"path": str(healthy), "ts": 2},
                    }
                }
            )
        )
        choices = Connector.named("obsidian").choices()
        self.assertEqual([choice.label for choice in choices], ["Healthy", "Looping"])
        self.assertEqual(choices[0].locator, str(healthy.resolve()))
        self.assertEqual(choices[1].locator, str(looping))

    def test_no_obsidian_on_this_mac_means_no_choices_not_an_error(self) -> None:
        self.assertEqual(Obsidian().choices(), [])
        self.registry("{not json")
        self.assertEqual(Obsidian().choices(), [])
        self.registry(json.dumps({"vaults": {"a1": {"ts": 1}}}))
        self.assertEqual(Obsidian().choices(), [])

    def test_a_connected_vault_keeps_the_app_it_came_from(self) -> None:
        (self.codex_home / "memories").mkdir(parents=True)
        root = Path(self.tmp.name) / "Personal"
        root.mkdir()
        (root / "note.md").write_text(
            "# Note\n\nA lesson long enough to be worth keeping."
        )
        with Store() as store:
            entry = Registry(store).add(str(root), connector="obsidian")
            self.assertEqual(entry["connector"], "obsidian")
            self.assertEqual(entry["kind"], "folder")
            self.assertEqual(entry["label"], "Personal")
            self.assertEqual(str(entry["name"])[:9], "obsidian-")
            self.assertEqual(entry["imported"], 1)
            saved = next(
                e for e in Registry(store).entries() if e["name"] == entry["name"]
            )
            self.assertEqual(saved["connector"], "obsidian")
            self.assertIsNone(
                next(e for e in Registry(store).entries() if e["name"] == "codex")[
                    "connector"
                ]
            )

    def vault(self, name: str) -> Path:
        root = Path(self.tmp.name) / name
        root.mkdir()
        (root / "note.md").write_text(
            f"# {name}\n\nA lesson in {name} long enough to be worth keeping."
        )
        return root

    def test_a_connect_and_a_read_say_how_much_came_in_and_from_which_app(
        self,
    ) -> None:
        # AUT-005: the desktop reads new items through only when something came in.
        root = self.vault("Personal")
        with Store() as store:
            registry = Registry(store)
            entry = registry.connect("obsidian", str(root))
            self.assertEqual(entry["added"], 1)
            self.assertEqual(registry.connect("obsidian", str(root))["added"], 0)
            (root / "more.md").write_text(
                "# More\n\nAnother lesson long enough to be worth keeping."
            )
            [read] = registry.read([str(entry["name"])])
            self.assertEqual(
                (read["added"], read["connector"], read["label"]),
                (1, "obsidian", "Personal"),
            )
            [again] = registry.read([str(entry["name"])])
            self.assertEqual(again["added"], 0)

    def test_changing_the_vault_reads_the_new_one_before_retiring_the_old(
        self,
    ) -> None:
        first, second = self.vault("First"), self.vault("Second")
        with Store() as store:
            registry = Registry(store)
            old = registry.connect("obsidian", str(first))
            with self.assertRaises(sources_module.SourceError):
                registry.connect(
                    "obsidian", str(first / "gone"), replacing=str(old["name"])
                )
            self.assertEqual([s.name for s in registry.owned], [old["name"]])
            new = registry.connect("obsidian", str(second), replacing=str(old["name"]))
            self.assertEqual([s.name for s in registry.owned], [new["name"]])
            self.assertEqual(new["label"], "Second")
            self.assertEqual(store.counts()["private"], 2)
            with self.assertRaises(sources_module.SourceError):
                registry.connect("obsidian", str(first), replacing="codex")

    def test_the_catalog_says_what_each_app_needs(self) -> None:
        apps = {app.id: app for app in Connector.catalog()}
        self.assertEqual(
            list(apps),
            [
                "obsidian",
                "chatgpt",
                "claude",
                "substack",
                "medium",
                "bluesky",
                "blog",
                "letterboxd",
                "goodreads",
                "granola",
                "notion",
                "readwise",
                "agent",
            ],
        )
        self.assertEqual(
            (apps["obsidian"].kind, apps["obsidian"].refresh), ("folder", True)
        )
        self.assertEqual(
            (apps["substack"].kind, apps["substack"].refresh), ("feed", True)
        )
        self.assertEqual(
            (apps["chatgpt"].kind, apps["chatgpt"].refresh), ("export", False)
        )
        self.assertTrue(apps["substack"].placeholder.startswith("https://"))

    def test_an_unknown_app_or_the_wrong_kind_for_it_is_refused(self) -> None:
        with self.assertRaises(sources_module.SourceError):
            Source.owner("/notes", connector="evernote")
        with self.assertRaises(sources_module.SourceError):
            Source.owner("https://a.example", kind="feed", connector="obsidian")


class ProvenanceTest(LoreTestCase):
    """APP-213: every memory says who it came from, and never guesses."""

    def put(self, source: str, path: str, project: str = "") -> None:
        with Store() as store:
            store.put(
                source=source,
                origin="automation" if source == "automation" else "native",
                source_path=path,
                source_key=f"{source}:{path}",
                fingerprint=path,
                title=path,
                content="a lesson",
                project=project,
            )

    def sources(self) -> dict[str, list[dict[str, object]]]:
        with Store() as store:
            rows = Registry(store).provenance(store.memory_inventory())
        return {
            str(row["title"]): [
                {k: v for k, v in s.items() if k != "at"}
                for s in row["sources"]  # type: ignore[attr-defined]
            ]
            for row in rows
        }

    def test_a_connected_app_is_on_record_for_what_it_brought_in(self) -> None:
        vault = Path(self.tmp.name) / "Personal"
        vault.mkdir()
        (vault / "note.md").write_text("# Note\n\nA lesson long enough to keep here.")
        with Store() as store:
            name = Registry(store).connect("obsidian", str(vault))["name"]
            Registry(store).remove(str(name), delete=False)
        self.assertEqual(
            self.sources()["Note"],
            [{"kind": "app", "id": name, "label": "Obsidian", "mark": "obsidian"}],
        )

    def test_with_nobody_on_record_the_source_names_who_brought_it(self) -> None:
        vault = Path(self.tmp.name) / "Vault"
        self.put("automation", "older.md")
        self.put("capture", "agent-session")
        self.put("capture", "/Users/owner/Downloads/notes.pdf")
        self.put("capture", str(vault / "kept.md"))
        self.put("agent-gone", "saved", project="Grok Bot")
        self.put("agent-nameless", "unnamed")
        self.put("substack-writer", "post")
        self.put("mystery", "thing")
        self.put("claude", "memory.md")
        with Store() as store:
            store.set_setting(
                "owner_sources",
                [
                    {
                        "name": "folder-1",
                        "label": "Vault",
                        "locator": str(vault),
                        "owned": True,
                    }
                ],
            )
        found = self.sources()
        lore = {"kind": "lore", "id": "lore", "label": "Lore", "mark": "lore"}
        self.assertEqual(found["older.md"], [lore])
        self.assertEqual(
            found["agent-session"],
            [{"kind": "capture", "id": "you", "label": "you", "mark": "pen"}],
        )
        downloaded = "/Users/owner/Downloads/notes.pdf"
        [file] = found[downloaded]
        self.assertEqual(
            (file["kind"], file["label"], file["mark"]),
            ("capture", "notes.pdf", "file"),
        )
        self.assertRegex(str(file["id"]), r"^file-[0-9a-f]{16}$")
        self.assertEqual(
            found[str(vault / "kept.md")],
            [{"kind": "app", "id": "folder-1", "label": "Vault", "mark": ""}],
        )
        self.assertEqual(
            found["saved"],
            [
                {
                    "kind": "agent",
                    "id": "agent-gone",
                    "label": "Grok Bot",
                    "mark": "other",
                }
            ],
        )
        self.assertEqual(found["unnamed"][0]["label"], "Your agent")
        self.assertEqual(
            found["post"],
            [
                {
                    "kind": "app",
                    "id": "substack-writer",
                    "label": "Substack",
                    "mark": "substack",
                }
            ],
        )
        self.assertEqual(
            found["thing"],
            [{"kind": "app", "id": "mystery", "label": "mystery", "mark": ""}],
        )
        self.assertEqual(
            found["memory.md"],
            [{"kind": "app", "id": "claude", "label": "Claude Code", "mark": "claude"}],
        )


class ProvenanceLimitsTest(ProvenanceTest):
    """Whatever a memory holds, naming where it came from never fails the library."""

    def test_a_capture_from_a_long_path_is_named_by_its_file(self) -> None:
        path = "/Users/owner/" + "deeply/nested/" * 15 + "notes.md"
        self.assertGreater(len(path), 200)
        capture_module.save([{"title": "Long", "content": "a", "source_path": path}])
        [item] = build()["library"]["items"]  # type: ignore[index]
        [source] = item["sources"]
        self.assertEqual((source["label"], source["mark"]), ("notes.md", "file"))
        self.assertLessEqual(len(source["id"]), 200)

    def test_a_name_too_long_for_a_label_is_cut_to_fit(self) -> None:
        self.put("agent-gone", "long", project="x" * 300)
        [source] = self.sources()["long"]
        self.assertEqual((source["kind"], source["label"]), ("agent", "x" * 200))

    def test_a_tilde_name_is_the_owners_own_words_not_a_home(self) -> None:
        # Only `~/` means home: `~standup` and `~bob/x` would make Path raise.
        for path in ("~standup", "~bob/x"):
            capture_module.save(
                [{"title": path, "content": "we ship friday", "source_path": path}]
            )
        capture_module.save(
            [{"title": "Home", "content": "a note", "source_path": "~/notes/a.md"}]
        )
        found = self.sources()
        for path in ("~standup", "~bob/x"):
            self.assertEqual(found[path][0]["label"], "you")
        self.assertEqual(found["Home"][0]["label"], "a.md")
        result = subprocess.run(
            [sys.executable, "-m", "lore", "desktop-state"],
            env=os.environ.copy(),
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_one_memory_that_cannot_be_named_says_lore_and_the_rest_load(
        self,
    ) -> None:
        self.put("capture", "/Users/owner/broken.md")
        self.put("agent-named", "fine", project="Grok Bot")
        with patch.object(Path, "is_relative_to", side_effect=RuntimeError("no")):
            with Store() as store:
                store.set_setting(
                    "owner_sources",
                    [
                        {
                            "name": "folder-1",
                            "label": "V",
                            "locator": "/v",
                            "owned": True,
                        }
                    ],
                )
            found = self.sources()
        self.assertEqual(found["/Users/owner/broken.md"][0]["kind"], "lore")
        self.assertEqual(found["fine"][0]["label"], "Grok Bot")

    def test_a_folder_named_past_a_label_still_imports_and_syncs(self) -> None:
        root = Path(self.tmp.name) / "vault"
        root.mkdir()
        (root / "note.md").write_text("# Note\n\nA lesson long enough to be kept.")
        with Store() as store:
            entry = Registry(store).add(str(root), label="L" * 270)
            self.assertEqual(entry["imported"], 1)
            Registry(store).scan()
            [row] = store.memory_inventory()
            [credited] = row["sources"]  # type: ignore[misc]
            self.assertEqual(credited["label"], "L" * 200)

    def test_one_source_that_cannot_be_credited_never_stops_the_rest(self) -> None:
        root = Path(self.tmp.name) / "vault"
        root.mkdir()
        (root / "note.md").write_text("# Note\n\nA lesson long enough to be kept.")
        with Store() as store:
            name = str(Registry(store).add(str(root))["name"])
            with patch.object(Store, "credit_source", side_effect=RuntimeError("no")):
                with redirect_stderr(StringIO()) as said:
                    report = Registry(store).scan()
            self.assertIn(name, report)
            self.assertIn(name, store.setting("source_reads", {}))
            self.assertIn("could not record", said.getvalue())

    def test_reading_again_keeps_when_a_source_first_brought_it_in(self) -> None:
        root = Path(self.tmp.name) / "vault"
        root.mkdir()
        (root / "note.md").write_text("# Note\n\nA lesson long enough to be kept.")
        with Store() as store:
            Registry(store).add(str(root))
            [first] = store.memory_inventory()[0]["sources"]  # type: ignore[misc]
            Registry(store).scan()
            [again] = store.memory_inventory()[0]["sources"]  # type: ignore[misc]
            self.assertEqual(again["at"], first["at"])

    def test_marks_are_the_known_apps_agents_and_lores_own(self) -> None:
        known = sources_module.marks()
        self.assertTrue({"obsidian", "grok", "other", "claude", "codex"} <= known)
        self.assertTrue({"clock", "pen", "file", "lore", ""} <= known)
        self.assertNotIn("../../elsewhere", known)


if __name__ == "__main__":
    unittest.main()
