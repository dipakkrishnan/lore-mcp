"""Tests for the package surface: `lore/__init__.py` and `lore/__main__.py`.

`python -m lore` is not a convenience alias — the scheduled synthesis task and
the prompt it runs both invoke Lore that way, so it is a shipped entry point.
"""

from __future__ import annotations

import runpy
import sys
import unittest
from unittest.mock import patch

from helpers import LoreTestCase, captured

import lore


class VersionTest(unittest.TestCase):
    def test_the_version_is_what_mcp_reports_to_a_caller(self) -> None:
        from lore.mcp import dispatch

        response = dispatch(
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
        )
        self.assertEqual(response["result"]["serverInfo"]["version"], lore.__version__)


class ModuleEntryPointTest(LoreTestCase):
    def test_python_m_lore_runs_the_cli_and_exits_with_its_code(self) -> None:
        with (
            patch.object(sys, "argv", ["lore", "status"]),
            patch("lore.cli.main", return_value=3) as main,
            self.assertRaises(SystemExit) as exit_code,
        ):
            runpy.run_module("lore", run_name="__main__")
        self.assertEqual(exit_code.exception.code, 3)
        main.assert_called_once()

    def test_the_entry_point_works_end_to_end(self) -> None:
        with (
            patch.object(sys, "argv", ["lore", "help"]),
            captured() as output,
            self.assertRaises(SystemExit) as exit_code,
        ):
            runpy.run_module("lore", run_name="__main__")
        self.assertEqual(exit_code.exception.code, 0)
        self.assertIn("Lore workflow", output.getvalue())


if __name__ == "__main__":
    unittest.main()
