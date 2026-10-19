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
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import tomllib
from helpers import LoreTestCase, automation_profile, captured

from lore import automation, cli
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


class PromptTest(LoreTestCase):
    def test_the_prompt_names_its_commands_and_the_no_publish_rule(self) -> None:
        prompt = automation.build_prompt(automation_profile())
        for expected in (
            "/INDEX.md",
            "lore search --status private",
            "-m lore sync --source automation",
            "You never publish and never change disclosure",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, prompt)

    def test_each_cadence_reads_back_its_own_window(self) -> None:
        for cadence, window in (("daily", "last day"), ("weekly", "last week")):
            prompt = automation.build_prompt(
                {**automation_profile(), "cadence": cadence}
            )
            with self.subTest(cadence=cadence):
                self.assertIn(window, prompt)

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

    def test_both_writers_hold_the_library_to_one_set_of_rules(self) -> None:
        # AUT-005: the scheduled prompt and the desktop's reading of a connected app
        # (through `lore memory rules`) must never drift apart.
        prompt = automation.build_prompt(automation_profile())
        self.assertIn(automation.RULES, prompt)
        with captured() as output:
            self.assertEqual(cli.main(["memory", "rules"]), 0)
        self.assertEqual(output.getvalue(), automation.RULES)
        for rule in (
            "## What earns a place in memory",
            "When unsure, it is work.",
            "Write work under `work/`",
            "never suggest it for publishing",
            "no\n  company, people, client, or product names",
            '"Worth publishing" note',
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, automation.RULES)

    def test_the_scheduled_prompt_reads_connected_apps_too(self) -> None:
        self.assertIn(
            "what the owner's\nconnected apps brought in",
            automation.build_prompt(automation_profile()),
        )

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
                "--record-job",
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

    def test_the_pre_run_hook_stays_one_execable_command(self) -> None:
        """The scheduler joins `before` with shlex into a single command line,
        so a shell operator would be quoted into a literal argument and the
        scheduled run would break. Opening the job row must not reach for one.
        """
        profile = automation.save_profile(automation_profile(executor="claude"))
        with (
            patch("lore.automation.remove_task"),
            patch("lore.automation.install_task", return_value=Path("task")) as install,
        ):
            automation.install(profile)
        before = install.call_args.args[0].before
        self.assertEqual(before[-2:], ("sync", "--record-job"))
        for operator in ("&&", ";", "|", "||", "&"):
            self.assertNotIn(operator, before)

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


def local(day: int, hour: int, minute: int = 0) -> datetime:
    """A moment on this Mac's clock in October 2026; the 12th is a Monday."""
    return datetime(2026, 10, day, hour, minute).astimezone()


class LoreScheduleTest(LoreTestCase):
    """AUT-006: the app runs the schedule itself while it is open."""

    def routines(self, now: datetime) -> automation.Routines:
        return automation.Routines(clock=lambda: now)

    def test_a_rhythm_names_its_next_hour_and_weekly_is_monday(self) -> None:
        self.assertEqual(automation.next_run("daily", 21, local(14, 20)), local(14, 21))
        self.assertEqual(automation.next_run("daily", 21, local(14, 21)), local(15, 21))
        self.assertEqual(automation.next_run("weekly", 9, local(14, 8)), local(19, 9))
        self.assertEqual(automation.next_run("weekly", 9, local(12, 8)), local(12, 9))

    def test_each_says_what_it_does_and_only_the_owners_own_can_be_reworded(
        self,
    ) -> None:
        routines = self.routines(local(14, 8))
        added = routines.add("Each Friday, pick one worth selling", "weekly", 9, 4)
        listed = {routine["id"]: routine for routine in routines.list()}
        self.assertIn("connected", str(listed["synthesis"]["about"]))
        self.assertEqual(
            listed[added["id"]]["about"], "Each Friday, pick one worth selling"
        )
        edited = routines.edit(
            added["id"], "  Each   Friday, pick two ", "Friday picks"
        )
        self.assertEqual(
            (edited["name"], edited["about"], edited["cadence"], edited["day"]),
            ("Friday picks", "Each Friday, pick two", "weekly", 4),
        )
        with self.assertRaisesRegex(ValueError, "not reworded"):
            routines.edit("synthesis", "something else")
        with self.assertRaisesRegex(ValueError, "Say what Lore should do"):
            routines.edit(added["id"], "   ")

    def test_lore_installs_and_removes_nothing(self) -> None:
        path = self.lore_home / "profile-input.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(automation_profile(executor="lore")))
        with (
            patch("lore.automation.remove_task") as remove,
            patch("lore.automation.install_task") as install,
            captured() as output,
        ):
            self.assertEqual(cli.main(["profile", str(path)]), 0)
        install.assert_not_called()
        remove.assert_not_called()
        self.assertIn("while the app is open", output.getvalue())
        with self.assertRaisesRegex(ValueError, "no task to install"):
            automation.task_for({"executor": "lore"})

    def test_a_missed_hour_runs_once_at_the_next_launch(self) -> None:
        automation.save_profile(automation_profile(executor="lore", cadence="daily"))
        # Set at 8 AM: the first run waits for 9 AM rather than starting at once.
        self.routines(local(14, 8)).adopt()
        routine = self.routines(local(14, 8)).get("synthesis").listed()
        self.assertEqual(
            (routine["id"], routine["kind"], routine["due"]),
            ("synthesis", "read", False),
        )
        self.assertEqual(routine["next_run"], local(14, 9).isoformat())
        # Lore was closed for three mornings; the launch after owes one run, not three.
        later = self.routines(local(17, 12))
        routine = later.get("synthesis").listed()
        self.assertTrue(routine["due"])
        self.assertEqual(routine["next_run"], local(18, 9).isoformat())
        with patch("lore.sources.Registry.read", return_value=[]):
            later.run("synthesis")
        routine = self.routines(local(17, 12, 1)).get("synthesis").listed()
        self.assertFalse(routine["due"])
        self.assertEqual(routine["last_run"], local(17, 12).isoformat())
        self.assertEqual(routine["result"], "Nothing new")

    def test_a_run_reads_every_connected_app_and_says_what_came(self) -> None:
        automation.save_profile(automation_profile(executor="lore"))
        reads = [
            {"name": "granola-1", "connector": "granola", "added": 2},
            {"name": "obsidian-1", "connector": "obsidian", "added": 1},
            {"name": "medium-1", "connector": "medium", "added": 0},
            {"name": "codex", "label": "Codex", "connector": None, "added": 4},
        ]
        with patch("lore.sources.Registry.read", return_value=reads) as read:
            ran = self.routines(local(14, 12)).run("synthesis")
        read.assert_called_once_with()
        self.assertEqual(ran["reads"], reads)
        self.assertEqual(
            self.routines(local(14, 12)).get("synthesis").listed()["result"],
            "2 new meetings · 1 new note · 4 from Codex",
        )

    def test_the_schedule_state_says_when_lore_missed_a_run(self) -> None:
        automation.save_profile(automation_profile(executor="lore", cadence="daily"))
        stamped = datetime.now(timezone.utc) - timedelta(days=2)
        self.routines(stamped).adopt()
        state = automation.schedule_state()
        self.assertEqual(
            state,
            {
                "paused": False,
                "cadence": "daily",
                "hour": 9,
                "day": 0,
                "last_run": None,
                "missed": True,
            },
        )
        with patch("lore.sources.Registry.read", return_value=[]):
            automation.Routines().run("synthesis")
        state = automation.schedule_state()
        assert state is not None
        self.assertFalse(state["missed"])
        self.assertIsNotNone(state["last_run"])

    def test_a_damaged_routines_file_reads_as_none_run_yet(self) -> None:
        automation.save_profile(automation_profile(executor="lore"))
        path = self.lore_home / "automation/routines.json"
        path.write_text("{damaged")
        routine = self.routines(local(14, 8)).get("synthesis").listed()
        self.assertIsNone(routine["last_run"])
        with patch("lore.sources.Registry.read", return_value=[]):
            self.routines(local(14, 8)).run("synthesis")
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_looking_writes_nothing_and_a_rhythm_counts_from_when_it_was_set(
        self,
    ) -> None:
        automation.save_profile(automation_profile(executor="lore", cadence="daily"))
        routine = self.routines(local(17, 12)).get("synthesis").listed()
        self.assertFalse(routine["due"], "a rhythm never set up owes nothing")
        self.assertFalse((self.lore_home / "automation/routines.json").exists())
        path = self.lore_home / "profile-input.json"
        path.write_text(json.dumps(automation_profile(executor="lore", hour=9)))
        with patch("lore.automation.remove_task"), captured():
            self.assertEqual(cli.main(["profile", str(path)]), 0)
        routine = automation.Routines().get("synthesis").listed()
        self.assertFalse(routine["due"], "saving the profile never runs it at once")

    def test_a_long_run_never_writes_back_a_change_made_meanwhile(self) -> None:
        automation.save_profile(automation_profile(executor="lore"))
        self.routines(local(14, 8)).adopt()

        def meanwhile() -> list[object]:
            automation.Routines().save("elsewhere", result="kept")
            return []

        with patch("lore.sources.Registry.read", side_effect=meanwhile):
            self.routines(local(14, 12)).run("synthesis")
        saved = automation.Routines().saved
        self.assertEqual(saved["elsewhere"].result, "kept")
        self.assertEqual(saved["synthesis"].result, "Nothing new")

    def test_in_the_app_lore_runs_the_rhythm_whatever_the_profile_names(
        self,
    ) -> None:
        path = self.lore_home / "profile-input.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        for executor in ("", "codex", "claude"):
            with self.subTest(executor=executor):
                profile = automation_profile(executor=executor, cadence="weekdays")
                path.write_text(json.dumps(profile))
                with (
                    patch.dict(os.environ, {"LORE_APP_VERSION": "0.1.15"}),
                    patch("lore.automation.remove_task") as remove,
                    patch("lore.automation.install_task") as install,
                    captured(),
                ):
                    self.assertEqual(cli.main(["profile", str(path)]), 0)
                install.assert_not_called()
                remove.assert_not_called()
                saved = json.loads(automation.profile_path().read_text())
                self.assertEqual(saved["executor"], "lore")
                self.assertEqual(saved["cadence"], "weekdays")


class TakeOverTest(LoreTestCase):
    """AUT-010: in the app, a reading Claude Code or Codex ran becomes Lore's."""

    def codex_task(self, rule: str) -> None:
        path = self.codex_home / "automations/lore-memory-synthesis"
        path.mkdir(parents=True)
        (path / "automation.toml").write_text(f'rrule = "{rule}"\n')

    def test_a_codex_reading_keeps_its_rhythm_and_pause_and_its_task_comes_down(
        self,
    ) -> None:
        automation.save_profile(automation_profile(cadence="weekly", hour=21))
        self.codex_task("FREQ=WEEKLY;BYDAY=SU;BYHOUR=21;BYMINUTE=0")
        automation.Routines(clock=lambda: local(1, 8)).change("synthesis", paused=True)
        with patch("lore.automation.remove_task") as remove:
            automation.Routines(clock=lambda: local(15, 22)).take_over()
        self.assertEqual(
            {call.args[0].agent for call in remove.call_args_list},
            {automation.Agent.CLAUDE, automation.Agent.CODEX},
        )
        profile = json.loads(automation.profile_path().read_text())
        self.assertEqual(
            (profile["executor"], profile["cadence"], profile["hour"], profile["day"]),
            ("lore", "weekly", 21, 6),
        )
        reading = automation.Routines(clock=lambda: local(15, 22)).list()[0]
        self.assertEqual(
            (reading["cadence"], reading["hour"], reading["day"], reading["paused"]),
            ("weekly", 21, 6, True),
        )
        self.assertIn(
            "from codex to Lore", (self.lore_home / "automation/moved.log").read_text()
        )

    def test_nothing_runs_at_once_and_it_happens_once(self) -> None:
        # A Claude reading at 9 AM daily, last run days ago: owed, were it not Lore's now.
        automation.save_profile(automation_profile(executor="claude", cadence="daily"))
        automation.Routines(clock=lambda: local(1, 8)).adopt()
        with patch("lore.automation.remove_task") as remove:
            automation.Routines(clock=lambda: local(14, 12)).take_over()
            automation.Routines(clock=lambda: local(14, 12)).take_over()
        self.assertEqual(
            remove.call_count, 2, "one take-over removes both agents' tasks"
        )
        reading = automation.Routines(clock=lambda: local(14, 13)).list()[0]
        self.assertEqual(
            (reading["due"], reading["next_run"], reading["day"]),
            (False, local(15, 9).isoformat(), 0),
        )
        log = (self.lore_home / "automation/moved.log").read_text()
        self.assertEqual(log.count("moved from claude"), 1)

    def test_the_first_launch_after_the_move_skips_and_owes_nothing(self) -> None:
        # Moved at 7 PM on a weekday, after both the 6 PM check-in and any reading.
        automation.save_profile(automation_profile(cadence="daily", hour=9))
        launched = automation.Routines(clock=lambda: local(14, 19))
        launched.take_over()
        listed = launched.list()
        self.assertEqual([(r["due"], r["result"]) for r in listed], [(False, "")] * 2)
        self.assertEqual(listed[1]["next_run"], local(15, 18).isoformat())

    def test_only_the_app_moves_it(self) -> None:
        automation.save_profile(automation_profile())
        with patch("lore.automation.remove_task") as remove, captured():
            cli.main(["automation", "list", "--json"])
            remove.assert_not_called()
            with patch.dict(os.environ, {"LORE_APP_VERSION": "0.1.15"}):
                cli.main(["desktop-state"])
        remove.assert_called()
        self.assertEqual(automation.Routines().profile["executor"], "lore")

    def test_a_lore_reading_is_left_alone(self) -> None:
        automation.save_profile(automation_profile(executor="lore"))
        with patch("lore.automation.remove_task") as remove:
            automation.Routines().take_over()
        remove.assert_not_called()
        self.assertFalse((self.lore_home / "automation/moved.log").exists())

    def test_a_task_never_moved_off_monday_stays_on_monday(self) -> None:
        self.assertEqual(automation.codex_day(), 0)
        self.codex_task("FREQ=WEEKLY;BYDAY=MO;BYHOUR=21;BYMINUTE=0")
        self.assertEqual(automation.codex_day(), 0)


def checkin(routines: automation.Routines) -> dict[str, object]:
    return next(r for r in routines.list() if r["id"] == "checkin")


class OnByDefaultTest(LoreTestCase):
    """AUT-009: Lore's own routines are on from the start, until the owner pauses one."""

    def test_with_no_profile_lore_reads_each_morning_and_checks_in_at_six(
        self,
    ) -> None:
        reading, check_in = automation.Routines(clock=lambda: local(14, 8)).list()
        self.assertEqual(
            (reading["cadence"], reading["hour"], reading["paused"]),
            ("daily", 9, False),
        )
        self.assertEqual((check_in["cadence"], check_in["hour"]), ("weekdays", 18))
        self.assertFalse(check_in["paused"])
        later = automation.Routines(clock=lambda: local(14, 10)).list()
        self.assertEqual([r["due"] for r in later], [True, False])
        self.assertEqual(automation.schedule_state()["hour"], 9)

    def test_a_pause_kept_by_an_earlier_build_stays(self) -> None:
        path = self.lore_home / "automation/routines.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        since = local(1, 8).isoformat()
        path.write_text(
            json.dumps(
                {
                    "synthesis": {"since": since, "paused": True},
                    "checkin": {"since": since, "paused": True, "hour": 20},
                }
            )
        )
        listed = automation.Routines(clock=lambda: local(14, 21)).list()
        self.assertEqual([(r["paused"], r["due"]) for r in listed], [(True, False)] * 2)
        self.assertEqual(listed[1]["hour"], 20)

    def test_turning_on_by_default_never_runs_one_at_once(self) -> None:
        # Upgraded at 7 PM on a weekday, long after both hours had passed.
        upgraded = automation.Routines(clock=lambda: local(14, 19)).list()
        self.assertEqual([r["due"] for r in upgraded], [False, False])
        self.assertEqual(
            [r["next_run"] for r in upgraded],
            [local(15, 9).isoformat(), local(15, 18).isoformat()],
        )
        relaunched = automation.Routines(clock=lambda: local(14, 23)).list()
        self.assertEqual([r["due"] for r in relaunched], [False, False])

    def test_being_told_is_remembered(self) -> None:
        def told() -> object:
            with store_module.Store() as store:
                return store.setting(automation.NOTICED, False)

        self.assertFalse(told())
        self.assertEqual(cli.main(["automation", "noticed"]), 0)
        self.assertTrue(told())


class CheckInTest(LoreTestCase):
    """AUT-008: the evening check-in is one of Lore's own routines."""

    def on(self, now: datetime, **changes: object) -> automation.Routines:
        """The owner turns the check-in on at `now`."""
        routines = automation.Routines(clock=lambda: now)
        routines.change("checkin", paused=False, **changes)
        return routines

    def test_it_runs_at_six_on_weekdays_once_turned_on(self) -> None:
        # The 16th is a Friday: after six, the next one is Monday, not the weekend.
        self.on(local(16, 9))
        routine = checkin(automation.Routines(clock=lambda: local(16, 17)))
        self.assertEqual(
            (routine["id"], routine["kind"], routine["cadence"]),
            ("checkin", "checkin", "weekdays"),
        )
        self.assertEqual(routine["next_run"], local(16, 18).isoformat())
        self.assertEqual(
            automation.next_run("weekdays", 18, local(16, 18)), local(19, 18)
        )
        self.assertFalse(routine["paused"])

    def test_it_is_on_whoever_reads_until_the_owner_pauses_it(self) -> None:
        path = self.lore_home / "profile-input.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        for executor in ("claude", "codex", "lore"):
            with self.subTest(executor=executor):
                path.write_text(json.dumps(automation_profile(executor=executor)))
                with (
                    patch("lore.automation.remove_task"),
                    patch("lore.automation.install_task", return_value=Path("t")),
                    captured(),
                ):
                    self.assertEqual(cli.main(["profile", str(path)]), 0)
                self.assertFalse(checkin(automation.Routines())["paused"])
        automation.Routines().change("checkin", paused=True)
        with (
            patch("lore.automation.remove_task"),
            patch("lore.automation.install_task", return_value=Path("t")),
            captured(),
        ):
            cli.main(["profile", str(path)])
        self.assertTrue(checkin(automation.Routines())["paused"])

    def test_it_reads_nothing_and_asks_only_about_what_came_in_since_it_judged(
        self,
    ) -> None:
        self.seed_memory("Old meeting from before the check-in existed")
        self.on(local(14, 9))
        fresh = self.seed_memory("Pricing call with Acme")
        discarded = self.seed_memory("A meeting the owner threw away", "discarded")
        with store_module.Store() as store:
            for source, origin in (
                ("automation", "automation"),
                ("attended", "attended"),
                ("claude", "native"),
            ):
                store.put(
                    source=source,
                    origin=origin,
                    source_path=f"memories/{source}.md",
                    source_key=f"{source}:pricing",
                    fingerprint=source,
                    title=f"Not brought in: {source}",
                    content="Lore's own writing, the owner's own capture, or an agent's notes.",
                )
        with patch("lore.sources.Registry.read") as read:
            ran = automation.Routines(clock=lambda: local(14, 18)).run("checkin")
        read.assert_not_called()
        self.assertEqual(
            ran["items"],
            [{"id": fresh, "title": "Pricing call with Acme", "source": "test"}],
        )
        self.assertNotIn(discarded, [item["id"] for item in ran["items"]])
        # Until the app says its model judged them, the same items are owed again.
        again = automation.Routines(clock=lambda: local(15, 18)).run("checkin")
        self.assertEqual(again["items"], ran["items"])
        automation.Routines().record("checkin", "Nothing new to ask about", ran["mark"])
        later = automation.Routines(clock=lambda: local(16, 18)).run("checkin")
        self.assertEqual(later["items"], [])

    def test_a_check_in_missed_by_hours_is_recorded_and_never_asks_late(
        self,
    ) -> None:
        self.on(local(14, 9))
        self.seed_memory("Pricing call with Acme")
        # Closed at 6 PM, opened at 9 AM the next morning.
        ran = automation.Routines(clock=lambda: local(15, 9)).run("checkin")
        self.assertEqual(ran, {"routine": ran["routine"], "items": [], "missed": True})
        routine = checkin(automation.Routines(clock=lambda: local(15, 9)))
        # Named by the slot it skipped, the 14th, not the morning it noticed.
        self.assertEqual(
            routine["result"], "Skipped Wednesday: Lore wasn't open at 6 PM"
        )
        self.assertFalse(routine["due"])
        # Opened an hour after six, it still asks.
        ran = automation.Routines(clock=lambda: local(15, 19)).run("checkin")
        self.assertEqual(len(ran["items"]), 1)

    def test_a_change_counts_the_next_run_from_when_it_was_made(self) -> None:
        self.on(local(12, 9))
        with captured():
            self.assertEqual(cli.main(["automation", "pause", "checkin"]), 0)
        routine = checkin(automation.Routines(clock=lambda: local(16, 20)))
        self.assertEqual((routine["paused"], routine["due"]), (True, False))
        # Paused for days and resumed at 8 PM: the next is tomorrow's six, not now.
        routine = checkin(self.on(local(16, 20)))
        self.assertEqual(
            (routine["due"], routine["next_run"]), (False, local(19, 18).isoformat())
        )
        # Moved from six to nine in the morning, at noon: tomorrow at nine.
        routines = automation.Routines(clock=lambda: local(19, 12))
        routines.change("checkin", hour=9, cadence="daily")
        routine = checkin(routines)
        self.assertEqual(
            (routine["due"], routine["next_run"]), (False, local(20, 9).isoformat())
        )
        with self.assertRaises(ValueError):
            automation.Routines().change("checkin", hour=24)

    def test_what_a_check_in_came_to_is_recorded_in_one_short_line(self) -> None:
        self.assertEqual(
            cli.main(
                [
                    "automation",
                    "result",
                    "checkin",
                    "Asked about\n1 thing",
                    "--mark",
                    "7",
                ]
            ),
            0,
        )
        saved = automation.Routines().saved["checkin"]
        self.assertEqual((saved.result, saved.mark), ("Asked about 1 thing", 7))
        with self.assertRaisesRegex(ValueError, "does not run"):
            automation.Routines().record("nonsense", "x")

    def test_a_long_run_never_overwrites_a_pause_made_meanwhile(self) -> None:
        automation.save_profile(automation_profile(executor="lore"))
        automation.Routines(clock=lambda: local(14, 8)).adopt()
        run = automation.Routines(clock=lambda: local(14, 12))

        def meanwhile() -> list[object]:
            automation.Routines().change("checkin", paused=True)
            return []

        with patch("lore.sources.Registry.read", side_effect=meanwhile):
            run.run("synthesis")
        self.assertTrue(automation.Routines().saved["checkin"].paused)


class AutomationsTest(LoreTestCase):
    """APP-200: every routine in one list, Lore's own first, and the owner's own."""

    def test_the_list_puts_lores_own_first_and_only_the_owners_can_go(self) -> None:
        automation.save_profile(automation_profile(executor="lore"))
        clock = automation.Routines(clock=lambda: local(14, 12))
        added = clock.add(
            "Every Sunday, remember what I read this week", "weekly", 18, day=6
        )
        routines = clock.list()
        self.assertEqual(
            [(r["id"], r["built_in"]) for r in routines],
            [("synthesis", True), ("checkin", True), (added["id"], False)],
        )
        mine = routines[2]
        self.assertEqual(mine["name"], "Every Sunday, remember what I read this week")
        self.assertEqual(mine["next_run"], local(18, 18).isoformat(), "a Sunday")
        for built_in in ("synthesis", "checkin"):
            with self.assertRaisesRegex(ValueError, "paused, not removed"):
                automation.Routines().remove(built_in)
        with captured():
            self.assertEqual(cli.main(["automation", "remove", str(added["id"])]), 0)
        self.assertEqual(
            [r["id"] for r in automation.Routines().list()], ["synthesis", "checkin"]
        )

    def test_an_owners_routine_hands_its_sentence_to_the_app_and_keeps_its_result(
        self,
    ) -> None:
        with captured() as output:
            cli.main(
                [
                    "automation",
                    "add",
                    "--cadence",
                    "daily",
                    "--hour",
                    "9",
                    "--json",
                    "--",
                    "-Summarize   what I learned",
                ]
            )
        added = json.loads(output.getvalue())
        with patch("lore.sources.Registry.read") as read:
            ran = automation.Routines().run(added["id"])
        read.assert_not_called()
        self.assertEqual(ran["ask"], "-Summarize what I learned")
        automation.Routines().record(added["id"], "2 new memories")
        routine = automation.Routines().get(added["id"]).listed()
        self.assertEqual(
            (routine["kind"], routine["result"]), ("ask", "2 new memories")
        )
        self.assertIsNotNone(routine["last_run"])
        for bad in ("   ", "x" * 501):
            with self.subTest(bad=bad[:5]), self.assertRaises(ValueError):
                automation.Routines().add(bad, "daily", 9)
        with self.assertRaises(ValueError):
            automation.Routines().add("Fine", "daily", 24)

    def test_an_owners_routine_goes_by_its_title_and_still_runs_its_sentence(
        self,
    ) -> None:
        with captured() as output:
            cli.main(
                [
                    "automation",
                    "add",
                    "--cadence",
                    "weekdays",
                    "--hour",
                    "8",
                    "--title",
                    "  Morning   reading ",
                    "--json",
                    "--",
                    "Remember what I read",
                ]
            )
        added = json.loads(output.getvalue())
        self.assertEqual(added["name"], "Morning reading")
        with patch("lore.sources.Registry.read"):
            ran = automation.Routines().run(added["id"])
        self.assertEqual(ran["ask"], "Remember what I read")

    def test_reading_takes_any_rhythm_and_keeps_it_in_the_profile(self) -> None:
        automation.save_profile(automation_profile(executor="lore", cadence="daily"))
        with patch("lore.automation.remove_task") as remove:
            paused = automation.Routines().change("synthesis", paused=True)
            self.assertEqual((paused["paused"], paused["due"]), (True, False))
            self.assertTrue(automation.schedule_state()["paused"])
            automation.Routines().change("synthesis", paused=False)
            retimed = automation.Routines().change(
                "synthesis", hour=7, cadence="weekdays", day=0
            )
            weekly = automation.Routines().change(
                "synthesis", hour=20, cadence="weekly", day=6
            )
        remove.assert_not_called()
        self.assertEqual((retimed["hour"], retimed["cadence"]), (7, "weekdays"))
        self.assertEqual((weekly["cadence"], weekly["day"]), ("weekly", 6))
        profile = json.loads(automation.profile_path().read_text())
        self.assertEqual((profile["hour"], profile["day"]), (20, 6))

    def test_saving_the_profile_again_turns_a_paused_reading_back_on(self) -> None:
        automation.save_profile(automation_profile(executor="lore"))
        automation.Routines().change("synthesis", paused=True)
        path = self.lore_home / "profile-input.json"
        path.write_text(json.dumps(automation_profile(executor="lore")))
        with captured():
            self.assertEqual(cli.main(["profile", str(path)]), 0)
        self.assertFalse(automation.schedule_state()["paused"])

    def test_resuming_or_retiming_an_owners_routine_never_runs_it_at_once(
        self,
    ) -> None:
        added = automation.Routines(clock=lambda: local(5, 8)).add(
            "Tidy up", "daily", 9
        )
        routines = automation.Routines(clock=lambda: local(5, 8))
        routines.change(str(added["id"]), paused=True)
        # Paused for days, resumed at 10 AM: tomorrow at nine, not now.
        resumed = automation.Routines(clock=lambda: local(14, 10)).change(
            str(added["id"]), paused=False
        )
        self.assertEqual(
            (resumed["due"], resumed["next_run"]), (False, local(15, 9).isoformat())
        )
        # Moved from nine at night to nine in the morning, at noon: not now either.
        moved = automation.Routines(clock=lambda: local(15, 12)).change(
            str(added["id"]), hour=9, cadence="daily", day=0
        )
        self.assertEqual(
            (moved["due"], moved["next_run"]), (False, local(16, 9).isoformat())
        )


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
