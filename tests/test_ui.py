"""Tests for `lore.ui` — the only module that writes to the owner's terminal.

Memory content is untrusted text from an agent's memory file, so the card
renderer is a security surface, not decoration.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from helpers import captured

from lore import ui
from lore.store import Memory, Publication


def _memory(**overrides: object) -> Memory:
    return Memory(
        **{
            "id": 1,
            "source": "test",
            "origin": "native",
            "title": "A lesson",
            "content": "a lesson body",
            "project": "",
            "status": "private",
            "source_path": "",
            "updated_at": "now",
        }
        | overrides
    )


class PaintTest(unittest.TestCase):
    def test_color_is_added_only_when_the_terminal_wants_it(self) -> None:
        with patch.object(ui, "COLOR", True):
            self.assertEqual(ui.paint("1", "hi"), "\033[1mhi\033[0m")
        with patch.object(ui, "COLOR", False):
            self.assertEqual(ui.paint("1", "hi"), "hi")

    def test_the_chrome_helpers_print_their_text(self) -> None:
        with patch.object(ui, "COLOR", False):
            for helper, text, expected in (
                (ui.heading, "Library", "Library"),
                (ui.success, "done", "✓ done"),
                (ui.muted, "aside", "aside"),
            ):
                with self.subTest(helper=helper.__name__), captured() as output:
                    helper(text)
                    self.assertIn(expected, output.getvalue())
            with captured() as output:
                ui.logo()
            self.assertIn("Lore", output.getvalue())


def _publication(**overrides: object) -> Publication:
    return Publication(
        **{
            "id": 1,
            "title": "Pricing claim",
            "content": "a bounded claim",
            "kind": "claim",
            "topic": "pricing",
            "provenance": [7, 8],
            "active": 1,
            "created_at": "now",
            "updated_at": "now",
        }
        | overrides
    )


class PublicationCardTest(unittest.TestCase):
    def test_the_label_reflects_disclosure_state(self) -> None:
        for publication, expected in (
            (_publication(active=1), "active"),
            (_publication(active=0), "revoked"),
        ):
            with self.subTest(expected=expected), captured() as output:
                ui.publication_card(publication)
                self.assertIn(expected, output.getvalue())
        with captured() as output:
            ui.publication_card(_publication(), 2, 5)
        self.assertIn("Candidate 2 of 5", output.getvalue())

    def test_a_stale_source_is_called_out_on_the_card(self) -> None:
        # The owner re-approving needs to see that the memory moved under it.
        with captured() as output:
            ui.publication_card(_publication(source_changed_at="2026-07-31T00:00:00Z"))
        self.assertIn("source changed", output.getvalue())

    def test_the_card_shows_kind_provenance_count_and_topic(self) -> None:
        with captured() as output:
            ui.publication_card(_publication())
        text = output.getvalue()
        self.assertIn("claim", text)
        self.assertIn("2 source memories", text)
        # The topic is externally visible wherever discovery groups by it, so
        # approving the card is also approving the label.
        self.assertIn("topic: pricing", text)
        # Provenance ids are owner-only context, never shown even to the owner
        # as a list a screenshot could leak.
        self.assertNotIn("[7, 8]", text)

    def test_a_publication_without_a_topic_omits_the_label(self) -> None:
        with captured() as output:
            ui.publication_card(_publication(topic=""))
        self.assertNotIn("topic:", output.getvalue())

    def test_control_characters_never_reach_the_terminal(self) -> None:
        with captured() as output:
            ui.publication_card(
                _publication(
                    title="Bad\x1b[2J", content="Body\x07 text", topic="t\x1b]0;x"
                )
            )
        text = output.getvalue()
        self.assertNotIn("\x1b", text)
        self.assertNotIn("\x07", text)

    def test_blank_lines_in_the_body_survive(self) -> None:
        with captured() as output:
            ui.publication_card(_publication(content="para one\n\npara two"))
        self.assertIn("\n\n", output.getvalue())

    def test_the_teaser_is_shown_as_the_free_advertisement(self) -> None:
        with captured() as output:
            ui.publication_card(_publication(teaser="What this claim tells a buyer"))
        self.assertIn("teaser: What this claim tells a buyer", output.getvalue())
        with captured() as output:
            ui.publication_card(_publication(teaser=""))
        self.assertNotIn("teaser:", output.getvalue())


class PromptTest(unittest.TestCase):
    def test_ask_falls_back_to_the_default_on_an_empty_answer(self) -> None:
        with patch("builtins.input", return_value="  typed  "):
            self.assertEqual(ui.ask("Choose", "k"), "typed")
        with patch("builtins.input", return_value="   ") as prompt:
            self.assertEqual(ui.ask("Choose", "k"), "k")
        self.assertIn("[k]", prompt.call_args.args[0])
        with patch("builtins.input", return_value="") as prompt:
            self.assertEqual(ui.ask("Choose"), "")
        self.assertNotIn("[", prompt.call_args.args[0])

    def test_confirm_reads_yes_and_no_and_otherwise_keeps_the_default(self) -> None:
        for answer, default, expected in (
            ("y", True, True),
            ("YES", False, True),
            ("n", True, False),
            ("No", True, False),
            ("", True, True),  # ask() substitutes the "Y/n" hint, not y or n
            ("", False, False),
            ("maybe", True, True),
        ):
            with self.subTest(answer=answer, default=default):
                with patch("builtins.input", return_value=answer):
                    self.assertIs(ui.confirm("Import?", default), expected)


class MemoryCardTest(unittest.TestCase):
    def test_a_file_locator_is_shown_but_the_session_sentinel_is_not(self) -> None:
        # "agent-session" is the source_path default for captures spoken in an
        # attended session — showing it back as a locator would be noise, not
        # provenance, since there is no file to point back to.
        for source_path, visible in (
            ("field-notes.pdf#page=8", True),
            ("agent-session", False),
        ):
            with self.subTest(source_path=source_path), captured() as output:
                ui.memory_card(_memory(source_path=source_path))
            self.assertEqual(source_path in output.getvalue(), visible)

    def test_control_characters_never_reach_the_terminal(self) -> None:
        # Memory text is untrusted: it comes from files another agent wrote.
        # An escape sequence surviving to stdout is a terminal-injection bug.
        memory = _memory(
            title="Bad\x1b[2J", content="Body\x07 text", project="proj\x1b]0;x\x07"
        )
        with captured() as output:
            ui.memory_card(memory)
        text = output.getvalue()
        self.assertNotIn("\x1b", text)
        self.assertNotIn("\x07", text)
        self.assertIn("Bad[2J", text)

    def test_the_label_switches_between_position_and_status(self) -> None:
        with captured() as output:
            ui.memory_card(_memory(), 2, 7)
        self.assertIn("Memory 2 of 7", output.getvalue())
        with captured() as output:
            ui.memory_card(_memory(status="discarded"))
        self.assertIn("discarded", output.getvalue())

    def test_the_project_falls_back_to_general(self) -> None:
        with captured() as output:
            ui.memory_card(_memory(project=""))
        self.assertIn("general", output.getvalue())
        with captured() as output:
            ui.memory_card(_memory(project="agents"))
        self.assertIn("agents", output.getvalue())

    def test_a_long_body_is_truncated_and_blank_lines_survive(self) -> None:
        memory = _memory(content="para one\n\n" + "x" * 2000)
        with captured() as output:
            ui.memory_card(memory)
        text = output.getvalue()
        self.assertIn("…", text)
        self.assertIn("\n\n", text)
        self.assertLess(text.count("x"), 2000)


if __name__ == "__main__":
    unittest.main()
