"""Tests for `lore.sources` — what Lore is allowed to read off the owner's disk.

The import boundary is a promise: agent-written *memory* files only. Session
transcripts, intermediate scratch files, and Lore's own synthesis index stay out.
"""

from __future__ import annotations

import unittest

from helpers import LoreTestCase

from lore.sources import Source, available_sources, scan
from lore.store import Status, Store


class SourceRegistryTest(LoreTestCase):
    def test_the_three_sources_point_at_the_configured_homes(self) -> None:
        by_name = {source.name: source for source in available_sources()}
        self.assertEqual(set(by_name), {"codex", "claude", "automation"})
        self.assertEqual(by_name["codex"].root, self.codex_home / "memories")
        self.assertEqual(by_name["claude"].root, self.claude_home / "projects")
        self.assertEqual(by_name["automation"].root, self.lore_home / "memories")
        self.assertEqual(by_name["automation"].origin, "automation")
        self.assertEqual(by_name["claude"].origin, "native")

    def test_a_missing_root_lists_no_files_instead_of_raising(self) -> None:
        source = Source("ghost", "Ghost", self.lore_home / "nowhere", "*.md")
        self.assertEqual(source.files(), [])


class ScanTest(LoreTestCase):
    def test_import_titles_projects_and_search(self) -> None:
        path = self.claude_home / "projects/demo/memory/testing.md"
        path.parent.mkdir(parents=True)
        path.write_text("# Testing preference\n\nUse focused integration tests.")

        with Store() as store:
            report = scan(store, {"claude"})
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
            scan(store, {"codex"})
            self.assertEqual(store.search("body")[0].title, "Memory")

    def test_codex_memories_are_flat_and_carry_no_project(self) -> None:
        # Codex's pattern is the literal `MEMORY.md`, so a nested file is not an
        # import at all — the project it would have been given never applies.
        root = self.codex_home / "memories"
        (root / "atlas").mkdir(parents=True)
        (root / "MEMORY.md").write_text("# Top\n\ntop level lesson")
        (root / "atlas/MEMORY.md").write_text("# Nested\n\nnested lesson")
        with Store() as store:
            report = scan(store, {"codex"})
            self.assertEqual(report["codex"]["found"], 1)
            self.assertEqual(store.search("top level")[0].project, "")
            self.assertEqual(store.search("nested"), [])

    def test_synthesis_memories_are_labelled_personal(self) -> None:
        root = self.lore_home / "memories"
        root.mkdir(parents=True)
        (root / "topic.md").write_text("# Topic\n\na synthesized lesson")
        with Store() as store:
            scan(store, {"automation"})
            self.assertEqual(store.search("synthesized")[0].project, "personal")

    def test_scanning_without_names_covers_every_source(self) -> None:
        (self.codex_home / "memories").mkdir(parents=True)
        (self.codex_home / "memories/MEMORY.md").write_text("# C\n\ncodex lesson")
        with Store() as store:
            report = scan(store)
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
            report = scan(store, {"codex", "automation"})
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
            report = scan(store, {"automation"})
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
            scan(store, {"automation"})
            store.set_status(store.search("durable")[0].id, "discarded")
        topic.write_text("# Agent systems\n\nA durable lesson changed after rejection.")
        with Store() as store:
            report = scan(store, {"automation"})
            self.assertEqual(report["automation"]["updated"], 1)
            self.assertIs(store.search("after rejection")[0].status, Status.DISCARDED)

    def test_unchanged_files_are_counted_and_not_rewritten(self) -> None:
        root = self.lore_home / "memories"
        root.mkdir(parents=True)
        (root / "topic.md").write_text("# Topic\n\nstable lesson")
        with Store() as store:
            scan(store, {"automation"})
            report = scan(store, {"automation"})
        self.assertEqual(report["automation"]["unchanged"], 1)
        self.assertEqual(report["automation"]["added"], 0)

    def test_an_empty_file_is_found_but_never_stored(self) -> None:
        root = self.lore_home / "memories"
        root.mkdir(parents=True)
        (root / "blank.md").write_text("   \n\n  ")
        with Store() as store:
            report = scan(store, {"automation"})
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
            report = scan(store, {"automation"})
            self.assertEqual(store.search("readable")[0].title, "Good")
        self.assertEqual(report["automation"]["errors"], 1)
        self.assertEqual(report["automation"]["added"], 1)


if __name__ == "__main__":
    unittest.main()
