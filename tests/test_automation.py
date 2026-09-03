"""Tests for `lore.automation` — the profile, the synthesis prompt, and scheduling.

Two things matter here. The profile file is reused by the onboarding checkpoint,
so only profile fields may be persisted; and the prompt hands execution to a
native agent, so what it says is the whole contract with that agent.
"""

from __future__ import annotations

import json
import os
import stat
import sys
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch

from helpers import LoreTestCase, automation_profile

from lore import automation
from lore import store as store_module


class ProfileTest(LoreTestCase):
    def test_the_profile_and_prompt_live_under_lore_home_and_are_owner_only(
        self,
    ) -> None:
        automation.save_profile(automation_profile())
        self.assertEqual(
            automation.profile_path(), self.lore_home / "automation/profile.json"
        )
        self.assertEqual(
            automation.prompt_path(), self.lore_home / "automation/synthesis-prompt.md"
        )
        for path in (automation.profile_path(), automation.prompt_path()):
            with self.subTest(path=path.name):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(
            stat.S_IMODE(automation.profile_path().parent.stat().st_mode), 0o700
        )

    def test_save_profile_drops_checkpoint_only_fields(self) -> None:
        # The onboarding skill carries its own resume state in this file; that
        # state must never leak into the profile the synthesis prompt reads.
        automation.save_profile(
            {"role": "maintainer", "executor": "codex", "phase1_done": True}
        )
        saved = json.loads(automation.profile_path().read_text())
        self.assertEqual(saved["role"], "maintainer")
        self.assertEqual(saved["executor"], "codex")
        self.assertNotIn("phase1_done", saved)

    def test_text_fields_are_collapsed_and_type_checked(self) -> None:
        profile = automation.save_profile(
            {
                "executor": "codex",
                "role": "software\nengineer",
                "model": None,
                "hour": None,
            }
        )
        self.assertEqual(profile["role"], "software engineer")
        # None means "not set", not "set to null".
        self.assertNotIn("model", profile)
        self.assertNotIn("hour", profile)
        with self.assertRaisesRegex(ValueError, "valid string"):
            automation.save_profile({"executor": "codex", "role": ["a", "list"]})

    def test_cadence_and_hour_are_validated(self) -> None:
        for field, value in (
            ("cadence", "monthly"),
            ("cadence", []),
            ("hour", "9"),
            ("hour", 24),
            ("hour", -1),
            ("hour", True),  # bool is an int in Python; hour 1 is not what was meant
        ):
            with self.subTest(field=field, value=value):
                with self.assertRaisesRegex(ValueError, field):
                    automation.save_profile({"executor": "codex", field: value})

    def test_a_profile_without_an_executor_saves_but_cannot_schedule(self) -> None:
        profile = automation.save_profile({"role": "maintainer", "executor": ""})
        self.assertEqual(profile.get("executor", ""), "")
        with self.assertRaisesRegex(ValueError, "no-schedule"):
            automation.install(profile)
        with self.assertRaisesRegex(ValueError, "unknown executor"):
            automation.save_profile({"executor": "cursor"})

    def test_the_agent_enum_renders_as_its_wire_value(self) -> None:
        self.assertEqual(f"{automation.Agent.CLAUDE}", "claude")


class PromptTest(LoreTestCase):
    def test_the_prompt_states_the_thesis_and_hands_off_execution(self) -> None:
        prompt = automation.build_prompt(automation_profile())
        for expected in (
            "topic-based memory library",
            "perform a cold-start pass",
            "delegate coherent slices",
            "/INDEX.md",
            "failed launches",
            "lore search --status private",
            "-m lore sync --source automation",
            "prior agent sessions",
            "You never publish and never change disclosure",
            "Worth publishing",
            "What earns a place in memory",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, prompt)

    def test_later_runs_add_only_net_new_claims_named_by_the_claim(self) -> None:
        for cadence, window in (("daily", "last day"), ("weekly", "last week")):
            prompt = automation.build_prompt(
                {**automation_profile(), "cadence": cadence}
            )
            with self.subTest(cadence=cadence):
                self.assertIn(window, prompt)
        for expected in (
            "search the library for it",
            "write only what\nis net new",
            "never by date, run, or the word",
            "`deep-review-wedge.md`",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, prompt)

    def test_the_readable_statuses_are_derived_from_the_store(self) -> None:
        # Hardcoding the status model here is how the prompt goes stale after a
        # schema change; deriving it makes that impossible.
        prompt = automation.build_prompt({"role": "maintainer"})
        for status in store_module.STATUSES:
            with self.subTest(status=status):
                if status == "discarded":
                    self.assertNotIn(f"--status {status}", prompt)
                else:
                    self.assertIn(f"search --status {status} --limit 0 --json", prompt)

    def test_the_prompt_ignores_the_blueprint(self) -> None:
        # The blueprint captures shape; the profile steers synthesis. Leaking one
        # into the other is what keeping them separate artifacts is for.
        from lore import blueprint

        path = self.lore_home / "blueprint-input.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "name": "Ada",
                    "persona": "professor",
                    "topic_outline": ["distributed systems"],
                    "storytelling": "Short claim-plus-evidence notes.",
                }
            )
        )
        blueprint.apply(path)
        prompt = automation.build_prompt(automation_profile(model="", domains=""))
        for marker in (
            "organizing_axis",
            "topic_outline",
            "section_labels",
            "depth_default",
            "professor",
            "distributed systems",
        ):
            with self.subTest(marker=marker):
                self.assertNotIn(marker, prompt)

    def test_the_saved_prompt_matches_the_built_one(self) -> None:
        profile = automation.save_profile(automation_profile())
        self.assertEqual(
            automation.prompt_path().read_text(), automation.build_prompt(profile)
        )


class InstallTest(LoreTestCase):
    def test_install_rejects_an_invalid_hour_from_a_saved_profile(self) -> None:
        # Profiles are normally validated by save_profile(), but install() also
        # reads persisted JSON and must not turn malformed data into a schedule.
        for hour in ("9", True, -1, 24):
            with self.subTest(hour=hour):
                with self.assertRaisesRegex(ValueError, "profile hour"):
                    automation.install({"executor": "codex", "hour": hour})

    def test_a_codex_schedule_hands_off_with_no_claude_specific_grants(self) -> None:
        profile = automation.save_profile(automation_profile())
        with patch("lore.automation.remove_task") as remove:
            definition = automation.install(profile).read_text()
        # Installing one executor retires the other, so a cadence change can
        # never leave two schedules writing the same library.
        self.assertEqual(remove.call_args.args[0].agent, automation.Agent.CLAUDE)
        self.assertIn('id = "lore-memory-synthesis"', definition)
        self.assertIn('rrule = "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0"', definition)
        self.assertIn('model = "gpt-test"', definition)
        self.assertIn('execution_environment = "local"', definition)
        self.assertTrue(
            tomllib.loads(definition)["prompt"].endswith(
                automation.build_prompt(profile)
            )
        )

        with (
            patch("lore.automation.remove_task"),
            patch("lore.automation.install_task", return_value=Path("task")) as install,
        ):
            automation.install(profile)
        task = install.call_args.args[0]
        self.assertEqual(task.allowed_tools, ())
        self.assertEqual(task.environment, ())
        self.assertEqual(task.add_dirs, ())

    def test_a_claude_schedule_carries_the_tools_dirs_and_environment_it_needs(
        self,
    ) -> None:
        profile = automation.save_profile(
            automation_profile(executor="claude", model="opus")
        )
        with (
            patch("lore.automation.remove_task") as remove,
            patch("lore.automation.install_task", return_value=Path("task")) as install,
        ):
            automation.install(profile)
        self.assertEqual(remove.call_args.args[0].agent, automation.Agent.CODEX)
        task = install.call_args.args[0]
        self.assertEqual(task.agent, automation.Agent.CLAUDE)
        self.assertEqual(task.prompt_path, automation.prompt_path())
        self.assertEqual(task.model, "opus")
        self.assertEqual(task.cwd, self.lore_home)
        self.assertEqual(
            task.before,
            (
                "env",
                f"LORE_HOME={self.lore_home}",
                sys.executable,
                "-m",
                "lore",
                "sync",
            ),
        )
        self.assertEqual(
            task.allowed_tools, ("Read", "Glob", "Grep", "Write", "Bash", "Agent")
        )
        self.assertEqual(task.add_dirs, (self.claude_home, self.codex_home))
        environment = dict(task.environment)
        self.assertEqual(environment["LORE_HOME"], os.environ["LORE_HOME"])
        # The scheduled task runs without a login shell; `lore` must still resolve.
        self.assertIn(str(Path(sys.executable).parent), environment["PATH"])

    def test_the_defaults_apply_when_the_profile_is_nearly_empty(self) -> None:
        profile = automation.save_profile({"executor": "codex"})
        with (
            patch("lore.automation.remove_task"),
            patch("lore.automation.install_task", return_value=Path("task")) as install,
        ):
            automation.install(profile)
        task = install.call_args.args[0]
        self.assertEqual(task.cadence, "daily")
        self.assertEqual(task.hour, 21)
        self.assertEqual(task.model, "")


class ScheduleFailureTest(LoreTestCase):
    def test_schedule_failure_maps_each_cause_to_an_actionable_fix(self) -> None:
        # windup raises each of these as OSError.
        expected_os_fixes = {
            "Claude local scheduling currently requires macOS": '"executor": "codex"',
            "Claude CLI is not installed": "which claude",
            "launchctl bootstrap failed": "launchctl print",
            # Real launchd stderr never says "launchctl".
            "Bootstrap failed: 5: Input/output error": "launchctl print",
            "disk quota exceeded": "Resolve the error above",
        }
        for reason, fix in expected_os_fixes.items():
            with self.subTest(reason=reason):
                report = automation.schedule_failure(
                    automation.Agent.CLAUDE, OSError(reason)
                )
                self.assertIn(reason, report)
                self.assertIn(fix, report)
                # Every failure names the command that finishes the install by hand.
                self.assertIn(automation.retry_command(), report)

        # windup raises these as ValueError — the more common case, and the reason
        # the caller must widen its `except` clause, not just this function's markers.
        expected_value_fixes = {
            "task prompt does not exist: /home/.lore/automation/synthesis-prompt.md": (
                "synthesis prompt file is missing"
            ),
            "task hour must be between 0 and 23": '"hour" field must be 0-23',
        }
        for reason, fix in expected_value_fixes.items():
            with self.subTest(reason=reason):
                report = automation.schedule_failure(
                    automation.Agent.CLAUDE, ValueError(reason)
                )
                self.assertIn(reason, report)
                self.assertIn(fix, report)
                self.assertIn(automation.retry_command(), report)

        blank = automation.schedule_failure(automation.Agent.CODEX, OSError())
        self.assertIn("Codex schedule was not installed", blank)
        self.assertIn("the local scheduler rejected the task", blank)

    def test_a_non_agent_executor_argument_does_not_crash_the_formatter(self) -> None:
        # A saved profile with no executor ("") fails Agent("") before an Agent
        # instance exists; the caller passes the raw string straight through.
        report = automation.schedule_failure("", ValueError("'' is not a valid Agent"))
        self.assertIn("'' is not a valid Agent", report)
        self.assertIn(automation.retry_command(), report)


if __name__ == "__main__":
    unittest.main()
