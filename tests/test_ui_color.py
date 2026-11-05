"""Table tests for `ui.COLOR` (XC-105): whether output is painted, from a stream
and an environment handed in rather than the process's own."""

from __future__ import annotations

import unittest
from io import StringIO

import hermetic  # noqa: F401  (no test may reach a real Cloudflare account)

from lore import ui


class Terminal(StringIO):
    def isatty(self) -> bool:
        return True


class ColorTest(unittest.TestCase):
    def test_a_terminal_without_no_color_is_painted(self) -> None:
        cases: tuple[tuple[StringIO, dict[str, str], bool], ...] = (
            (Terminal(), {}, True),
            (Terminal(), {"TERM": "xterm"}, True),
            (Terminal(), {"NO_COLOR": "1"}, False),
            # The standard: NO_COLOR present at all, even empty, turns it off.
            (Terminal(), {"NO_COLOR": ""}, False),
            (StringIO(), {}, False),
            (StringIO(), {"NO_COLOR": "1"}, False),
        )
        for stream, environ, painted in cases:
            with self.subTest(tty=stream.isatty(), environ=environ):
                self.assertIs(ui.COLOR(stream, environ), painted)

    def test_each_argument_can_be_given_on_its_own(self) -> None:
        # A real terminal with the process's environment, and the process's
        # stdout with a given environment: neither may raise, and a pipe is
        # never painted whatever the environment says.
        self.assertIsInstance(ui.COLOR(Terminal()), bool)
        self.assertFalse(ui.COLOR(StringIO(), None))
        self.assertFalse(ui.COLOR(None, {"NO_COLOR": "1"}))

    def test_paint_asks_at_call_time(self) -> None:
        with unittest.mock.patch.object(ui, "COLOR", lambda: True):
            self.assertEqual(ui.paint("1", "hi"), "\033[1mhi\033[0m")
        with unittest.mock.patch.object(ui, "COLOR", lambda: False):
            self.assertEqual(ui.paint("1", "hi"), "hi")


if __name__ == "__main__":
    unittest.main()
