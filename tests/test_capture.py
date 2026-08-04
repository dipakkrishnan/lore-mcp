"""Tests for `lore.capture` — the attended-session boundary into private memory.

An agent proposes entries and the owner corrects them before anything is
written, so this module's only job is: validate what crosses that boundary,
and make a corrected locator update the same row rather than duplicate it.
"""

from __future__ import annotations

import unittest

from helpers import LoreTestCase

from lore.capture import normalize, save
from lore.store import Status, Store


class NormalizeTest(unittest.TestCase):
    def test_defaults_fill_in_project_and_source_path(self) -> None:
        entry = normalize([{"title": "t", "content": "c"}])[0]
        self.assertEqual(entry.project, "general")
        self.assertEqual(entry.source_path, "agent-session")

    def test_title_and_single_line_fields_are_collapsed_to_one_line(self) -> None:
        entry = normalize(
            [{"title": "Hire management\nbefore rapid growth", "content": "c"}]
        )[0]
        self.assertEqual(entry.title, "Hire management before rapid growth")

    def test_content_keeps_newlines_but_normalizes_line_endings_and_strips(
        self,
    ) -> None:
        entry = normalize(
            [{"title": "t", "content": "  Add the layer.\r\nBefore hiring\tmore.  "}]
        )[0]
        self.assertEqual(entry.content, "Add the layer.\nBefore hiring more.")

    def test_non_string_fields_fall_through_to_pydantics_own_type_error(self) -> None:
        # The cleaning validators only touch strings; a wrong-typed value must
        # still be rejected, just by the field's own type check afterward.
        for field, value in (("title", 42), ("content", ["not", "a", "string"])):
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, "valid string"):
                    normalize([{"title": "t", "content": "c", field: value}])

    def test_batch_size_and_required_fields_are_bounded(self) -> None:
        cases = [
            ([], "at least 1 item"),
            ([{"title": "", "content": "x"}], "at least 1 character"),
            ([{"title": "x", "content": ""}], "at least 1 character"),
            (
                [{"title": "x", "content": "y", "source_path": ""}],
                "at least 1 character",
            ),
            ([{"title": "x", "content": "y"}] * 21, "at most 20 items"),
            (
                [{"title": "x", "content": "y", "status": "published"}],
                "Extra inputs are not permitted",
            ),
        ]
        for payload, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    normalize(payload)

    def test_a_partially_invalid_batch_validates_all_or_nothing(self) -> None:
        with self.assertRaises(ValueError):
            normalize(
                [
                    {"title": "valid", "content": "must not be partially saved"},
                    {"title": "", "content": "invalid second entry"},
                ]
            )


class SaveTest(LoreTestCase):
    def test_save_writes_private_capture_rows_and_deduplicates(self) -> None:
        payload = [
            {
                "title": "Hire management before rapid growth",
                "content": "Add the management layer.",
                "project": "team scaling",
                "source_path": "field-notes.pdf#page=8",
            },
            {
                "title": "Voice-only observation",
                "content": "Spoken directly in the attended agent session.",
            },
        ]
        first = save(payload)
        self.assertEqual(first[0]["status"], "added")
        second = save(payload)
        self.assertEqual(second[0]["status"], "unchanged")

        with Store() as store:
            memories = store.search("management")
            spoken = store.search("spoken")
        self.assertEqual(len(memories), 1)
        self.assertIs(memories[0].status, Status.PRIVATE)
        self.assertEqual(memories[0].source, "capture")
        self.assertEqual(memories[0].origin, "attended")
        self.assertEqual(memories[0].source_path, "field-notes.pdf#page=8")
        self.assertEqual(first[0]["id"], memories[0].id)
        self.assertEqual(spoken[0].source_path, "agent-session")
        self.assertEqual(first[1]["id"], spoken[0].id)

    def test_correcting_a_locator_updates_the_memory_instead_of_duplicating_it(
        self,
    ) -> None:
        # The correction loop re-applies the same approved text with a fixed
        # source_path; that must update the existing row, not add a sibling —
        # source_path is part of the fingerprint but not the identity key.
        entry = {
            "title": "Hire management before rapid growth",
            "content": "Add the management layer first.",
            "source_path": "field-notes.pdf",
        }
        first = save([entry])[0]
        corrected = save([{**entry, "source_path": "field-notes.pdf#page=8"}])[0]
        replay = save([{**entry, "source_path": "field-notes.pdf#page=8"}])[0]

        self.assertEqual(first["status"], "added")
        self.assertEqual(corrected["status"], "updated")
        self.assertEqual(replay["status"], "unchanged")
        self.assertEqual(corrected["id"], first["id"])
        with Store() as store:
            memories = store.search("management")
        self.assertEqual(len(memories), 1)
        self.assertEqual(memories[0].source_path, "field-notes.pdf#page=8")

    def test_nothing_is_written_when_any_entry_in_the_batch_is_invalid(self) -> None:
        with self.assertRaises(ValueError):
            save([{"title": "", "content": "x"}])
        with Store() as store:
            self.assertEqual(store.counts()["private"], 0)


if __name__ == "__main__":
    unittest.main()
