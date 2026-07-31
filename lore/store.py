from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

from .paths import database
from .search import match_expression


class Status(str, Enum):
    """A memory's retention status. Retention is *not* disclosure: no status
    makes a memory externally readable — only a publication does that."""

    PRIVATE = "private"
    DISCARDED = "discarded"

    def __str__(self) -> str:
        return self.value


STATUSES = tuple(status.value for status in Status)


def new_public_id() -> str:
    """Mint an opaque id with a checksum that catches damaged copies."""
    body = secrets.token_hex(8)
    return body + hashlib.sha256(body.encode()).hexdigest()[:8]


def valid_public_id(value: str) -> bool:
    """Whether an id is structurally intact; existence is checked separately."""
    return bool(re.fullmatch(r"[0-9a-f]{24}", value)) and secrets.compare_digest(
        value[16:], hashlib.sha256(value[:16].encode()).hexdigest()[:8]
    )


class Memory(BaseModel):
    """A normalized memory and its owner-controlled retention status."""

    model_config = ConfigDict(frozen=True)

    id: int
    source: str
    origin: str
    title: str
    content: str
    project: str
    status: Status
    source_path: str
    updated_at: str

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Memory:
        """Build a Memory from a `memories` row."""
        return cls.model_validate({key: row[key] for key in row.keys()})


class PublicationKind(str, Enum):
    """What an owner published: a derived claim, or promoted verbatim content."""

    CLAIM = "claim"
    CONTENT = "content"

    def __str__(self) -> str:
        return self.value


class PublicationInput(BaseModel):
    """Validated publication fields before database-backed provenance checks."""

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    kind: PublicationKind = PublicationKind.CLAIM
    topic: str = Field(min_length=1)
    teaser: str = ""
    provenance: list[StrictInt] = Field(min_length=1)


class Publication(BaseModel):
    """An owner-approved, externally-disclosable artifact.

    A publication is a reusable bounded claim, or explicitly-promoted verbatim
    content. It is the *only* thing the MCP surface may return; private rows of
    any kind (memories, synthesized claims, uploaded content) are never exposed.
    """

    model_config = ConfigDict(frozen=True)

    id: int
    # The buyer-facing handle: an opaque random token plus a damage-detecting
    # checksum, minted at publish time and validated before any payment.
    # The integer primary key is owner-only — sequential ids on the wire leak
    # withdrawals, because revoking one leaves a visible gap in the sequence.
    public_id: str = ""
    title: str
    content: str
    kind: PublicationKind
    # Owner-approved grouping label, assigned at publish-approval time. It is the
    # only field external discovery surfaces may ever group or label by — deriving
    # labels any other way would disclose text no one approved.
    topic: str = ""
    # The free face: an owner-approved advertisement of what exists, written to
    # sell without giving the lesson away. The manifest renders teasers only —
    # a publication without one is never advertised, and its unguessable
    # public_id means absence from the catalog is true absence.
    teaser: str = ""
    provenance: list[int]
    active: int
    created_at: str
    updated_at: str
    # Set when a memory this publication derives from changed afterwards, so the
    # owner can re-approve or revoke. The published text is untouched.
    source_changed_at: str | None = None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Publication:
        """Build a Publication from a `publications` row."""
        return cls.model_validate(
            {key: row[key] for key in row.keys()}
            | {"provenance": json.loads(row["provenance"])}
        )


class AnswerSettings(BaseModel):
    model_config = ConfigDict(frozen=True)

    proxy_preamble: str = ""
    answer_price_usd: float = 0.0
    answer_enabled: bool = False

    @model_validator(mode="after")
    def enabled_needs_proxy_and_price(self) -> "AnswerSettings":
        if self.answer_enabled and not (
            self.proxy_preamble.strip() and self.answer_price_usd > 0
        ):
            raise ValueError(
                "the answer tier cannot be enabled without an approved proxy charter "
                "and a positive answer price"
            )
        return self


class Store:
    """Small SQLite repository for memories and Lore settings."""

    def __init__(self, path: Path | None = None):
        self.path = path or database()
        # Memories are private: 0700 for their directory and 0600 for the database.
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if path is None:
            self.path.parent.chmod(0o700)
        self.db = sqlite3.connect(self.path)
        self.path.chmod(0o600)
        self.db.row_factory = sqlite3.Row
        self._migrate()

    def close(self) -> None:
        self.db.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _migrate(self) -> None:
        self.db.executescript(
            """
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY,
                source TEXT NOT NULL,
                origin TEXT NOT NULL DEFAULT 'native',
                source_path TEXT NOT NULL,
                source_key TEXT NOT NULL UNIQUE,
                fingerprint TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                project TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'private'
                    CHECK(status IN ('private','discarded')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                title, content, project,
                content='memories', content_rowid='id',
                tokenize='unicode61 remove_diacritics 2'
            );
            CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid,title,content,project)
                VALUES (new.id,new.title,new.content,new.project);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts,rowid,title,content,project)
                VALUES ('delete',old.id,old.title,old.content,old.project);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts,rowid,title,content,project)
                VALUES ('delete',old.id,old.title,old.content,old.project);
                INSERT INTO memories_fts(rowid,title,content,project)
                VALUES (new.id,new.title,new.content,new.project);
            END;
            CREATE TABLE IF NOT EXISTS publications (
                id INTEGER PRIMARY KEY,
                public_id TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'claim'
                    CHECK(kind IN ('claim','content')),
                topic TEXT NOT NULL DEFAULT '',
                teaser TEXT NOT NULL DEFAULT '',
                provenance TEXT NOT NULL DEFAULT '[]',
                active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                source_changed_at TEXT
            );
            -- The buyer surface is a manifest plus fetch-by-id, so publications
            -- are never text-searched. Roll-forward: drop the FTS index and
            -- triggers from databases created when they existed.
            DROP TRIGGER IF EXISTS publications_ai;
            DROP TRIGGER IF EXISTS publications_ad;
            DROP TRIGGER IF EXISTS publications_au;
            DROP TABLE IF EXISTS publications_fts;
            """
        )
        # Roll-forward normalization, not back-compat: a database created before
        # the retention-only status model may hold 'pending' or 'external' rows,
        # which `Status` now rejects — without this line any search touching one
        # crashes, with no CLI remedy. They become plain private rows; legacy
        # semantics are not preserved.
        self.db.execute(
            "UPDATE memories SET status='private' "
            "WHERE status NOT IN ('private','discarded')"
        )
        # Databases created before a column existed: CREATE IF NOT EXISTS never
        # alters, so add it in place. New databases already have it.
        columns = {
            row["name"] for row in self.db.execute("PRAGMA table_info(publications)")
        }
        for column in ("topic", "teaser", "public_id"):
            if column not in columns:
                self.db.execute(
                    f"ALTER TABLE publications ADD COLUMN {column} TEXT NOT NULL DEFAULT ''"
                )
        # Mint public ids for rows that predate them, then enforce uniqueness.
        for row in self.db.execute(
            "SELECT id FROM publications WHERE public_id=''"
        ).fetchall():
            self.db.execute(
                "UPDATE publications SET public_id=? WHERE id=?",
                (new_public_id(), row["id"]),
            )
        self.db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS publications_public_id "
            "ON publications(public_id)"
        )
        self.db.commit()

    def put(
        self,
        *,
        source: str,
        origin: str,
        source_path: str,
        source_key: str,
        fingerprint: str,
        title: str,
        content: str,
        project: str = "",
    ) -> str:
        """Insert or update a memory, returning added, updated, or unchanged."""
        now = datetime.now(timezone.utc).isoformat()
        row = self.db.execute(
            "SELECT id,fingerprint FROM memories WHERE source_key=?", (source_key,)
        ).fetchone()
        if row and row["fingerprint"] == fingerprint:
            return "unchanged"
        if row:
            # A changed memory keeps its retention status: it is already private,
            # and re-queueing it for review would rebuild the queue this model
            # exists to remove. What a change *can* invalidate is a publication
            # derived from it, so flag those for the owner to re-approve instead.
            # The published text itself is unchanged and stays exactly what the
            # owner approved, so it is flagged rather than revoked.
            self.db.execute(
                """UPDATE memories SET fingerprint=?,title=?,content=?,project=?,
                   source_path=?,updated_at=? WHERE id=?""",
                (
                    fingerprint,
                    title,
                    content,
                    project,
                    source_path,
                    now,
                    row["id"],
                ),
            )
            self._flag_publications_of(row["id"], now)
            result = "updated"
        else:
            self.db.execute(
                """INSERT INTO memories
                   (source,origin,source_path,source_key,fingerprint,title,content,
                    project,status,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    source,
                    origin,
                    source_path,
                    source_key,
                    fingerprint,
                    title,
                    content,
                    project,
                    "private",
                    now,
                    now,
                ),
            )
            result = "added"
        self.db.commit()
        return result

    def set_status(self, memory_id: int, status: str) -> None:
        """Set a memory's retention status."""
        if status not in STATUSES:
            raise ValueError(f"invalid status: {status}")
        cursor = self.db.execute(
            "UPDATE memories SET status=?,updated_at=? WHERE id=?",
            (status, datetime.now(timezone.utc).isoformat(), memory_id),
        )
        if not cursor.rowcount:
            raise ValueError(f"memory not found: {memory_id}")
        self.db.commit()

    def set_title(self, memory_id: int, title: str) -> None:
        """Rename a memory."""
        title = title.strip()
        if not title:
            raise ValueError("title cannot be empty")
        cursor = self.db.execute(
            "UPDATE memories SET title=?,updated_at=? WHERE id=?",
            (title, datetime.now(timezone.utc).isoformat(), memory_id),
        )
        if not cursor.rowcount:
            raise ValueError(f"memory not found: {memory_id}")
        self.db.commit()

    def set_content(self, memory_id: int, content: str) -> None:
        """Edit a memory's content."""
        content = content.strip()
        if not content:
            raise ValueError("content cannot be empty")
        cursor = self.db.execute(
            "UPDATE memories SET content=?,updated_at=? WHERE id=?",
            (content, datetime.now(timezone.utc).isoformat(), memory_id),
        )
        if not cursor.rowcount:
            raise ValueError(f"memory not found: {memory_id}")
        self.db.commit()

    def set_status_many(self, ids: list[int], status: str) -> int:
        """Set a retention status across many memories in one statement.

        Returns the count of rows actually changed, not merely matched — a row
        already at `status` doesn't count, so a caller can report a truthful
        "N marked" instead of the size of the set it targeted.
        """
        if status not in STATUSES:
            raise ValueError(f"invalid status: {status}")
        if not ids:
            return 0
        placeholders = ",".join("?" for _ in ids)
        cursor = self.db.execute(
            f"UPDATE memories SET status=?,updated_at=? "
            f"WHERE id IN ({placeholders}) AND status!=?",
            (status, datetime.now(timezone.utc).isoformat(), *ids, status),
        )
        self.db.commit()
        return cursor.rowcount

    def search(
        self, query: str, *, status: str | None = None, limit: int = 20
    ) -> list[Memory]:
        """Search memory text, optionally constrained by retention status."""
        if limit < 0:
            raise ValueError("limit cannot be negative")
        if status is not None and status not in STATUSES:
            raise ValueError(f"invalid status: {status}")
        status_sql = " AND m.status=?" if status else ""
        args: list[object] = []
        if query.strip():
            match = match_expression(query)
            if match is None:
                return []
            sql = (
                "SELECT m.* FROM memories_fts f JOIN memories m ON m.id=f.rowid "
                f"WHERE memories_fts MATCH ?{status_sql} "
                "ORDER BY bm25(memories_fts),m.updated_at DESC LIMIT ?"
            )
            args.append(match)
        else:
            sql = f"SELECT m.* FROM memories m WHERE 1=1{status_sql} ORDER BY m.updated_at DESC LIMIT ?"
        if status:
            args.append(status)
        args.append(limit or -1)
        return [Memory.from_row(row) for row in self.db.execute(sql, args).fetchall()]

    def get(self, memory_id: int) -> Memory | None:
        """Return one memory by id, or None."""
        row = self.db.execute(
            "SELECT * FROM memories WHERE id=?", (memory_id,)
        ).fetchone()
        return Memory.from_row(row) if row else None

    def counts(self) -> dict[str, int]:
        """Return memory counts for every retention status."""
        counts = {status: 0 for status in STATUSES}
        for row in self.db.execute(
            "SELECT status,count(*) count FROM memories GROUP BY status"
        ):
            counts[row["status"]] = row["count"]
        return counts

    def source_counts(self) -> dict[str, int]:
        """Return memory counts grouped by source."""
        return {
            row["source"]: row["count"]
            for row in self.db.execute(
                "SELECT source,count(*) count FROM memories GROUP BY source"
            )
        }

    def memory_inventory(self) -> list[dict[str, object]]:
        rows = self.db.execute(
            "SELECT id,title,project,status,updated_at "
            "FROM memories ORDER BY updated_at DESC,id"
        ).fetchall()
        return [dict(row) for row in rows]

    def publication_inventory(self) -> list[dict[str, object]]:
        rows = self.db.execute(
            "SELECT id,public_id,title,topic,active "
            "FROM publications ORDER BY updated_at DESC,id"
        ).fetchall()
        return [dict(row) for row in rows]

    def setting(self, key: str, default: object = None) -> object:
        """Read a JSON-backed setting or return its default."""
        row = self.db.execute(
            "SELECT value FROM settings WHERE key=?", (key,)
        ).fetchone()
        return json.loads(row["value"]) if row else default

    def set_setting(self, key: str, value: object) -> None:
        """Create or replace a JSON-backed setting."""
        self.db.execute(
            "INSERT INTO settings(key,value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value, allow_nan=False)),
        )
        self.db.commit()

    def answer_settings(self) -> AnswerSettings:
        return AnswerSettings.model_validate(
            {
                "proxy_preamble": self.setting("proxy_preamble", ""),
                "answer_price_usd": self.setting("answer_price_usd", 0.0),
                "answer_enabled": self.setting("answer_enabled", False),
            }
        )

    def set_answer_settings(self, settings: AnswerSettings) -> None:
        values = {
            "proxy_preamble": settings.proxy_preamble,
            "answer_price_usd": settings.answer_price_usd,
            "answer_enabled": settings.answer_enabled,
        }
        with self.db:
            self.db.executemany(
                "INSERT INTO settings(key,value) VALUES (?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [
                    (key, json.dumps(value, allow_nan=False))
                    for key, value in values.items()
                ],
            )

    def add_publication(
        self,
        *,
        title: str,
        content: str,
        kind: PublicationKind | str = PublicationKind.CLAIM,
        topic: str = "",
        teaser: str = "",
        provenance: list[int] | None = None,
    ) -> int:
        """Create an active publication and return its id.

        The teaser is optional here but required by the publish flow: a
        publication without one is never rendered in the manifest, so nothing
        reaches the free surface that wasn't written as an advertisement.
        """
        publication = PublicationInput.model_validate(
            {
                "title": title,
                "content": content,
                "kind": kind,
                "topic": topic,
                "teaser": teaser,
                "provenance": provenance,
            }
        )
        missing = self.missing_memories(publication.provenance)
        if missing:
            raise ValueError(
                f"publication provenance references unknown memories: {missing}"
            )
        now = datetime.now(timezone.utc).isoformat()
        cursor = self.db.execute(
            """INSERT INTO publications(public_id,title,content,kind,topic,teaser,provenance,active,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,1,?,?)""",
            (
                new_public_id(),
                publication.title,
                publication.content,
                publication.kind.value,
                publication.topic,
                publication.teaser,
                json.dumps(publication.provenance),
                now,
                now,
            ),
        )
        self.db.commit()
        if cursor.lastrowid is None:
            raise OSError("SQLite did not return an id for the new publication")
        return cursor.lastrowid

    def missing_memories(self, ids: list[int]) -> list[int]:
        """Return the subset of ids with no memory row, preserving order."""
        found = (
            {
                row["id"]
                for row in self.db.execute(
                    f"SELECT id FROM memories WHERE id IN ({','.join('?' * len(ids))})",
                    ids,
                )
            }
            if ids
            else set()
        )
        return [i for i in ids if i not in found]

    def _flag_publications_of(self, memory_id: int, when: str) -> int:
        """Flag active publications derived from a changed memory, returning the count.

        Matching goes through `json_each` rather than a `LIKE` over the JSON
        text, so memory 1 does not match a publication derived from memory 21.
        """
        cursor = self.db.execute(
            """UPDATE publications SET source_changed_at=? WHERE active=1 AND id IN (
                   SELECT p.id FROM publications p, json_each(p.provenance) j
                   WHERE j.value=?
               )""",
            (when, memory_id),
        )
        return cursor.rowcount

    def stale_publications(self) -> list[Publication]:
        """Return active publications whose source memory changed after approval."""
        rows = self.db.execute(
            "SELECT * FROM publications WHERE active=1 AND source_changed_at IS NOT NULL "
            "ORDER BY source_changed_at DESC,id"
        ).fetchall()
        return [Publication.from_row(row) for row in rows]

    def clear_publication_flag(self, publication_id: int) -> None:
        """Record that the owner re-approved a flagged publication as-is."""
        cursor = self.db.execute(
            "UPDATE publications SET source_changed_at=NULL,updated_at=? WHERE id=?",
            (datetime.now(timezone.utc).isoformat(), publication_id),
        )
        if not cursor.rowcount:
            raise ValueError(f"publication not found: {publication_id}")
        self.db.commit()

    def revoke_publication(self, publication_id: int) -> None:
        """Mark a publication revoked so MCP can no longer return it."""
        cursor = self.db.execute(
            "UPDATE publications SET active=0,updated_at=? WHERE id=?",
            (datetime.now(timezone.utc).isoformat(), publication_id),
        )
        if not cursor.rowcount:
            raise ValueError(f"publication not found: {publication_id}")
        self.db.commit()

    def list_publications(self, *, active_only: bool = False) -> list[Publication]:
        """Return publications, most recently updated first."""
        where = " WHERE active=1" if active_only else ""
        rows = self.db.execute(
            f"SELECT * FROM publications{where} ORDER BY updated_at DESC,id"
        ).fetchall()
        return [Publication.from_row(row) for row in rows]

    def manifest(self) -> dict[str, object]:
        """Render the free discovery surface: teasers grouped by topic.

        A pure function of active publications — never materialized, so a
        revoke is gone on the very next read. Only the advertisement columns
        are selected; `content`, `title`, and provenance are unreadable here
        by construction. Publications without a teaser are not rendered: the
        owner never wrote an advertisement for them. Buyer-facing ids are the
        opaque public tokens, and freshness is truncated to the day — full
        timestamps would reveal the owner's approval-session structure.
        """
        rows = self.db.execute(
            "SELECT public_id,teaser,topic,kind,substr(updated_at,1,10) AS updated_at "
            "FROM publications WHERE active=1 AND teaser<>'' "
            "ORDER BY topic,updated_at DESC,public_id"
        ).fetchall()
        topics: dict[str, list[dict[str, object]]] = {}
        for row in rows:
            topics.setdefault(row["topic"], []).append(
                {
                    "id": row["public_id"],
                    "teaser": row["teaser"],
                    "kind": row["kind"],
                    "updated_at": row["updated_at"],
                }
            )
        return {
            "manifest_version": 1,
            "publication_count": len(rows),
            "topics": topics,
        }

    def get_publication(self, public_id: str) -> Publication:
        """Return one active publication by public id — the only paid read path."""
        if not valid_public_id(public_id):
            raise ValueError("invalid publication id; run discover again")
        row = self.db.execute(
            "SELECT * FROM publications WHERE public_id=? AND active=1", (public_id,)
        ).fetchone()
        if row is None:
            raise ValueError(f"publication not found: {public_id}")
        return Publication.from_row(row)
