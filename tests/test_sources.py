"""Tests for `lore.sources` — what Lore is allowed to read off the owner's disk.

The import boundary is a promise: agent-written *memory* files only. Session
transcripts, intermediate scratch files, and Lore's own synthesis index stay out.
"""

from __future__ import annotations

import os
import unittest
from datetime import datetime
from pathlib import Path

from helpers import LoreTestCase

from lore import sources as sources_module
from lore.sources import Registry, Source, State, available_sources
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
        with Store() as store:
            store.set_setting("sources", ["codex"])
            states = {
                entry["name"]: entry["state"]
                for entry in sources_module.Registry(store).entries()
            }
        self.assertEqual(states["claude"], "off")

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
                        "added": 1,
                        "updated": 0,
                        "unchanged": 0,
                        "errors": 0,
                        "state": "connected",
                    }
                ],
            )
            # A short codex memory is still a memory: the sentence floor is for
            # folders the owner points at, not for agent-written files.
            self.assertEqual(store.search("codex lesson")[0].title, "C")
            with self.assertRaises(sources_module.SourceError):
                sources_module.Registry(store).read(["nope"])


if __name__ == "__main__":
    unittest.main()
