from __future__ import annotations

import os
from pathlib import Path


def home() -> Path:
    return Path(os.environ.get("LORE_HOME", "~/.lore")).expanduser()


def store_folder() -> Path:
    """The store's code and tools, which Lore runs with the owner's Cloudflare sign-in.

    Outside Lore's home, which the desktop agent can write, beside the desktop app's
    other private files.
    """
    default = "~/Library/Application Support/Lore/store"
    return Path(os.environ.get("LORE_STORE", default)).expanduser()


def database() -> Path:
    return home() / "lore.db"


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", "~/.codex")).expanduser()


def claude_home() -> Path:
    return Path(os.environ.get("CLAUDE_HOME", "~/.claude")).expanduser()


def obsidian_home() -> Path:
    default = "~/Library/Application Support/obsidian"
    return Path(os.environ.get("OBSIDIAN_HOME", default)).expanduser()
