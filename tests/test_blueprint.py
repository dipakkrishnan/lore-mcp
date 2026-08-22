"""Tests for `lore.blueprint` — the single write path for the owner's lore shape.

The interviewing agent hands over a JSON file rather than writing
`~/.lore/blueprint/*` itself, which makes `normalize()` the one place untrusted
interview input is validated.
"""

from __future__ import annotations

import json
import stat
import sys
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from helpers import LoreTestCase, blueprint_input

from lore import blueprint


class BlueprintPathTest(LoreTestCase):
    def test_both_artifacts_live_under_lore_home(self) -> None:
        self.assertEqual(
            blueprint.blueprint_path(), self.lore_home / "blueprint/blueprint.json"
        )
        self.assertEqual(
            blueprint.lore_map_path(), self.lore_home / "blueprint/lore-map.md"
        )

    def test_loading_before_capture_returns_none(self) -> None:
        self.assertIsNone(blueprint.load_blueprint())


class NormalizeTest(unittest.TestCase):
    def test_persona_seeds_the_axis_and_the_owner_can_override_it(self) -> None:
        self.assertEqual(
            blueprint.normalize(blueprint_input(persona="professor"))[
                "organizing_axis"
            ],
            "knowledge",
        )
        data = blueprint_input(persona="professor")
        data["organizing_axis"] = "chronological"
        self.assertEqual(blueprint.normalize(data)["organizing_axis"], "chronological")

    def test_resolved_structure_matches_the_persona(self) -> None:
        result = blueprint.normalize(blueprint_input(persona="executive"))
        profile = blueprint.PERSONA_PROFILES["executive"]
        self.assertEqual(result["depth_default"], profile["depth_default"])
        self.assertEqual(result["section_labels"], profile["section_labels"])
        # The result is self-contained: a later reader never needs the registry.
        self.assertNotIn("axis", result)

    def test_the_registry_is_complete_for_every_persona(self) -> None:
        for persona in blueprint.PERSONAS:
            with self.subTest(persona=persona):
                profile = blueprint.PERSONA_PROFILES[persona]
                self.assertIn(profile["axis"], blueprint.AXES)
                self.assertTrue(profile["depth_default"])
                self.assertEqual(
                    set(profile["section_labels"]),
                    {"outline", "focus", "general", "voice"},
                )

    def test_lists_are_trimmed_deduplicated_and_optional(self) -> None:
        data = blueprint_input()
        data["topic_outline"] = ["  a  ", "", "a", "b"]
        self.assertEqual(blueprint.normalize(data)["topic_outline"], ["a", "b"])
        data = blueprint_input()
        del data["focus_topics"]
        del data["general_areas"]
        result = blueprint.normalize(data)
        self.assertEqual(result["focus_topics"], [])
        self.assertEqual(result["general_areas"], [])

    def test_control_characters_are_stripped_from_text_and_items(self) -> None:
        data = blueprint_input()
        data["name"] = "Bad\x1b[2J"
        data["storytelling"] = "Body\x07 text"
        data["topic_outline"] = ["clean\x1b[0m topic"]
        rendered = blueprint.render_map(blueprint.normalize(data))
        self.assertNotIn("\x1b", rendered)
        self.assertNotIn("\x07", rendered)

    def test_command_authored_fields_are_rejected(self) -> None:
        # These are resolved by normalize(); accepting them from the skill would
        # let an interview overwrite the structure the persona is supposed to fix.
        for field, value in (
            ("captured_at", "2020-01-01T00:00:00Z"),
            ("depth_default", "deep"),
            ("section_labels", {}),
        ):
            data = blueprint_input()
            data[field] = value
            with self.subTest(field=field):
                with self.assertRaisesRegex(
                    ValueError, "Extra inputs are not permitted"
                ):
                    blueprint.normalize(data)

    def test_the_shape_of_the_payload_is_enforced(self) -> None:
        with self.assertRaisesRegex(ValueError, "valid dictionary"):
            blueprint.normalize(["not", "an", "object"])  # type: ignore[arg-type]
        data = blueprint_input()
        del data["storytelling"]
        with self.assertRaisesRegex(ValueError, "Field required"):
            blueprint.normalize(data)

    def test_unknown_persona_axis_and_version_are_rejected(self) -> None:
        for field, value, message in (
            ("persona", "wizard", "storyteller"),
            ("organizing_axis", "alphabetical", "chronological"),
            ("version", 2, "Input should be 1"),
        ):
            data = blueprint_input()
            data[field] = value
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, message):
                    blueprint.normalize(data)

    def test_text_fields_must_be_non_empty_strings_within_bounds(self) -> None:
        for field, value, message in (
            ("name", "   ", "at least 1 character"),
            ("name", 42, "valid string"),
            ("name", "x" * (blueprint.MAX_NAME_LENGTH + 1), "at most 200 characters"),
            (
                "storytelling",
                "x" * (blueprint.MAX_TEXT_LENGTH + 1),
                "at most 1000 characters",
            ),
        ):
            data = blueprint_input()
            data[field] = value
            with self.subTest(field=field, message=message):
                with self.assertRaisesRegex(ValueError, message):
                    blueprint.normalize(data)

    def test_list_fields_are_bounded_and_must_hold_strings(self) -> None:
        for value, message in (
            ("not a list", "valid list"),
            (
                [f"item {n}" for n in range(blueprint.MAX_ITEMS + 1)],
                "cannot exceed 50 items",
            ),
            ([123], "valid string"),
            (["x" * (blueprint.MAX_ITEM_LENGTH + 1)], "cannot exceed"),
            ([], "at least 1 item"),
            (["   ", ""], "at least 1 item"),
        ):
            data = blueprint_input()
            data["topic_outline"] = value
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    blueprint.normalize(data)


class RenderMapTest(unittest.TestCase):
    def test_the_map_uses_the_persona_section_labels(self) -> None:
        rendered = blueprint.render_map(
            blueprint.normalize(blueprint_input(persona="professor"))
        )
        for expected in (
            "Professor Ada",
            "Course outline",
            "distributed systems",
            "Deep dives",
            "Survey level",
            "Short claim-plus-evidence",
            "Organized by knowledge",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, rendered)

    def test_empty_optional_sections_are_omitted_entirely(self) -> None:
        data = blueprint_input(persona="storyteller")
        data["focus_topics"] = []
        data["general_areas"] = []
        rendered = blueprint.render_map(blueprint.normalize(data))
        self.assertIn("Chapters", rendered)
        self.assertNotIn("Turning points", rendered)
        self.assertNotIn("Backdrop", rendered)
        self.assertIn("How I tell it", rendered)


class ApplyTest(LoreTestCase):
    def _write(self, data: object) -> Path:
        path = self.lore_home / "blueprint-input.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
        return path

    def test_apply_normalizes_persists_and_is_idempotent(self) -> None:
        data = blueprint_input()
        data["topic_outline"] = [
            "distributed systems",
            "consensus",
            "distributed systems",
        ]
        result = blueprint.apply(self._write(data))
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["name"], "Ada")
        self.assertEqual(result["persona"], "professor")
        self.assertIn("captured_at", result)
        self.assertEqual(result["topic_outline"], ["distributed systems", "consensus"])
        self.assertEqual(blueprint.load_blueprint(), result)

        second = blueprint.apply(self._write(blueprint_input(name="Grace")))
        self.assertEqual(second["name"], "Grace")
        self.assertEqual(blueprint.load_blueprint()["name"], "Grace")
        self.assertIn("Grace", blueprint.lore_map_path().read_text())

    def test_both_artifacts_are_owner_private(self) -> None:
        blueprint.apply(self._write(blueprint_input()))
        for path in (blueprint.blueprint_path(), blueprint.lore_map_path()):
            with self.subTest(path=path.name):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(
            stat.S_IMODE(blueprint.blueprint_path().parent.stat().st_mode), 0o700
        )

    def test_a_dash_reads_the_blueprint_from_stdin(self) -> None:
        with patch.object(sys, "stdin", StringIO(json.dumps(blueprint_input()))):
            self.assertEqual(blueprint.apply(Path("-"))["name"], "Ada")
        with (
            patch.object(sys, "stdin", StringIO("{not json")),
            self.assertRaisesRegex(ValueError, "not valid JSON"),
        ):
            blueprint.apply(Path("-"))

    def test_a_missing_or_malformed_file_fails_with_a_readable_message(self) -> None:
        with self.assertRaisesRegex(OSError, "blueprint file not found"):
            blueprint.apply(self.lore_home / "absent.json")
        path = self.lore_home / "broken.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json")
        with self.assertRaisesRegex(ValueError, "not valid JSON"):
            blueprint.apply(path)


if __name__ == "__main__":
    unittest.main()
