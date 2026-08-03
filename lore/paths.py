from __future__ import annotations

import os
import tempfile
from pathlib import Path


def write_private(path: Path, text: str) -> None:
    """Write owner-only text so an interrupted write cannot destroy what was there.

    The interview checkpoint, the synthesis profile and its prompt are what an
    interrupted onboarding is resumed from, and the code that reads them refuses to
    merge into a file it cannot parse — it tells the owner to delete it and start
    over. Truncating one in place would therefore turn a kill or a full disk into
    the loss of every earlier answer, which is the failure this path exists to
    survive. The content lands in a sibling temporary file and replaces the target
    only once it is whole.
    """
    directory = path.parent
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    # The temporary file shares the directory so the replace stays within one
    # filesystem, which is what makes it atomic.
    handle, created = tempfile.mkstemp(dir=directory, prefix=f".{path.name}.", suffix=".tmp")
    os.close(handle)
    temporary = Path(created)
    try:
        temporary.chmod(0o600)
        temporary.write_text(text, encoding="utf-8")
        # Replacing carries the temporary file's 0600 across, tightening a target
        # that was somehow left readable rather than trusting its existing mode.
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def home() -> Path:
    return Path(os.environ.get("LORE_HOME", "~/.lore")).expanduser()


def database() -> Path:
    return home() / "lore.db"


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", "~/.codex")).expanduser()


def claude_home() -> Path:
    return Path(os.environ.get("CLAUDE_HOME", "~/.claude")).expanduser()

