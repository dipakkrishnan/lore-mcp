"""`python -m lore desktop-state`, run as the desktop app runs it (XC-097).

`tests/test_snapshot.py` and `tests/test_sources.py` build the snapshot in
process. These tests start the real CLI, so the contract the app reads is the
one a separate interpreter prints: complete, safe, and the same as `build()`.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from helpers import LoreTestCase

from lore import capture, snapshot

ROOT = Path(__file__).resolve().parents[2]


class DesktopStateTest(LoreTestCase):
    def test_subprocess_prints_the_same_safe_contract_as_build(self) -> None:
        capture.save(
            [{"title": "Note", "content": "PRIVATE BODY SECRET", "source_path": "n"}]
        )
        direct = snapshot.build()
        result = subprocess.run(
            [sys.executable, "-m", "lore", "desktop-state"],
            cwd=ROOT,
            env=os.environ.copy(),
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("\x1b", result.stdout)
        self.assertNotIn("PRIVATE BODY SECRET", result.stdout)
        self.assertEqual(json.loads(result.stdout), direct)


class TildeSourcesTest(LoreTestCase):
    def test_desktop_state_survives_sources_named_with_a_tilde(self) -> None:
        # Only `~/` means home: `~standup` and `~bob/x` would make Path raise.
        for path in ("~standup", "~bob/x"):
            capture.save(
                [{"title": path, "content": "we ship friday", "source_path": path}]
            )
        capture.save(
            [{"title": "Home", "content": "a note", "source_path": "~/notes/a.md"}]
        )
        result = subprocess.run(
            [sys.executable, "-m", "lore", "desktop-state"],
            env=os.environ.copy(),
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
