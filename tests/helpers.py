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
from unittest.mock import patch

import httpx2
import keyring
from fixtures.inbox import D1, Endpoint, Node
from keyring.backend import KeyringBackend
from keyring.errors import PasswordDeleteError

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
        # Usage events go nowhere from a test: a closed local port, refused at once.
        os.environ["LORE_USAGE_URL"] = "http://127.0.0.1:9/events"
        self.addCleanup(self.tmp.cleanup)
        # Sign-ins and the agent inbox keys live in the Keychain; never the owner's own.
        self.keyring = FakeKeyring()
        previous = keyring.get_keyring()
        keyring.set_keyring(self.keyring)
        self.addCleanup(keyring.set_keyring, previous)

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


class FakeKeyring(KeyringBackend):
    """The Keychain, in memory: a test never reads or writes the owner's own."""

    priority = 1  # type: ignore[assignment]

    def __init__(self) -> None:
        self.saved: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.saved.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.saved[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        if self.saved.pop((service, username), None) is None:
            raise PasswordDeleteError(username)


class NodeCase(LoreTestCase):
    """A deployed node: a SQLite file for its D1, read through a stand-in wrangler as
    sales are, and its `/agent` endpoint on a loopback port."""

    def setUp(self) -> None:
        super().setUp()
        self.d1 = D1(Path(self.tmp.name) / "d1.sqlite")
        wrangler = self.lore_home / "node/node_modules/.bin/wrangler"
        wrangler.parent.mkdir(parents=True)
        wrangler.write_text("#!/bin/sh\n")
        patcher = patch("lore.deploy.subprocess.run", side_effect=self.d1.wrangler)
        self.wrangler = patcher.start()
        self.addCleanup(patcher.stop)
        self.endpoint = Endpoint(self.d1)
        self.node = Node(self.endpoint).__enter__()
        self.addCleanup(self.node.__exit__)
        with Store() as store:
            store.set_setting("node_url", f"{self.node.url}/mcp")

    def call(self, token: str, tool: str, /, **arguments: object) -> dict:
        """One tool call, as a personal agent makes it."""
        answer = httpx2.post(
            f"{self.node.url}/agent",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": tool, "arguments": arguments},
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        answer.raise_for_status()
        return answer.json()["result"]

    def save(self, key: str, *items: dict) -> dict:
        return self.call(key, "store", items=list(items))["structuredContent"]


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
