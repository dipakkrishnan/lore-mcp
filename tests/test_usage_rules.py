"""Table tests for the usage rules (XC-105): `usage.event_key` and `usage.due`
from plain data, and `usage.record`'s injectable sender. The relay and the
sender thread stay `tests/test_usage.py`'s business."""

from __future__ import annotations

import unittest

import hermetic  # noqa: F401  (no test may reach a real Cloudflare account)
from helpers import LoreTestCase

from lore import usage

TODAY = "2026-11-02"
YESTERDAY = "2026-11-01"


class EventKeyTest(unittest.TestCase):
    def test_the_key_carries_the_value_when_it_distinguishes_the_event(self) -> None:
        cases: tuple[tuple[str, str, str, str], ...] = (
            # name, frequency, value, key
            ("app.installed", "first", "", "app.installed"),
            ("app.opened", "daily", "", "app.opened"),
            ("piece.drafted", "once", "", "piece.drafted:"),
            ("source.connected", "once", "notion", "source.connected:notion"),
            ("memory.saved", "daily", "capture", "memory.saved:capture"),
            ("store.failed", "always", "timeout", "store.failed:timeout"),
            ("cli.failed", "always", "", "cli.failed"),
        )
        for name, frequency, value, key in cases:
            with self.subTest(name=name, value=value):
                self.assertEqual(usage.event_key(name, frequency, value), key)


class DueTest(unittest.TestCase):
    def test_the_rules(self) -> None:
        cases: tuple[tuple[str, dict[str, str], bool], ...] = (
            # frequency, what was sent before, due now
            ("once", {}, True),
            ("once", {"other:": TODAY}, True),
            ("once", {"key": YESTERDAY}, False),
            ("once", {"key": TODAY}, False),
            ("first", {}, True),
            ("first", {"anything": YESTERDAY}, False),
            ("daily", {}, True),
            ("daily", {"key": YESTERDAY}, True),
            ("daily", {"key": TODAY}, False),
            ("daily", {"other": TODAY}, True),
            ("always", {}, True),
            ("always", {"key": TODAY}, True),
        )
        for frequency, sent, expected in cases:
            with self.subTest(frequency=frequency, sent=sent):
                self.assertIs(usage.due(frequency, "key", sent, TODAY), expected)

    def test_every_declared_event_has_a_known_frequency(self) -> None:
        for name, (frequency, _) in usage.EVENTS.items():
            with self.subTest(name=name):
                self.assertIn(frequency, ("first", "once", "daily", "always"))


class InjectedSenderTest(LoreTestCase):
    """The one rule here that needs the store: consent is read from it."""

    def test_a_given_sender_gets_the_event_and_the_relay_hears_nothing(self) -> None:
        usage.notice_shown()
        handed: list[dict[str, object]] = []
        with unittest.mock.patch.object(usage, "_send") as relay:
            self.assertTrue(usage.record("store.opened", send=handed.append))
        relay.assert_not_called()
        (event,) = handed
        self.assertEqual(event["name"], "store.opened")
        self.assertEqual(event["props"], {})
        # Sent once: the sender is not asked again for the same event.
        self.assertFalse(usage.record("store.opened", send=handed.append))
        self.assertEqual(len(handed), 1)

    def test_without_consent_no_sender_is_asked(self) -> None:
        handed: list[dict[str, object]] = []
        self.assertFalse(usage.record("store.opened", send=handed.append))
        self.assertEqual(handed, [])


if __name__ == "__main__":
    unittest.main()
