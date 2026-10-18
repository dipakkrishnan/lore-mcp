from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator
from unittest.mock import patch

from helpers import LoreTestCase, captured

from lore import __version__, cli, feedback, usage
from lore.store import Store

Received = tuple[str, dict[str, str], dict[str, object]]


@contextmanager
def relay(status: int = 204) -> Iterator[tuple[str, list[Received]]]:
    """A local stand-in for the relay: answer every POST with `status` and keep
    each request's path, headers and JSON body.

    Header names are lower-cased on the way in, because urllib sends
    `Content-type` and `User-agent` whatever case the caller wrote.
    """
    received: list[Received] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            size = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(size))
            headers = {name.lower(): value for name, value in self.headers.items()}
            received.append((self.path, headers, body))
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *_: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", received
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


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

    def test_the_local_log_keeps_only_the_newest_events(self) -> None:
        usage.notice_shown()
        commands = ["setup", "sync", "sources", "capture", "push"]
        with patch.object(usage, "LOG_KEEP", 3):
            for command in commands:
                usage.record("cli.failed", command)
        logged = [
            json.loads(line) for line in Path(usage.log_path()).read_text().splitlines()
        ]
        self.assertEqual([event["props"]["command"] for event in logged], commands[-3:])

    def test_a_daily_event_is_sent_again_on_a_later_day(self) -> None:
        usage.notice_shown()
        with Store() as store:
            store.set_setting(usage.SENT_SETTING, {"app.opened": "2000-01-01"})
        self.assertTrue(usage.record("app.opened"))
        self.assertFalse(usage.record("app.opened"))
        self.assertEqual(self.names(), ["app.opened"])
        with Store() as store:
            self.assertNotEqual(
                store.setting(usage.SENT_SETTING)["app.opened"], "2000-01-01"
            )

    def test_a_corrupt_sent_record_does_not_stop_events(self) -> None:
        usage.notice_shown()
        with Store() as store:
            store.set_setting(usage.SENT_SETTING, "not a record")
        self.assertTrue(usage.record("memory.saved"))
        self.assertFalse(usage.record("memory.saved"))
        self.assertEqual(self.names(), ["memory.saved"])

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


class SendTest(LoreTestCase):
    """What leaves the machine, where it goes, and what a dead relay costs.

    `_send` is real here. No relay is pinned unless a test pins a local one, so
    a test that drops `LORE_USAGE_URL` can never reach the real relay.
    """

    def setUp(self) -> None:
        super().setUp()
        environment = patch.dict(
            os.environ, {"no_proxy": "127.0.0.1", "NO_PROXY": "127.0.0.1"}
        )
        environment.start()
        self.addCleanup(environment.stop)
        os.environ.pop("LORE_APP_VERSION", None)
        pinned = patch.object(feedback, "RELAY_URL", None)
        pinned.start()
        self.addCleanup(pinned.stop)
        # An exception the sender thread lets go would otherwise only be printed.
        self.uncaught: list[threading.ExceptHookArgs] = []
        self.addCleanup(self.assertEqual, self.uncaught, [])
        self.addCleanup(setattr, threading, "excepthook", threading.excepthook)
        threading.excepthook = self.uncaught.append
        usage.notice_shown()

    def record(self, name: str, value: str = "") -> bool:
        """Record one event and wait for its sender thread to finish."""
        before = set(threading.enumerate())
        sent = usage.record(name, value)
        for thread in set(threading.enumerate()) - before:
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive(), "the sender never finished")
        return sent

    def logged(self) -> list[dict[str, object]]:
        return [
            json.loads(line) for line in Path(usage.log_path()).read_text().splitlines()
        ]

    def test_an_event_leaves_with_the_install_id_the_version_and_nothing_else(
        self,
    ) -> None:
        with (
            relay() as (base, received),
            patch.dict(os.environ, {"LORE_USAGE_URL": f"{base}/events"}),
        ):
            self.assertTrue(self.record("sale.seen", "card"))
        self.assertEqual(len(received), 1)
        path, headers, body = received[0]
        self.assertEqual(path, "/events")
        self.assertEqual(headers["content-type"], "application/json")
        self.assertEqual(headers["user-agent"], feedback.USER_AGENT)
        self.assertEqual(set(body), {"install_id", "version", "events"})
        self.assertEqual(body["install_id"], feedback.install_id())
        self.assertEqual(body["version"], __version__)
        self.assertEqual(body["events"], self.logged())
        (event,) = self.logged()
        self.assertEqual(set(event), {"name", "props", "at"})
        self.assertEqual(event["name"], "sale.seen")
        self.assertEqual(event["props"], {"via": "card"})

    def test_a_value_on_an_event_that_carries_none_never_leaves(self) -> None:
        with (
            relay() as (base, received),
            patch.dict(os.environ, {"LORE_USAGE_URL": f"{base}/events"}),
        ):
            self.record("memory.saved", "/Users/me/notes")
        (_, _, body) = received[0]
        self.assertEqual(body["events"], [self.logged()[0]])
        self.assertEqual(self.logged()[0]["props"], {})
        self.assertNotIn("/Users/me", json.dumps(body))
        self.assertNotIn("/Users/me", Path(usage.log_path()).read_text())

    def test_the_desktop_app_sends_its_own_version(self) -> None:
        with (
            relay() as (base, received),
            patch.dict(
                os.environ,
                {"LORE_USAGE_URL": f"{base}/events", "LORE_APP_VERSION": "9.9.9"},
            ),
        ):
            self.record("app.opened")
        self.assertEqual(received[0][2]["version"], "9.9.9")

    def test_events_go_to_the_pinned_relay_beside_its_report_path(self) -> None:
        del os.environ["LORE_USAGE_URL"]
        with patch.object(feedback, "RELAY_URL", "https://relay.example/report"):
            self.assertEqual(usage._url(), "https://relay.example/events")
        with (
            relay() as (base, received),
            patch.object(feedback, "RELAY_URL", f"{base}/report"),
        ):
            self.assertTrue(self.record("store.opened"))
        self.assertEqual([path for path, _, _ in received], ["/events"])

    def test_the_override_wins_over_the_pinned_relay(self) -> None:
        with (
            relay() as (pinned, at_pinned),
            relay() as (override, at_override),
            patch.object(feedback, "RELAY_URL", f"{pinned}/report"),
            patch.dict(os.environ, {"LORE_USAGE_URL": f"{override}/elsewhere"}),
        ):
            self.record("store.opened")
        self.assertEqual([path for path, _, _ in at_override], ["/elsewhere"])
        self.assertEqual(at_pinned, [])

    def test_with_no_relay_pinned_nothing_is_sent(self) -> None:
        del os.environ["LORE_USAGE_URL"]
        with (
            patch.object(usage.threading, "Thread") as thread,
            patch("urllib.request.urlopen") as urlopen,
        ):
            usage.record("store.opened")
        thread.assert_not_called()
        urlopen.assert_not_called()

    def test_a_relay_that_refuses_or_errors_never_fails_the_command(self) -> None:
        # LoreTestCase points events at a closed local port: refused at once.
        self.assertEqual(os.environ["LORE_USAGE_URL"], "http://127.0.0.1:9/events")
        self.record("store.opened")
        with (
            relay(status=500) as (base, received),
            patch.dict(os.environ, {"LORE_USAGE_URL": f"{base}/events"}),
        ):
            self.record("store.listed")
        self.assertEqual(len(received), 1)
        self.assertEqual(
            [event["name"] for event in self.logged()],
            ["store.opened", "store.listed"],
        )

    def test_the_post_runs_off_the_command_thread_with_a_deadline(self) -> None:
        calls: list[tuple[threading.Thread, float | None]] = []

        def urlopen(request: object, timeout: float | None = None) -> None:
            calls.append((threading.current_thread(), timeout))
            raise OSError("down")

        with patch("urllib.request.urlopen", urlopen):
            self.record("store.opened")
        ((thread, timeout),) = calls
        self.assertIsNot(thread, threading.current_thread())
        # Not a daemon: the process waits for it, but only as long as the deadline.
        self.assertFalse(thread.daemon)
        self.assertEqual(timeout, usage.TIMEOUT_SECONDS)

    def test_a_store_or_log_that_cannot_be_written_costs_the_command_nothing(
        self,
    ) -> None:
        with patch("urllib.request.urlopen") as urlopen:
            with patch.object(
                usage,
                "Store",
                side_effect=sqlite3.OperationalError("database is locked"),
            ):
                self.assertFalse(usage.record("cli.failed", "push"))
            Path(usage.log_path()).mkdir()
            self.assertFalse(usage.record("cli.failed", "push"))
        urlopen.assert_not_called()
