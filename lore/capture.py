from __future__ import annotations

import hashlib
import json
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    TypeAdapter,
    field_validator,
)

from .store import Store
from .ui import CONTROL_CHARACTERS

MAX_ENTRIES = 20
MAX_TITLE = 200
MAX_CONTENT = 20_000
MAX_PROJECT = 200
MAX_SOURCE_PATH = 1_000
MAX_LINKS = 20
MAX_REASON = 300
_CONTROLS_TO_SPACES = dict.fromkeys(CONTROL_CHARACTERS, " ")
_CONTENT_CONTROLS = _CONTROLS_TO_SPACES | {ord("\n"): "\n"}


class Related(BaseModel):
    """An earlier memory a new one grows out of, and the one sentence that connects
    them (CAP-002). Proposed by the agent, kept only if the owner leaves it in."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: StrictInt
    reason: str = Field(min_length=1, max_length=MAX_REASON)
    # What the card showed it as; the link itself reads the memory's own title.
    title: str = Field(default="", max_length=MAX_TITLE)

    @field_validator("reason", mode="before")
    @classmethod
    def one_line(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.translate(_CONTROLS_TO_SPACES).split())


class CaptureEntry(BaseModel):
    """One owner-approved private memory crossing the agent/CLI boundary."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    title: str = Field(min_length=1, max_length=MAX_TITLE)
    content: str = Field(min_length=1, max_length=MAX_CONTENT)
    project: str = Field(default="general", min_length=1, max_length=MAX_PROJECT)
    source_path: str = Field(
        default="agent-session", min_length=1, max_length=MAX_SOURCE_PATH
    )
    related: list[Related] = Field(default_factory=list, max_length=MAX_LINKS)

    @field_validator("title", "project", "source_path", mode="before")
    @classmethod
    def clean_single_line(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.translate(_CONTROLS_TO_SPACES).split())

    @field_validator("content", mode="before")
    @classmethod
    def clean_content(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        value = value.replace("\r\n", "\n").replace("\r", "\n")
        return value.translate(_CONTENT_CONTROLS).strip()


CaptureBatch: TypeAdapter[list[CaptureEntry]] = TypeAdapter(
    Annotated[list[CaptureEntry], Field(min_length=1, max_length=MAX_ENTRIES)]
)


def normalize(raw: object) -> list[CaptureEntry]:
    """Validate agent-proposed, owner-corrected private memory entries."""
    return CaptureBatch.validate_python(raw)


def _digest(data: dict[str, str]) -> str:
    return hashlib.sha256(
        json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def save(raw: object) -> list[dict[str, object]]:
    """Store validated entries privately and return their ids and outcomes."""
    entries = normalize(raw)  # validate the whole batch before writing any row
    results: list[dict[str, object]] = []
    with Store() as store:
        _check_links(store, entries)  # and every link, before writing any row
        for entry in entries:
            data = entry.model_dump(mode="json", exclude={"related"})
            # A capture's identity is its text; source_path is provenance about
            # that text. Keying identity on the text alone makes a corrected
            # locator update the existing row instead of adding a sibling —
            # and, deliberately, flags any publication derived from it, since
            # the provenance behind a published claim did change. Including
            # source_path in the fingerprint is what makes the correction
            # register as a change rather than "unchanged".
            identity = {k: v for k, v in data.items() if k != "source_path"}
            source_key = f"capture:{_digest(identity)}"
            fingerprint = _digest(data)
            outcome = store.put(
                source="capture",
                origin="attended",
                source_key=source_key,
                fingerprint=fingerprint,
                **data,
            )
            row = store.db.execute(
                "SELECT id FROM memories WHERE source_key=?", (source_key,)
            ).fetchone()
            if entry.related:
                store.add_links(
                    int(row["id"]), [(link.id, link.reason) for link in entry.related]
                )
            results.append({"id": row["id"], "status": outcome, "title": entry.title})
    return results


def _check_links(store: Store, entries: list[CaptureEntry]) -> None:
    """Refuse the batch, naming the link, when any entry links to a memory that isn't
    there, isn't private, or is the very memory the entry would update."""
    for entry in entries:
        if not entry.related:
            continue
        data = entry.model_dump(mode="json", exclude={"related", "source_path"})
        itself = store.db.execute(
            "SELECT id FROM memories WHERE source_key=?",
            (f"capture:{_digest(data)}",),
        ).fetchone()
        for link in entry.related:
            target = store.db.execute(
                "SELECT status FROM memories WHERE id=?", (link.id,)
            ).fetchone()
            if itself and itself["id"] == link.id:
                problem = "is this memory itself"
            elif target is None:
                problem = "doesn't exist"
            elif target["status"] != "private":
                problem = "was discarded"
            else:
                continue
            raise ValueError(
                f"“{entry.title}” links to memory {link.id}, which {problem}; "
                "drop that link and try again"
            )
