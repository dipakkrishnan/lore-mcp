"""Text extraction for manually captured content.

Both non-session capture patterns in ``docs/manual-capture-ux.md`` — the
``~/.lore/inbox/`` dropbox and ``lore capture --file`` — route through this module
so file-type support is added once and both benefit.

Extraction never raises on bad input. An unsupported, oversized, or undecodable
file still yields an :class:`Extraction` carrying its size, fingerprint, and a
``reason``, so callers can record a capture row marked "not indexed" rather than
silently dropping a file the owner deliberately handed to Lore.

Only the stdlib-readable text types ship here (txt, md, csv, json). PDF, docx, and
image extraction need a dependency decision that waits on real dropbox usage.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

# Low single-digit MB: captures are claim-shaped notes and small documents, not
# archives. Callers may override from the ``capture_max_bytes`` setting.
MAX_BYTES = 2_000_000
SETTING_MAX_BYTES = "capture_max_bytes"

# Extensions readable as UTF-8 text with no third-party dependency.
TEXT_TYPES = ("txt", "md", "csv", "json")

# Declared types callers may pass through from a MIME sniff or an editor hint.
_ALIASES = {
    "markdown": "md",
    "mdown": "md",
    "text": "txt",
    "text/csv": "csv",
    "text/markdown": "md",
    "text/plain": "txt",
    "application/json": "json",
}


@dataclass(frozen=True)
class Extraction:
    """The result of attempting to read one captured file or blob as text."""

    kind: str
    text: str | None
    reason: str
    byte_size: int
    fingerprint: str

    @property
    def indexed(self) -> bool:
        """Whether this capture carries searchable text."""
        return self.text is not None


def normalize_type(declared: object) -> str:
    """Reduce a declared extension, filename suffix, or MIME type to a bare kind."""
    if not isinstance(declared, str):
        return ""
    kind = declared.strip().lower().lstrip(".")
    return _ALIASES.get(kind, kind)


def supported_type(declared: object) -> bool:
    """Whether Lore can extract text from this declared type today."""
    return normalize_type(declared) in TEXT_TYPES


def extract_bytes(
    data: bytes, declared: object, *, max_bytes: int = MAX_BYTES
) -> Extraction:
    """Extract text from raw bytes of a declared type, never raising on bad input."""
    kind = normalize_type(declared)
    size = len(data)
    fingerprint = hashlib.sha256(data).hexdigest()

    def result(text: str | None, reason: str) -> Extraction:
        return Extraction(kind, text, reason, size, fingerprint)

    if kind not in TEXT_TYPES:
        return result(None, "unsupported-type")
    if size > max_bytes:
        # Reported for parity with extract_file, which rejects on stat before reading.
        return result(None, "too-large")
    if b"\x00" in data:
        # A NUL byte decodes cleanly but means this is binary wearing a text suffix.
        return result(None, "binary")
    try:
        text = data.decode("utf-8").strip()
    except UnicodeError:
        return result(None, "undecodable")
    return result(text, "") if text else result(None, "empty")


def extract_file(
    path: Path, declared: object = None, *, max_bytes: int = MAX_BYTES
) -> Extraction:
    """Extract text from a file, defaulting the declared type to its suffix."""
    kind = normalize_type(path.suffix if declared is None else declared)

    # The dropbox is an owner-writable folder, so refuse anything that is not a
    # plain file: a symlink can point outside Lore's tree and a FIFO never returns.
    if path.is_symlink():
        return Extraction(kind, None, "symlink", 0, "")
    try:
        stats = path.stat()
    except OSError:
        return Extraction(kind, None, "unreadable", 0, "")
    if not path.is_file():
        return Extraction(kind, None, "not-a-file", 0, "")
    if kind not in TEXT_TYPES:
        # Checked before reading so an unsupported 5GB file is never loaded.
        return Extraction(kind, None, "unsupported-type", stats.st_size, "")
    if stats.st_size > max_bytes:
        return Extraction(kind, None, "too-large", stats.st_size, "")
    try:
        data = path.read_bytes()
    except OSError:
        return Extraction(kind, None, "unreadable", stats.st_size, "")
    return extract_bytes(data, kind, max_bytes=max_bytes)
