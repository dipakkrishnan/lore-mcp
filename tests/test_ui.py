"""Tests for `lore.ui` — the only module that writes to the owner's terminal.

Memory content is untrusted text from an agent's memory file, so the card
renderer is a security surface, not decoration.
"""

from __future__ import annotations

import difflib
import io
import sys
import unittest
from contextlib import redirect_stderr
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


RULE = "─" * 72


class PlainTerminalTest(unittest.TestCase):
    """`COLOR` asks the process's own stdout and environment, so whoever ran
    the suite decides it. `paint` writes an escape sequence itself when it is
    on, so a test that looks for one, or compares output exactly, has to turn
    it off first."""

    def setUp(self) -> None:
        plain = patch.object(ui, "COLOR", lambda: False)
        plain.start()
        self.addCleanup(plain.stop)


class PaintTest(unittest.TestCase):
    def test_color_is_added_only_when_the_terminal_wants_it(self) -> None:
        with patch.object(ui, "COLOR", lambda: True):
            self.assertEqual(ui.paint("1", "hi"), "\033[1mhi\033[0m")
        with patch.object(ui, "COLOR", lambda: False):
            self.assertEqual(ui.paint("1", "hi"), "hi")


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


class PublicationCardTest(PlainTerminalTest):
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

    def test_the_whole_card_is_what_the_owner_approves(self) -> None:
        with captured() as output:
            ui.publication_card(
                _publication(
                    teaser="What seat pricing costs a small team",
                    useful_if="you price by seat",
                    not_useful_if="you sell hardware",
                    sample="First, count the seats.",
                )
            )
        self.assertEqual(
            output.getvalue(),
            f"\n{RULE}\n"
            "Pricing claim\n"
            "active · claim · 2 source memories · topic: pricing\n"
            "teaser: What seat pricing costs a small team\n"
            "useful if: you price by seat\n"
            "not useful if: you sell hardware\n"
            "free sample: First, count the seats.\n"
            "\n"
            "a bounded claim\n",
        )

    def test_who_it_is_for_and_the_sample_are_left_off_when_unwritten(self) -> None:
        with captured() as output:
            ui.publication_card(_publication())
        self.assertEqual(
            output.getvalue(),
            f"\n{RULE}\n"
            "Pricing claim\n"
            "active · claim · 2 source memories · topic: pricing\n"
            "\n"
            "a bounded claim\n",
        )

    def test_a_candidate_whose_source_moved_says_both(self) -> None:
        with captured() as output:
            ui.publication_card(
                _publication(source_changed_at="2026-07-31T00:00:00Z"), 2, 5
            )
        self.assertIn("\nCandidate 2 of 5 · source changed · claim", output.getvalue())

    def test_control_characters_in_the_free_surface_never_reach_the_terminal(
        self,
    ) -> None:
        # The teaser, the fit lines and the sample are text an agent drafted;
        # the owner reads them here before anyone else does.
        with captured() as output:
            ui.publication_card(
                _publication(
                    teaser="Tease\x1b[2J",
                    useful_if="fit\x9b2J",
                    not_useful_if="unfit\x07",
                    sample="sample\x7f\x80",
                )
            )
        text = output.getvalue()
        for character in ("\x1b", "\x9b", "\x07", "\x7f", "\x80"):
            self.assertNotIn(character, text)
        self.assertIn("teaser: Tease[2J\n", text)
        self.assertIn("\nuseful if: fit2J\n", text)
        self.assertIn("not useful if: unfit\n", text)
        self.assertIn("free sample: sample\n", text)

    def test_the_body_is_wrapped_at_78_columns(self) -> None:
        full = f"{'x' * 38} {'y' * 39}"
        self.assertEqual(len(full), 78)
        with captured() as output:
            ui.publication_card(_publication(content=f"{full} z"))
        self.assertTrue(output.getvalue().endswith(f"\n\n{full}\nz\n"))

    def test_only_the_title_stands_out_on_a_colour_terminal(self) -> None:
        with patch.object(ui, "COLOR", lambda: True), captured() as output:
            ui.publication_card(_publication(teaser="A teaser"))
        self.assertEqual(
            output.getvalue(),
            f"\n\033[2m{RULE}\033[0m\n"
            "\033[1mPricing claim\033[0m\n"
            "\033[2mactive · claim · 2 source memories · topic: pricing\033[0m\n"
            "\033[2mteaser: A teaser\033[0m\n"
            "\n"
            "a bounded claim\n",
        )


class PromptTest(PlainTerminalTest):
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

    def test_the_question_is_marked_and_shows_what_enter_will_choose(self) -> None:
        with patch("builtins.input", return_value="") as prompt:
            ui.ask("Choose", "k")
        self.assertEqual(prompt.call_args.args[0], "? Choose [k]: ")
        with patch("builtins.input", return_value="") as prompt:
            ui.ask("Choose")
        self.assertEqual(prompt.call_args.args[0], "? Choose: ")
        with (
            patch.object(ui, "COLOR", lambda: True),
            patch("builtins.input", return_value="") as prompt,
        ):
            ui.ask("Choose")
        self.assertEqual(prompt.call_args.args[0], "\033[36m?\033[0m Choose: ")

    def test_confirm_capitalises_the_answer_enter_gives(self) -> None:
        for default, hint in (
            (True, "? Import? [Y/n]: "),
            (False, "? Import? [y/N]: "),
        ):
            with self.subTest(default=default):
                with patch("builtins.input", return_value="") as prompt:
                    ui.confirm("Import?", default)
                self.assertEqual(prompt.call_args.args[0], hint)

    def test_a_long_answer_runs_to_the_end_of_input_not_the_first_blank_line(
        self,
    ) -> None:
        typed = "\n  It broke on launch.\n\nSteps: open, click, wait.\n\n"
        with patch.object(sys, "stdin", io.StringIO(typed)), captured() as output:
            answer = ui.ask_lines("Description")
        self.assertEqual(answer, "It broke on launch.\n\nSteps: open, click, wait.")
        # The question sits on a line of its own; the answer starts under it.
        self.assertEqual(output.getvalue(), "? Description:\n")


LABELS = {"claude": "Claude Code"}
NOTE = '"Pricing notes" was rewritten by Claude Code on 2026-08-02'


def _detail(**overrides: object) -> dict[str, object]:
    """One entry of `Store.flag_detail`: a memory that moved under a publication."""
    return {
        "memory_id": 7,
        "title": "Pricing notes",
        "source": "claude",
        "origin": "native",
        "updated_at": "2026-08-02T09:30:00+00:00",
        "diff": None,
    } | overrides


def _diff(approved: list[str], current: list[str]) -> list[str]:
    """The diff as `Store.flag_detail` builds it: hunks only, no file headers."""
    return list(
        difflib.unified_diff(
            approved, current, fromfile="approved", tofile="current", lineterm=""
        )
    )[2:]


class FlagTest(PlainTerminalTest):
    def test_the_note_names_the_memory_who_rewrote_it_and_the_day(self) -> None:
        self.assertEqual(ui.changed_memory_note(_detail(), LABELS), NOTE)

    def test_a_synthesis_rewrite_is_never_credited_to_the_source_it_filed_under(
        self,
    ) -> None:
        # The owner did not edit this memory in Claude Code; Lore's own
        # synthesis rewrote it, and the note must not suggest otherwise.
        self.assertEqual(
            ui.changed_memory_note(_detail(origin="automation"), LABELS),
            '"Pricing notes" was rewritten by Lore\'s synthesis on 2026-08-02',
        )
        # A hostile label on that source changes nothing: synthesis is named.
        self.assertEqual(
            ui.changed_memory_note(
                _detail(origin="automation"), {"claude": "Ev\x1b[2Jil\x07Feed\x9b"}
            ),
            '"Pricing notes" was rewritten by Lore\'s synthesis on 2026-08-02',
        )

    def test_control_characters_in_a_source_label_never_reach_the_note(
        self,
    ) -> None:
        # A feed's title becomes the source's label, and its owner chooses it.
        note = ui.changed_memory_note(_detail(), {"claude": "Ev\x1b[2Jil\x07Feed\x9b"})
        self.assertEqual(
            note, '"Pricing notes" was rewritten by Ev[2JilFeed on 2026-08-02'
        )

    def test_control_characters_in_an_unlabelled_source_name_never_reach_the_note(
        self,
    ) -> None:
        note = ui.changed_memory_note(_detail(source="s\x1b[2J\x07\x9bx"), LABELS)
        self.assertEqual(note, '"Pricing notes" was rewritten by s[2Jx on 2026-08-02')

    # Written by hand: difflib cannot put ESC into an @@ line, but a stored
    # diff is just a list of strings and the printer must not trust it.
    HOSTILE_DIFF = [
        "@@ -1 +1 @@\x1b[2J",
        "-old\x1b[2J\x07",
        "+b\x1b[2Jevil\x9b",
        " same\x07\x9b",
    ]

    def test_control_characters_in_diff_lines_never_reach_the_terminal(
        self,
    ) -> None:
        with captured() as output:
            ui.flag_diff(_detail(diff=self.HOSTILE_DIFF), LABELS)
        printed = output.getvalue()
        self.assertEqual(
            printed.splitlines(),
            [
                f"    ! {NOTE}",
                "      @@ -1 +1 @@[2J",
                "      -old[2J",
                "      +b[2Jevil",
                "       same",
            ],
        )
        for character in ("\x1b", "\x07", "\x9b"):
            self.assertNotIn(character, printed)

    def test_cleaned_diff_lines_keep_their_colour(self) -> None:
        with patch.object(ui, "COLOR", lambda: True), captured() as output:
            ui.flag_diff(_detail(diff=self.HOSTILE_DIFF), LABELS)
        lines = output.getvalue().splitlines()
        self.assertEqual(
            lines[1:],
            [
                "\033[2m      @@ -1 +1 @@[2J\033[0m",
                "\033[31m      -old[2J\033[0m",
                "\033[32m      +b[2Jevil\033[0m",
                "\033[2m       same\033[0m",
            ],
        )
        for line in lines:
            # Exactly the two ESCs paint() adds; nothing else gets through.
            self.assertEqual(line.count("\x1b"), 2)
            self.assertNotIn("\x07", line)
            self.assertNotIn("\x9b", line)

    def test_a_source_with_no_label_is_named_as_stored(self) -> None:
        self.assertEqual(
            ui.changed_memory_note(_detail(source="folder-1a2b3c4d"), LABELS),
            '"Pricing notes" was rewritten by folder-1a2b3c4d on 2026-08-02',
        )

    def test_control_characters_in_the_memory_title_never_reach_the_note(
        self,
    ) -> None:
        note = ui.changed_memory_note(_detail(title="Bad\x1b[2J\x9b\x7f"), LABELS)
        self.assertEqual(note, '"Bad[2J" was rewritten by Claude Code on 2026-08-02')

    def test_a_flag_with_no_snapshot_says_so_instead_of_showing_a_diff(self) -> None:
        with captured() as output:
            ui.flag_diff(_detail(), LABELS)
        self.assertEqual(
            output.getvalue(),
            f"    ! {NOTE}\n"
            "      no snapshot from before this feature shipped — "
            "re-approve to start tracking diffs\n",
        )

    def test_a_snapshot_with_no_changed_lines_shows_the_note_alone(self) -> None:
        # A recorded snapshot is a list even when it is empty, so this is not
        # the "nothing to compare against" case above.
        with captured() as output:
            ui.flag_diff(_detail(diff=[]), LABELS)
        self.assertEqual(output.getvalue(), f"    ! {NOTE}\n")

    def test_the_diff_shows_what_left_and_what_arrived(self) -> None:
        diff = _diff(
            ["Seats cost 5 each.", "Billed monthly."],
            ["Seats cost 7 each.", "Billed monthly."],
        )
        self.assertTrue(diff[0].startswith("@@"))
        with captured() as output:
            ui.flag_diff(_detail(diff=diff), LABELS)
        self.assertEqual(
            output.getvalue(),
            f"    ! {NOTE}\n"
            "      @@ -1,2 +1,2 @@\n"
            "      -Seats cost 5 each.\n"
            "      +Seats cost 7 each.\n"
            "       Billed monthly.\n",
        )

    # A markdown rule, a command-line flag and a line starting with "++":
    # each one's diff line starts with "---" or "+++" once it gets its marker.
    DASHES_APPROVED = ["title", "---", "body", "--flag"]
    DASHES_CURRENT = ["title", "body", "++x"]

    def test_lines_starting_with_dashes_or_pluses_are_shown_as_changes(
        self,
    ) -> None:
        with captured() as output:
            ui.flag_diff(
                _detail(diff=_diff(self.DASHES_APPROVED, self.DASHES_CURRENT)),
                LABELS,
            )
        self.assertEqual(
            output.getvalue().splitlines(),
            [
                f"    ! {NOTE}",
                "      @@ -1,4 +1,3 @@",
                "       title",
                "      ----",
                "       body",
                "      ---flag",
                "      +++x",
            ],
        )

    def test_lines_starting_with_dashes_or_pluses_are_coloured_as_changes(
        self,
    ) -> None:
        with patch.object(ui, "COLOR", lambda: True), captured() as output:
            ui.flag_diff(
                _detail(diff=_diff(self.DASHES_APPROVED, self.DASHES_CURRENT)),
                LABELS,
            )
        self.assertEqual(
            output.getvalue().splitlines()[1:],
            [
                "\033[2m      @@ -1,4 +1,3 @@\033[0m",
                "\033[2m       title\033[0m",
                "\033[31m      ----\033[0m",
                "\033[2m       body\033[0m",
                "\033[31m      ---flag\033[0m",
                "\033[32m      +++x\033[0m",
            ],
        )

    def test_every_hunk_header_is_shown(self) -> None:
        approved = [f"line {n}" for n in range(1, 11)]
        current = ["first", *approved[1:9], "last"]
        with captured() as output:
            ui.flag_diff(_detail(diff=_diff(approved, current)), LABELS)
        lines = output.getvalue().splitlines()
        self.assertEqual(
            [line for line in lines if line.lstrip().startswith("@@")],
            ["      @@ -1,4 +1,4 @@", "      @@ -7,4 +7,4 @@"],
        )
        self.assertNotIn("      --- approved", lines)
        self.assertNotIn("      +++ current", lines)
        self.assertIn("      -line 10", lines)
        self.assertIn("      +last", lines)

    def test_removed_lines_are_red_and_added_lines_green(self) -> None:
        diff = _diff(
            ["Seats cost 5 each.", "Billed monthly."],
            ["Seats cost 7 each.", "Billed monthly."],
        )
        with patch.object(ui, "COLOR", lambda: True), captured() as output:
            ui.flag_diff(_detail(diff=diff), LABELS)
            ui.flag_diff(_detail(), LABELS)
        self.assertEqual(
            output.getvalue().splitlines(),
            [
                f"\033[33m    ! {NOTE}\033[0m",
                "\033[2m      @@ -1,2 +1,2 @@\033[0m",
                "\033[31m      -Seats cost 5 each.\033[0m",
                "\033[32m      +Seats cost 7 each.\033[0m",
                "\033[2m       Billed monthly.\033[0m",
                f"\033[33m    ! {NOTE}\033[0m",
                "\033[2m      no snapshot from before this feature shipped — "
                "re-approve to start tracking diffs\033[0m",
            ],
        )


class OutputTest(PlainTerminalTest):
    def said(self, say: object, *args: str) -> tuple[str, str]:
        """What a call put on stdout and on stderr."""
        errors = io.StringIO()
        with captured() as output, redirect_stderr(errors):
            say(*args)  # type: ignore[operator]
        return output.getvalue(), errors.getvalue()

    def test_a_warning_goes_to_stderr_so_piped_output_stays_clean(self) -> None:
        self.assertEqual(self.said(ui.warn, "careful"), ("", "! careful\n"))

    def test_everything_else_goes_to_stdout(self) -> None:
        for say, args, expected in (
            (ui.success, ("done",), "✓ done\n"),
            (ui.muted, ("an aside",), "an aside\n"),
            (ui.heading, ("Sources",), "\nSources\n"),
            (ui.logo, (), "◆ Lore your context, under your control\n"),
        ):
            with self.subTest(say=say.__name__):
                self.assertEqual(self.said(say, *args), (expected, ""))

    def test_each_kind_of_line_has_its_own_colour(self) -> None:
        with patch.object(ui, "COLOR", lambda: True):
            for say, args, expected in (
                (ui.success, ("done",), "\033[32m✓ done\033[0m\n"),
                (ui.muted, ("an aside",), "\033[2man aside\033[0m\n"),
                (ui.heading, ("Sources",), "\n\033[1mSources\033[0m\n"),
                (
                    ui.logo,
                    (),
                    "\033[1;36m◆ Lore\033[0m "
                    "\033[2myour context, under your control\033[0m\n",
                ),
            ):
                with self.subTest(say=say.__name__):
                    self.assertEqual(self.said(say, *args), (expected, ""))
            self.assertEqual(
                self.said(ui.warn, "careful"), ("", "\033[33m! careful\033[0m\n")
            )


class MemoryCardTest(PlainTerminalTest):
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

    def test_the_whole_card_says_where_a_memory_came_from(self) -> None:
        with captured() as output:
            ui.memory_card(_memory(source_path="notes/pricing.md"))
        self.assertEqual(
            output.getvalue(),
            f"\n{RULE}\n"
            "A lesson\n"
            "private · test · general · notes/pricing.md\n"
            "\n"
            "a lesson body\n",
        )
        with patch.object(ui, "COLOR", lambda: True), captured() as output:
            ui.memory_card(_memory())
        self.assertEqual(
            output.getvalue(),
            f"\n\033[2m{RULE}\033[0m\n"
            "\033[1mA lesson\033[0m\n"
            "\033[2mprivate · test · general\033[0m\n"
            "\n"
            "a lesson body\n",
        )

    def test_a_body_is_cut_only_past_1800_characters(self) -> None:
        with captured() as output:
            ui.memory_card(_memory(content="x" * 1800))
        self.assertEqual(output.getvalue().count("x"), 1800)
        self.assertNotIn("…", output.getvalue())
        with captured() as output:
            ui.memory_card(_memory(content="x" * 1801))
        self.assertEqual(output.getvalue().count("x"), 1800)
        self.assertTrue(output.getvalue().endswith("x\n…\n"))

    def test_a_cut_that_lands_on_a_line_break_leaves_no_gap_before_the_mark(
        self,
    ) -> None:
        with captured() as output:
            ui.memory_card(_memory(content="x" * 1799 + "\n" + "y" * 10))
        text = output.getvalue()
        self.assertEqual(text.count("x"), 1799)
        self.assertNotIn("y", text)
        self.assertTrue(text.endswith("x\n…\n"))

    def test_the_body_is_wrapped_at_78_columns(self) -> None:
        full = f"{'x' * 38} {'y' * 39}"
        with captured() as output:
            ui.memory_card(_memory(content=f"{full} z"))
        self.assertTrue(output.getvalue().endswith(f"\n\n{full}\nz\n"))

    def test_eight_bit_control_characters_never_reach_the_terminal(self) -> None:
        # 0x9b is an escape sequence's opening with no ESC in it, so removing
        # ESC alone is not enough; 0x7f to 0x9f all go, and 0xa0, a space that
        # does not break, is ordinary text and stays.
        memory = _memory(
            title="Bad\x9b2J\x7f price\xa0list",
            source="src\x80",
            project="proj\x9f",
            source_path="notes\x9b.md",
            content="Body\x7f text\x9b\x80\x9f",
        )
        with captured() as output:
            ui.memory_card(memory)
        text = output.getvalue()
        for character in ("\x7f", "\x80", "\x9b", "\x9f"):
            self.assertNotIn(character, text)
        self.assertEqual(
            text,
            f"\n{RULE}\n"
            "Bad2J price\xa0list\n"
            "private · src · proj · notes.md\n"
            "\n"
            "Body text\n",
        )


SEPARATORS = ("\x0b", "\x0c", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029")


class CardShapeTest(PlainTerminalTest):
    """CLI-015: a card looks like the text the owner approves. A tab is spacing, and
    only a newline starts a line."""

    def test_a_tab_is_spacing_in_every_field_of_both_cards(self) -> None:
        with captured() as output:
            ui.memory_card(_memory(title="t\tone", source="s\tsrc", content="b\tbody"))
            ui.publication_card(
                _publication(
                    title="p\ttitle",
                    topic="to\tpic",
                    teaser="te\tase",
                    useful_if="u\tif",
                    not_useful_if="n\tif",
                    sample="sa\tmple",
                    content="c\tbody",
                )
            )
        text = output.getvalue()
        self.assertNotIn("\t", text)
        for field in (
            "t one",
            "s src",
            "b body",
            "p title",
            "to pic",
            "te ase",
            "u if",
            "n if",
            "sa mple",
            "c body",
        ):
            first, second = field.split(" ")
            with self.subTest(field=field):
                self.assertRegex(text, rf"{first} +{second}")

    def test_only_a_newline_starts_a_line_in_a_body(self) -> None:
        body = "one" + "".join(f"{c}x{n}" for n, c in enumerate(SEPARATORS))
        for card in (
            lambda: ui.memory_card(_memory(content=body)),
            lambda: ui.publication_card(_publication(content=body)),
        ):
            with self.subTest(card=card), captured() as output:
                card()
            text = output.getvalue()
            for character in SEPARATORS:
                self.assertNotIn(character, text)
            self.assertEqual(text.splitlines()[-1], "onex0x1x2x3x4x5x6x7")

    def test_a_carriage_return_joins_a_title_and_breaks_a_body(self) -> None:
        with captured() as output:
            ui.memory_card(_memory(title="a\rb", content="c\rd"))
        lines = output.getvalue().splitlines()
        self.assertIn("ab", lines)
        self.assertEqual(lines[-2:], ["c", "d"])


if __name__ == "__main__":
    unittest.main()
