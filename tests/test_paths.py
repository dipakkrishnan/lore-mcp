"""Tests for `lore.paths` — where every other module decides what it may touch."""

from __future__ import annotations

import os
import unittest
from pathlib import Path

from helpers import LoreTestCase

from lore import paths


class PathsTest(LoreTestCase):
    def test_every_root_follows_its_environment_variable(self) -> None:
        # Redirecting these three is the whole isolation mechanism the suite
        # relies on; if a path helper ever cached, tests would write to ~/.lore.
        self.assertEqual(paths.home(), self.lore_home)
        self.assertEqual(paths.claude_home(), self.claude_home)
        self.assertEqual(paths.codex_home(), self.codex_home)
        self.assertEqual(paths.database(), self.lore_home / "lore.db")

        os.environ["LORE_HOME"] = str(self.lore_home / "moved")
        self.assertEqual(paths.home(), self.lore_home / "moved")


class PathDefaultsTest(unittest.TestCase):
    def test_defaults_expand_to_the_users_home(self) -> None:
        for variable, helper, default in (
            ("LORE_HOME", paths.home, ".lore"),
            ("CODEX_HOME", paths.codex_home, ".codex"),
            ("CLAUDE_HOME", paths.claude_home, ".claude"),
        ):
            with self.subTest(variable=variable):
                previous = os.environ.pop(variable, None)
                try:
                    resolved = helper()
                finally:
                    if previous is not None:
                        os.environ[variable] = previous
                self.assertEqual(resolved, Path.home() / default)
                self.assertTrue(resolved.is_absolute())


if __name__ == "__main__":
    unittest.main()
