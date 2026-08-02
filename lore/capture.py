from __future__ import annotations

import hashlib
import json

from .store import Store
from .ui import CONTROL_CHARACTERS

MAX_ENTRIES = 20
MAX_TITLE = 200
MAX_CONTENT = 20_000
MAX_PROJECT = 200
FIELDS = {"title", "content", "project"}


def _text(value: object, field: str, limit: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"capture {field} must be text")
    value = value.translate(CONTROL_CHARACTERS).strip()
    if not value:
        raise ValueError(f"capture {field} cannot be empty")
    if len(value) > limit:
        raise ValueError(f"capture {field} cannot exceed {limit} characters")
    return value


def normalize(raw: object) -> list[dict[str, str]]:
    """Validate agent-proposed, owner-corrected private memory entries."""
    if not isinstance(raw, list) or not raw:
        raise ValueError("capture input must be a non-empty JSON array")
    if len(raw) > MAX_ENTRIES:
        raise ValueError(f"capture input cannot exceed {MAX_ENTRIES} entries")

    entries: list[dict[str, str]] = []
    for candidate in raw:
        if not isinstance(candidate, dict):
            raise ValueError("each capture entry must be a JSON object")
        unexpected = set(candidate) - FIELDS
        if unexpected:
            raise ValueError(f"unexpected capture field: {sorted(unexpected)[0]}")
        entries.append(
            {
                "title": _text(candidate.get("title"), "title", MAX_TITLE),
                "content": _text(candidate.get("content"), "content", MAX_CONTENT),
                "project": _text(
                    candidate.get("project", "general"), "project", MAX_PROJECT
                ),
            }
        )
    return entries


def save(raw: object) -> list[dict[str, object]]:
    """Store validated entries privately and return their ids and outcomes."""
    entries = normalize(raw)  # validate the whole batch before writing any row
    results: list[dict[str, object]] = []
    with Store() as store:
        for entry in entries:
            canonical = json.dumps(entry, sort_keys=True, separators=(",", ":"))
            fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
            source_key = f"capture:{fingerprint}"
            outcome = store.put(
                source="capture",
                origin="attended",
                source_path="agent-session",
                source_key=source_key,
                fingerprint=fingerprint,
                **entry,
            )
            row = store.db.execute(
                "SELECT id FROM memories WHERE source_key=?", (source_key,)
            ).fetchone()
            results.append(
                {"id": row["id"], "status": outcome, "title": entry["title"]}
            )
    return results
