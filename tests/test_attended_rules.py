"""Table tests for the desktop-app gate's rules (XC-105): `cli.attended_folder`
and `cli._attended` with their environment handed in. The key files on disk
stay `tests/test_cli.py`'s business."""

from __future__ import annotations

import unittest
from pathlib import Path

import hermetic  # noqa: F401  (no test may reach a real Cloudflare account)

from lore import cli


class AttendedFolderTest(unittest.TestCase):
    def test_the_folder_is_under_the_given_account_home(self) -> None:
        self.assertEqual(
            cli.attended_folder(Path("/Users/owner")),
            Path("/Users/owner/Library/Application Support/Lore"),
        )


class AttendedTest(unittest.TestCase):
    def test_the_rules(self) -> None:
        cases: tuple[tuple[str, bool, list[str], bool], ...] = (
            # key, stdin is a terminal, running apps' keys, attended
            ("", False, ["launch-key"], False),
            ("launch-key", True, ["launch-key"], False),
            ("launch-key", False, [], False),
            ("guess", False, ["launch-key"], False),
            ("launch-key", False, ["launch-key"], True),
            ("second", False, ["first", "second"], True),
            ("launch-key ", False, ["launch-key"], False),
        )
        for key, terminal, keys, attended in cases:
            with self.subTest(key=key, terminal=terminal, keys=keys):
                self.assertIs(
                    cli._attended(key, terminal=terminal, launch_keys=keys), attended
                )

    def test_no_key_files_are_read_until_there_is_a_key_to_check(self) -> None:
        # `launch_keys=None` would read the account's folder; it is never reached here.
        self.assertFalse(cli._attended("", terminal=False, launch_keys=None))
        self.assertFalse(cli._attended("launch-key", terminal=True, launch_keys=None))


if __name__ == "__main__":
    unittest.main()
