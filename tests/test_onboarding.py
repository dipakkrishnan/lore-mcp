"""Behaviour of the onboarding path: progress, checkpoint, and hand-offs.

Onboarding spans a CLI import, an agent-run interview, and a scheduled synthesis
install. These tests pin the parts the owner sees when that span is interrupted:
where they are, what to run next, and what a broken hand-off tells them.
"""

from __future__ import annotations

import json
import os
import stat
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from lore import automation, blueprint, onboarding
from lore.cli import manual, onboarding_save, onboarding_show
from lore.cli import profile as profile_command
from lore.cli import review, setup, status
from lore.store import Store


def _blueprint_input() -> dict:
    return {
        "version": 1,
        "name": "Ada",
        "persona": "professor",
        "topic_outline": ["distributed systems"],
        "storytelling": "Claim plus evidence.",
    }


def _profile_answers() -> dict:
    return {
        "role": "maintainer",
        "domains": "developer tools",
        "executor": "codex",
        "cadence": "daily",
        "hour": 21,
    }


class OnboardingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        os.environ["LORE_HOME"] = str(root / "lore")
        os.environ["CLAUDE_HOME"] = str(root / "claude")
        os.environ["CODEX_HOME"] = str(root / "codex")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _run(self, function, *args) -> str:
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(function(*args), 0)
        return output.getvalue()

    def _write(self, name: str, data: object) -> Path:
        path = Path(self.tmp.name) / name
        path.write_text(json.dumps(data) if not isinstance(data, str) else data)
        return path

    def _import_one_memory(self) -> None:
        memory = Path(os.environ["CODEX_HOME"]) / "memories/MEMORY.md"
        memory.parent.mkdir(parents=True)
        memory.write_text("# Preference\n\nKeep setup short.")
        self._run(setup, True)

    # --- progress and the next step -------------------------------------------------

    def test_status_names_the_next_onboarding_step(self) -> None:
        """Status is where an interrupted owner looks; it must say what is left."""
        fresh = self._run(status)
        self.assertIn("Onboarding", fresh)
        self.assertIn("lore setup", fresh)

        self._import_one_memory()
        imported = self._run(status)
        self.assertIn("Onboard me to Lore", imported)
        self.assertIn("1 memory ·", imported)

        blueprint.apply(self._write("blueprint.json", _blueprint_input()))
        # The blueprint is only half the interview: the profile still steers synthesis.
        self.assertIn("Onboard me to Lore", self._run(status))

        automation.save_profile(_profile_answers())
        self.assertIn("lore review", self._run(status))

        with Store() as store:
            for memory in store.pending():
                store.set_status(memory.id, "private")
        self.assertIn("complete", self._run(status).lower())

    def test_onboarding_show_lists_every_step_with_its_evidence(self) -> None:
        """Each step states what proves it done, so the owner can trust the summary."""
        self._import_one_memory()
        blueprint.apply(self._write("blueprint.json", _blueprint_input()))

        report = self._run(onboarding_show)
        self.assertIn("Import agent memories", report)
        self.assertIn("1 memory", report)
        self.assertIn("Capture your lore blueprint", report)
        self.assertIn("Professor Ada", report)
        self.assertIn("Draft your synthesis profile", report)
        self.assertIn("Classify", report)
        self.assertIn("Onboard me to Lore", report)

    def test_onboarding_show_works_before_anything_exists(self) -> None:
        report = self._run(onboarding_show)
        self.assertIn("lore setup", report)
        # A step nothing has reached yet must not read as work already done.
        self.assertIn("nothing imported yet", report)

    def test_an_unreadable_checkpoint_is_reported_where_the_owner_looks(self) -> None:
        """The checkpoint backs no step of its own, so its failure must reach the next step."""
        self._import_one_memory()
        onboarding.checkpoint_path().write_text("{ truncated")

        report = self._run(onboarding_show)
        self.assertIn("Delete", report)
        self.assertIn(str(onboarding.checkpoint_path()), report)
        self.assertIn("Delete", self._run(status))

    # --- the checkpoint -------------------------------------------------------------

    def test_checkpoint_merges_answers_as_they_are_given(self) -> None:
        """The interview records one answer at a time and must never lose earlier ones."""
        onboarding.save_checkpoint({"phase1_done": True})
        merged = onboarding.save_checkpoint({"role": "maintainer  of\nlore"})

        self.assertTrue(merged["phase1_done"])
        self.assertEqual(merged["role"], "maintainer of lore")
        self.assertEqual(onboarding.load_checkpoint(), merged)

    def test_checkpoint_is_owner_private(self) -> None:
        """It holds draft personal context before the owner has approved anything."""
        onboarding.save_checkpoint({"role": "maintainer"})
        path = onboarding.checkpoint_path()
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)

    def test_checkpoint_rejects_unknown_or_malformed_answers(self) -> None:
        """A bad answer fails where it was given, not at the end of the interview."""
        with self.assertRaisesRegex(ValueError, "unexpected onboarding field"):
            onboarding.save_checkpoint({"session_notes": "transcript"})
        with self.assertRaisesRegex(ValueError, "phase1_done"):
            onboarding.save_checkpoint({"phase1_done": "yes"})
        with self.assertRaisesRegex(ValueError, "cadence"):
            onboarding.save_checkpoint({"cadence": "monthly"})
        with self.assertRaisesRegex(ValueError, "hour"):
            onboarding.save_checkpoint({"hour": 99})
        with self.assertRaisesRegex(ValueError, "claude.*codex"):
            onboarding.save_checkpoint({"executor": "gemini"})
        # A rejected answer leaves the accepted ones intact.
        self.assertEqual(onboarding.load_checkpoint(), {})

    def test_checkpoint_command_accepts_a_file_or_stdin(self) -> None:
        report = self._run(onboarding_save, str(self._write("answers.json", {"role": "maintainer"})))
        self.assertIn("role", report)
        with patch("sys.stdin", StringIO(json.dumps({"domains": "developer tools"}))):
            self._run(onboarding_save, "-")
        self.assertEqual(
            onboarding.load_checkpoint(), {"role": "maintainer", "domains": "developer tools"}
        )

    def test_checkpoint_feeds_lore_profile_without_leaking_state(self) -> None:
        """The documented hand-off: the checkpoint file is what `lore profile` reads."""
        self._run(onboarding_save, str(self._write("answers.json", {"phase1_done": True})))
        self._run(onboarding_save, str(self._write("more.json", _profile_answers())))

        with (
            patch("lore.automation.install_task", return_value=Path("task")),
            patch("lore.automation.remove_task"),
        ):
            self._run(profile_command, str(onboarding.checkpoint_path()))

        saved = json.loads(automation.profile_path().read_text())
        self.assertEqual(saved["role"], "maintainer")
        self.assertNotIn("phase1_done", saved)

    def test_a_corrupt_artifact_never_breaks_the_way_back_in(self) -> None:
        """Status and progress are how an owner recovers; a bad file must not crash them."""
        self._import_one_memory()
        for path in (
            onboarding.checkpoint_path(),
            automation.profile_path(),
            blueprint.blueprint_path(),
        ):
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            path.write_text("{ truncated")

        report = self._run(onboarding_show)
        self.assertIn("unreadable", report)
        self.assertIn("Onboard me to Lore", report)
        self.assertIn("Onboarding", self._run(status))

    def test_saving_over_a_corrupt_checkpoint_says_how_to_recover(self) -> None:
        onboarding.checkpoint_path().parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        onboarding.checkpoint_path().write_text("{ truncated")
        with self.assertRaisesRegex(ValueError, "delete it to start the interview over"):
            onboarding.save_checkpoint({"role": "maintainer"})

    def test_empty_answers_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot be empty"):
            onboarding.save_checkpoint({})

    def test_review_is_not_offered_when_there_is_nothing_to_classify(self) -> None:
        """An empty library must not end onboarding on a command that does nothing."""
        blueprint.apply(self._write("blueprint.json", _blueprint_input()))
        automation.save_profile(_profile_answers())
        with Store() as store:
            store.set_setting("sources", ["codex"])

        _, next_step = onboarding.progress()
        self.assertEqual(next_step, "")

    # --- the last step: classification ----------------------------------------------

    def _seed(self, *titles: str) -> None:
        with Store() as store:
            for title in titles:
                store.put(
                    source="test",
                    origin="native",
                    source_path=title,
                    source_key=title,
                    fingerprint=title,
                    title=title,
                    content=f"{title} about deployment",
                )

    def _review(self, *choices: str) -> str:
        output = StringIO()
        with patch("lore.cli.ask", side_effect=list(choices)), redirect_stdout(output):
            self.assertEqual(review(), 0)
        return output.getvalue()

    def test_first_review_explains_what_the_choices_mean(self) -> None:
        """Onboarding ends on a disclosure decision offered as four unlabelled letters."""
        self._seed("First lesson", "Second lesson")
        report = self._review("p", "p")

        self.assertIn("stays on this machine", report)
        self.assertIn("answer questions over MCP", report)
        self.assertIn("Nothing is exposed until you mark it external", report)
        # Orientation, not a per-memory banner.
        self.assertEqual(report.count("Nothing is exposed until you mark it external"), 1)

    def test_marking_something_external_hands_off_to_pricing(self) -> None:
        self._seed("Public lesson")
        self.assertIn("lore price", self._review("e"))

    def test_a_private_only_review_does_not_talk_about_price(self) -> None:
        self._seed("Private lesson")
        self.assertNotIn("lore price", self._review("p"))

    def test_quitting_early_still_reports_what_was_exposed(self) -> None:
        """Quitting mid-queue must not swallow the consequence of a decision already made."""
        self._seed("Public lesson", "Untouched lesson")
        self.assertIn("lore price", self._review("e", "q"))

    # --- hand-off quality -----------------------------------------------------------

    def test_profile_file_problems_read_as_instructions(self) -> None:
        with self.assertRaisesRegex(OSError, "profile file not found"):
            profile_command(str(Path(self.tmp.name) / "missing.json"))
        with self.assertRaisesRegex(ValueError, "profile file is not valid JSON"):
            profile_command(str(self._write("bad.json", "{not json")))
        with self.assertRaisesRegex(ValueError, "profile must be a JSON object"):
            profile_command(str(self._write("list.json", ["role"])))

    def test_unknown_executor_names_the_supported_agents(self) -> None:
        with self.assertRaisesRegex(ValueError, "claude.*codex"):
            automation.save_profile({**_profile_answers(), "executor": "gemini"})

    def test_finishing_the_profile_points_at_review(self) -> None:
        """Installing the schedule is not the end of onboarding — classification is."""
        with (
            patch("lore.automation.install_task", return_value=Path("task")),
            patch("lore.automation.remove_task"),
        ):
            report = self._run(profile_command, str(self._write("p.json", _profile_answers())))
        self.assertIn("lore review", report)

    def test_profile_without_a_schedule_still_points_at_review(self) -> None:
        """`--no-schedule` skips automation, not the owner's next decision."""
        report = self._run(profile_command, str(self._write("p.json", _profile_answers())), False)
        self.assertIn("lore review", report)

    def test_manual_documents_the_onboarding_commands(self) -> None:
        """The manual is where an owner mid-onboarding looks for the way back in."""
        report = self._run(manual)
        self.assertIn("lore onboarding", report)

    def test_setup_without_agent_memories_says_so(self) -> None:
        """An empty import must not read as success and must still offer the next step."""
        report = self._run(setup, True)
        self.assertIn("No agent memory files", report)
        self.assertIn("Onboard me to Lore", report)


if __name__ == "__main__":
    unittest.main()
