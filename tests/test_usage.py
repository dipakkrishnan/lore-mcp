from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from helpers import LoreTestCase, captured

from lore import cli, usage
from lore.store import Store


class UsageTest(LoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.sent: list[dict[str, object]] = []
        sender = patch.object(usage, "_send", side_effect=self.sent.append)
        sender.start()
        self.addCleanup(sender.stop)

    def names(self) -> list[str]:
        return [str(event["name"]) for event in self.sent]

    def test_nothing_is_sent_before_the_notice(self) -> None:
        self.assertFalse(usage.record("store.opened"))
        usage.notice_shown()
        self.assertTrue(usage.record("store.opened"))

    def test_nothing_is_sent_with_telemetry_off(self) -> None:
        usage.notice_shown()
        with Store() as store:
            store.set_setting(usage.ENABLED_SETTING, False)
        self.assertFalse(usage.record("store.opened"))
        self.assertEqual(self.sent, [])

    def test_a_milestone_is_sent_once_and_never_counts(self) -> None:
        usage.notice_shown()
        for _ in range(3):
            usage.record("memory.saved")
            usage.record("app.opened")
        usage.record("source.connected", "obsidian")
        usage.record("source.connected", "substack")
        usage.record("cli.failed", "push")
        usage.record("cli.failed", "push")
        self.assertEqual(
            self.names(),
            [
                "memory.saved",
                "app.opened",
                "source.connected",
                "source.connected",
                "cli.failed",
                "cli.failed",
            ],
        )

    def test_events_carry_only_coded_values(self) -> None:
        usage.notice_shown()
        with self.assertRaises(ValueError):
            usage.record("source.connected", "/Users/me/vault")
        usage.record("sale.seen", "card")
        self.assertEqual(self.sent[0]["props"], {"via": "card"})
        self.assertEqual(set(self.sent[0]), {"name", "props", "at"})

    def test_every_event_sent_is_in_the_local_log(self) -> None:
        usage.notice_shown()
        usage.record("piece.approved")
        logged = [
            json.loads(line) for line in Path(usage.log_path()).read_text().splitlines()
        ]
        self.assertEqual(logged, self.sent)

    def test_the_relay_and_the_cli_share_one_list(self) -> None:
        contract = json.loads(
            (Path(__file__).parents[1] / "contracts/usage_events.json").read_text()
        )
        self.assertEqual(
            {
                name: {"prop": prop[0], "values": list(prop[1])} if prop else None
                for name, (_, prop) in usage.EVENTS.items()
            },
            contract["events"],
        )

    def test_a_failed_command_says_which_command_and_nothing_else(self) -> None:
        usage.notice_shown()
        with (
            captured(),
            patch.object(
                cli, "push", side_effect=ValueError("secret detail /Users/me")
            ),
        ):
            self.assertEqual(cli.main(["push"]), 1)
        self.assertEqual(self.sent[-1]["props"], {"command": "push"})

    def test_a_terminal_says_it_once_before_anything_is_sent(self) -> None:
        with (
            patch.object(cli, "_interactive", return_value=True),
            captured(),
            patch("sys.stderr") as err,
        ):
            cli.main(["telemetry", "status"])
            self.assertFalse(err.write.called)
            cli.main(["status"])
            notice = "".join(call.args[0] for call in err.write.call_args_list)
        self.assertIn("anonymous usage events", notice)
        with Store() as store:
            self.assertTrue(store.setting(usage.NOTICED_SETTING))
