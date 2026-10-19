"""Tests for `lore.blueprint` — the single write path for the owner's lore shape.

The interviewing agent hands over a JSON file rather than writing
`~/.lore/blueprint/*` itself, which makes `normalize()` the one place untrusted
interview input is validated.
"""

from __future__ import annotations

import json
import os
import stat
import sys
import unittest
from datetime import datetime, timedelta, timezone
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

    def test_a_saved_blueprint_that_is_not_an_object_is_refused(self) -> None:
        path = blueprint.blueprint_path()
        path.parent.mkdir(parents=True)
        path.write_text('["Ada", "professor"]\n', encoding="utf-8")
        with self.assertRaisesRegex(
            ValueError, "saved blueprint must be a JSON object"
        ):
            blueprint.load_blueprint()


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
            blueprint.normalize(["not", "an", "object"])
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

    def test_a_null_list_is_an_empty_one(self) -> None:
        data = blueprint_input()
        data["focus_topics"] = None
        data["general_areas"] = None
        result = blueprint.normalize(data)
        self.assertEqual(result["focus_topics"], [])
        self.assertEqual(result["general_areas"], [])
        # The outline is the one list that cannot be empty, however it got there.
        data["topic_outline"] = None
        with self.assertRaisesRegex(ValueError, "at least 1 item"):
            blueprint.normalize(data)

    def test_a_null_axis_falls_back_to_the_personas(self) -> None:
        for persona in blueprint.PERSONAS:
            data = blueprint_input(persona=persona)
            data["organizing_axis"] = None
            with self.subTest(persona=persona):
                self.assertEqual(
                    blueprint.normalize(data)["organizing_axis"],
                    blueprint.PERSONA_PROFILES[persona]["axis"],
                )

    def test_cleaning_turns_controls_and_runs_of_whitespace_into_single_spaces(
        self,
    ) -> None:
        data = blueprint_input()
        data["name"] = "  Ada \t\n Lovelace\x1b "
        data["storytelling"] = "Body\x07text,\r\n  second line"
        data["topic_outline"] = ["clean\x1b[0m topic", "\ttabbed   apart\n"]
        result = blueprint.normalize(data)
        self.assertEqual(result["name"], "Ada Lovelace")
        # A control character separates words; it is not deleted and the
        # printable rest of an escape sequence stays as harmless text.
        self.assertEqual(result["storytelling"], "Body text, second line")
        self.assertEqual(result["topic_outline"], ["clean [0m topic", "tabbed apart"])

        data = blueprint_input()
        data["name"] = "\x1b\x07 \x00"
        with self.assertRaisesRegex(ValueError, "at least 1 character"):
            blueprint.normalize(data)

    def test_limits_are_inclusive_and_measured_after_cleaning(self) -> None:
        name = "n" * blueprint.MAX_NAME_LENGTH
        story = "s" * blueprint.MAX_TEXT_LENGTH
        item = "i" * blueprint.MAX_ITEM_LENGTH
        data = blueprint_input()
        data["name"] = f"  {name}\x07 "
        data["storytelling"] = f"\n{story}\t"
        data["topic_outline"] = [f" \x1b{item}  "]
        result = blueprint.normalize(data)
        self.assertEqual(result["name"], name)
        self.assertEqual(result["storytelling"], story)
        self.assertEqual(result["topic_outline"], [item])

        full = [f"item {n}" for n in range(blueprint.MAX_ITEMS)]
        for field in ("topic_outline", "focus_topics", "general_areas"):
            data = blueprint_input()
            data[field] = list(full)
            with self.subTest(field=field):
                self.assertEqual(blueprint.normalize(data)[field], full)

    def test_duplicates_are_judged_after_cleaning_and_the_first_one_stays(
        self,
    ) -> None:
        data = blueprint_input()
        data["topic_outline"] = ["b", "a  b", "a b", "A b", "a\x07b", "b"]
        # The same entry may sit in two lists: each list is de-duplicated alone.
        data["focus_topics"] = ["b", " b "]
        data["general_areas"] = ["b"]
        result = blueprint.normalize(data)
        self.assertEqual(result["topic_outline"], ["b", "a b", "A b"])
        self.assertEqual(result["focus_topics"], ["b"])
        self.assertEqual(result["general_areas"], ["b"])

    def test_the_capture_time_is_utc_to_the_second(self) -> None:
        # 07:06:07.987654 at +02:00 is 05:06:07 UTC. Asked without a zone, the
        # stand-in clock answers in its own wall time, as the real one would.
        moment = datetime(
            2026, 3, 4, 7, 6, 7, 987654, tzinfo=timezone(timedelta(hours=2))
        )

        def now(tz: timezone | None = None) -> datetime:
            return moment.astimezone(tz) if tz else moment.replace(tzinfo=None)

        with patch.object(blueprint, "datetime") as clock:
            clock.now.side_effect = now
            result = blueprint.normalize(blueprint_input())
        self.assertEqual(result["captured_at"], "2026-03-04T05:06:07Z")
        clock.now.assert_called_once_with(timezone.utc)

    def test_the_result_owns_its_section_labels(self) -> None:
        result = blueprint.normalize(blueprint_input(persona="sage"))
        registry = blueprint.PERSONA_PROFILES["sage"]["section_labels"]
        self.assertEqual(result["section_labels"], registry)
        # A caller editing its blueprint must not be editing every later sage's.
        self.assertIsNot(result["section_labels"], registry)


class RenderMapTest(unittest.TestCase):
    def test_the_map_is_laid_out_exactly(self) -> None:
        saved = blueprint.normalize(blueprint_input(persona="professor"))
        saved["captured_at"] = "2026-03-04T05:06:07Z"
        self.assertEqual(
            blueprint.render_map(saved),
            "# Lore map — Professor Ada\n"
            "\n"
            "_Captured 2026-03-04. Organized by knowledge._\n"
            "\n"
            "## Course outline\n"
            "- distributed systems\n"
            "- consensus\n"
            "\n"
            "## Deep dives\n"
            "- consensus tradeoffs\n"
            "\n"
            "## Survey level\n"
            "- intro networking\n"
            "\n"
            "## How I lecture\n"
            "Short claim-plus-evidence notes; lecture tone.\n",
        )
        saved["focus_topics"] = []
        saved["general_areas"] = []
        self.assertEqual(
            blueprint.render_map(saved),
            "# Lore map — Professor Ada\n"
            "\n"
            "_Captured 2026-03-04. Organized by knowledge._\n"
            "\n"
            "## Course outline\n"
            "- distributed systems\n"
            "- consensus\n"
            "\n"
            "## How I lecture\n"
            "Short claim-plus-evidence notes; lecture tone.\n",
        )

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

    def _loosen(self) -> tuple[Path, Path, Path]:
        """Leave both artifacts on disk, stale and readable by everyone.

        The modes are set outright: under a strict umask a plain mkdir and
        write would already be private, and the tests below would prove nothing.
        """
        saved, lore_map = blueprint.blueprint_path(), blueprint.lore_map_path()
        directory = saved.parent
        directory.mkdir(parents=True)
        os.chmod(directory, 0o755)
        for path in (saved, lore_map):
            path.write_text("stale", encoding="utf-8")
            os.chmod(path, 0o644)
        self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o755)
        for path in (saved, lore_map):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)
        return directory, saved, lore_map

    def test_artifacts_that_already_exist_too_open_are_tightened(self) -> None:
        source = self._write(blueprint_input())
        directory, saved, lore_map = self._loosen()
        blueprint.apply(source)
        self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
        for path in (saved, lore_map):
            with self.subTest(path=path.name):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertNotIn("stale", path.read_text(encoding="utf-8"))

    def test_each_artifact_is_already_private_when_its_content_is_written(
        self,
    ) -> None:
        source = self._write(blueprint_input())
        _, saved, lore_map = self._loosen()
        modes: dict[str, int | None] = {}
        write_text = Path.write_text

        def record(path: Path, *args: object, **kwargs: object) -> int:
            if path in (saved, lore_map):
                modes[path.name] = (
                    stat.S_IMODE(path.stat().st_mode) if path.exists() else None
                )
            return write_text(path, *args, **kwargs)

        with patch.object(Path, "write_text", autospec=True, side_effect=record):
            blueprint.apply(source)
        self.assertEqual(modes, {"blueprint.json": 0o600, "lore-map.md": 0o600})

    def test_what_is_saved_is_the_returned_blueprint_and_its_map(self) -> None:
        result = blueprint.apply(self._write(blueprint_input()))
        text = blueprint.blueprint_path().read_text(encoding="utf-8")
        self.assertEqual(text, json.dumps(result, indent=2) + "\n")
        self.assertTrue(text.startswith('{\n  "version": 1,\n  "captured_at": "'), text)
        self.assertTrue(text.endswith('lecture tone."\n}\n'), text)
        self.assertEqual(
            blueprint.lore_map_path().read_text(encoding="utf-8"),
            blueprint.render_map(result),
        )

    def test_a_refused_blueprint_leaves_the_saved_one_as_it_was(self) -> None:
        # The first case is the one that matters most: a payload that parses
        # but fails validation must be turned away before anything is written.
        refused = blueprint_input()
        refused["persona"] = "wizard"
        broken = self.lore_home / "broken.json"
        broken.parent.mkdir(parents=True, exist_ok=True)
        broken.write_text("{not json", encoding="utf-8")
        sources = (
            ("refused", self._write(refused), ValueError),
            ("malformed", broken, ValueError),
            ("missing", self.lore_home / "absent.json", OSError),
        )

        for label, source, error in sources:
            with self.subTest(label=label, saved="nothing"):
                with self.assertRaises(error):
                    blueprint.apply(source)
                self.assertFalse(blueprint.blueprint_path().parent.exists())
                self.assertIsNone(blueprint.load_blueprint())

        good = self.lore_home / "good.json"
        good.write_text(json.dumps(blueprint_input(name="Grace")), encoding="utf-8")
        blueprint.apply(good)
        kept = [
            path.read_bytes()
            for path in (blueprint.blueprint_path(), blueprint.lore_map_path())
        ]
        for label, source, error in sources:
            with self.subTest(label=label, saved="Grace"):
                with self.assertRaises(error):
                    blueprint.apply(source)
                self.assertEqual(
                    [
                        path.read_bytes()
                        for path in (
                            blueprint.blueprint_path(),
                            blueprint.lore_map_path(),
                        )
                    ],
                    kept,
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
