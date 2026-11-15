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


class LinkTest(LoreTestCase):
    """CAP-002: a captured memory can say which earlier memories it grows out of."""

    def earlier(self, title: str = "Failed launch at Actively") -> int:
        return int(
            save([{"title": title, "content": f"{title}: what happened."}])[0]["id"]
        )

    def test_a_valid_link_is_written_with_the_memory_and_read_both_ways(self) -> None:
        launch = self.earlier()
        (saved,) = save(
            [
                {
                    "title": "Pricing lesson",
                    "content": "Price the first tier low.",
                    "related": [
                        {"id": launch, "reason": "Learned from the failed launch."}
                    ],
                }
            ]
        )
        with Store() as store:
            self.assertEqual(
                store.links_of(int(saved["id"])),
                [
                    {
                        "id": launch,
                        "title": "Failed launch at Actively",
                        "reason": "Learned from the failed launch.",
                        "direction": "to",
                    }
                ],
            )
            self.assertEqual(
                store.links_of(launch),
                [
                    {
                        "id": saved["id"],
                        "title": "Pricing lesson",
                        "reason": "Learned from the failed launch.",
                        "direction": "from",
                    }
                ],
            )

    def test_a_bad_link_rejects_the_whole_batch_and_names_it(self) -> None:
        launch = self.earlier()
        gone = self.earlier("Old idea")
        with Store() as store:
            store.discard(gone)
        existing = save([{"title": "Kept", "content": "Kept text."}])[0]["id"]
        for related, named in (
            ([{"id": 9999, "reason": "r"}], "9999"),
            ([{"id": gone, "reason": "r"}], str(gone)),
        ):
            with self.subTest(named=named):
                with self.assertRaisesRegex(ValueError, f"memory {named}"):
                    save(
                        [
                            {
                                "title": "Fine",
                                "content": "Fine text.",
                                "related": [{"id": launch, "reason": "ok"}],
                            },
                            {
                                "title": "Bad",
                                "content": "Bad text.",
                                "related": related,
                            },
                        ]
                    )
                with Store() as store:
                    self.assertEqual(store.search("Fine text"), [])
                    self.assertEqual(store.links_of(launch), [])
        with self.assertRaisesRegex(ValueError, f"memory {existing}.*itself"):
            save(
                [
                    {
                        "title": "Kept",
                        "content": "Kept text.",
                        "related": [{"id": existing, "reason": "me"}],
                    }
                ]
            )

    def test_without_related_nothing_changes(self) -> None:
        (saved,) = save([{"title": "Plain", "content": "Plain text."}])
        with Store() as store:
            self.assertEqual(store.links_of(int(saved["id"])), [])

    def test_discarding_or_deleting_a_memory_drops_its_links_both_ways(self) -> None:
        for drop in ("discard", "delete"):
            with self.subTest(drop=drop):
                launch = self.earlier(f"Launch {drop}")
                middle = int(
                    save(
                        [
                            {
                                "title": f"Middle {drop}",
                                "content": f"Middle {drop}.",
                                "related": [{"id": launch, "reason": "from"}],
                            }
                        ]
                    )[0]["id"]
                )
                late = int(
                    save(
                        [
                            {
                                "title": f"Late {drop}",
                                "content": f"Late {drop}.",
                                "related": [{"id": middle, "reason": "grew"}],
                            }
                        ]
                    )[0]["id"]
                )
                with Store() as store:
                    getattr(store, drop)(middle)
                    self.assertEqual(store.links_of(launch), [])
                    self.assertEqual(store.links_of(late), [])

    def test_the_snapshot_lists_each_memorys_links_both_ways(self) -> None:
        from lore.snapshot import build

        launch = self.earlier()
        lesson = int(
            save(
                [
                    {
                        "title": "Pricing lesson",
                        "content": "Low first.",
                        "related": [{"id": launch, "reason": "Learned there."}],
                    }
                ]
            )[0]["id"]
        )
        items = {m["id"]: m for m in build()["library"]["items"]}
        self.assertEqual(
            items[lesson]["links"],
            [
                {
                    "id": launch,
                    "title": "Failed launch at Actively",
                    "reason": "Learned there.",
                    "direction": "to",
                }
            ],
        )
        self.assertEqual(
            items[launch]["links"],
            [
                {
                    "id": lesson,
                    "title": "Pricing lesson",
                    "reason": "Learned there.",
                    "direction": "from",
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
