"""Shared fixtures for the per-module test files.

Every test file owns one module in `lore/` and must pass on its own
(`pytest tests/test_cli.py`), so the setup they all need — a throwaway
`LORE_HOME`, a seeded store, captured stdout — lives here rather than being
copy-pasted eight times.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from contextlib import contextmanager, redirect_stdout
from io import StringIO
from pathlib import Path
from typing import Iterator

from lore.store import Store


class LoreTestCase(unittest.TestCase):
    """Point Lore and both agent homes at a temporary directory.

    Every path helper reads its environment variable on each call, so redirecting
    the three of them is enough to keep a test off the developer's real `~/.lore`.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.lore_home = root / "lore"
        self.claude_home = root / "claude"
        self.codex_home = root / "codex"
        os.environ["LORE_HOME"] = str(self.lore_home)
        os.environ["CLAUDE_HOME"] = str(self.claude_home)
        os.environ["CODEX_HOME"] = str(self.codex_home)
        # windup resolves a Claude schedule's plist through Path.home(), which none
        # of the vars above cover — an unsandboxed test that installed or removed
        # one for real would reach into the developer's actual ~/Library/LaunchAgents.
        home = root / "home"
        home.mkdir()
        os.environ["HOME"] = str(home)
        self.addCleanup(self.tmp.cleanup)

    def seed_memory(self, title: str, status: str = "private") -> int:
        """Insert one memory directly and return its id."""
        with Store() as store:
            store.put(
                source="test",
                origin="native",
                source_path=title,
                source_key=title,
                fingerprint=title,
                title=title,
                content=f"{title} about deployment",
            )
            memory = store.search(title)[0]
            if status != "private":
                store.set_status(memory.id, status)
            return memory.id


@contextmanager
def captured() -> Iterator[StringIO]:
    """Capture stdout and hand back the buffer."""
    buffer = StringIO()
    with redirect_stdout(buffer):
        yield buffer


def blueprint_input(*, persona: str = "professor", name: str = "Ada") -> dict:
    """Build a minimal, valid blueprint interview payload."""
    return {
        "version": 1,
        "name": name,
        "persona": persona,
        "topic_outline": ["distributed systems", "consensus"],
        "focus_topics": ["consensus tradeoffs"],
        "general_areas": ["intro networking"],
        "storytelling": "Short claim-plus-evidence notes; lecture tone.",
    }


def automation_profile(**overrides: object) -> dict[str, object]:
    """Build a complete synthesis profile; overrides replace individual fields."""
    return {
        "role": "maintainer",
        "domains": "developer tools",
        "valuable_context": "failed launches",
        "preferences": "small changes",
        "boundaries": "secrets",
        "executor": "codex",
        "model": "gpt-test",
        "cadence": "weekly",
        "hour": 9,
    } | overrides
