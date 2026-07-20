from __future__ import annotations

import os
from pathlib import Path


def home() -> Path:
    return Path(os.environ.get("LORE_HOME", "~/.lore")).expanduser()


def database() -> Path:
    return home() / "lore.db"


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", "~/.codex")).expanduser()


def claude_home() -> Path:
    return Path(os.environ.get("CLAUDE_HOME", "~/.claude")).expanduser()

