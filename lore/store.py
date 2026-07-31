from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from .paths import database

class Status(str, Enum):
    """A memory's retention status. Retention is *not* disclosure: no status
    makes a memory externally readable — only a publication does that."""

    PRIVATE = "private"
    DISCARDED = "discarded"

    def __str__(self) -> str:
        return self.value


STATUSES = tuple(status.value for status in Status)


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


class Publication(BaseModel):
    """An owner-approved, externally-disclosable artifact.

    A publication is a reusable bounded claim, or explicitly-promoted verbatim
    content. It is the *only* thing the MCP surface may return; private rows of
    any kind (memories, synthesized claims, uploaded content) are never exposed.
    """

    model_config = ConfigDict(frozen=True)

    id: int
    title: str
    content: str
    kind: PublicationKind
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
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'claim'
                    CHECK(kind IN ('claim','content')),
                provenance TEXT NOT NULL DEFAULT '[]',
                active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                source_changed_at TEXT
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS publications_fts USING fts5(
                title, content,
                content='publications', content_rowid='id',
                tokenize='unicode61 remove_diacritics 2'
            );
            CREATE TRIGGER IF NOT EXISTS publications_ai AFTER INSERT ON publications BEGIN
                INSERT INTO publications_fts(rowid,title,content)
                VALUES (new.id,new.title,new.content);
            END;
            CREATE TRIGGER IF NOT EXISTS publications_ad AFTER DELETE ON publications BEGIN
                INSERT INTO publications_fts(publications_fts,rowid,title,content)
                VALUES ('delete',old.id,old.title,old.content);
            END;
            CREATE TRIGGER IF NOT EXISTS publications_au AFTER UPDATE ON publications BEGIN
                INSERT INTO publications_fts(publications_fts,rowid,title,content)
                VALUES ('delete',old.id,old.title,old.content);
                INSERT INTO publications_fts(rowid,title,content)
                VALUES (new.id,new.title,new.content);
            END;
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
        """Set a memory's disclosure status."""
        if status not in STATUSES:
            raise ValueError(f"invalid status: {status}")
        cursor = self.db.execute(
            "UPDATE memories SET status=?,updated_at=? WHERE id=?",
            (status, datetime.now(timezone.utc).isoformat(), memory_id),
        )
        if not cursor.rowcount:
            raise ValueError(f"memory not found: {memory_id}")
        self.db.commit()

    def search(
        self, query: str, *, status: str | None = None, limit: int = 20
    ) -> list[Memory]:
        """Search memory text, optionally constrained by disclosure status."""
        if limit < 0:
            raise ValueError("limit cannot be negative")
        if status is not None and status not in STATUSES:
            raise ValueError(f"invalid status: {status}")
        status_sql = " AND m.status=?" if status else ""
        args: list[object] = []
        if query.strip():
            terms = re.findall(r"[\w-]+", query, re.UNICODE)
            if not terms:
                return []
            match = " AND ".join(f'"{term.replace(chr(34), "")}"' for term in terms)
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

    def counts(self) -> dict[str, int]:
        """Return memory counts for every disclosure status."""
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

    def setting(self, key: str, default: object = None) -> object:
        """Read a JSON-backed setting or return its default."""
        row = self.db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set_setting(self, key: str, value: object) -> None:
        """Create or replace a JSON-backed setting."""
        self.db.execute(
            "INSERT INTO settings(key,value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value, allow_nan=False)),
        )
        self.db.commit()

    def add_publication(
        self,
        *,
        title: str,
        content: str,
        kind: PublicationKind | str = PublicationKind.CLAIM,
        provenance: list[int] | None = None,
    ) -> int:
        """Create an active publication and return its id."""
        kind = PublicationKind(kind)  # rejects unknown kinds
        now = datetime.now(timezone.utc).isoformat()
        cursor = self.db.execute(
            """INSERT INTO publications(title,content,kind,provenance,active,created_at,updated_at)
               VALUES (?,?,?,?,1,?,?)""",
            (title, content, kind.value, json.dumps(list(provenance or [])), now, now),
        )
        self.db.commit()
        return int(cursor.lastrowid)

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

    def search_publications(self, query: str, *, limit: int = 5) -> list[Publication]:
        """Search active publications. This is the only externally-readable path."""
        if limit < 0:
            raise ValueError("limit cannot be negative")
        if query.strip():
            # OR over plain word tokens, not AND over hyphen-joined phrases:
            # buyers send natural-language queries ("What has this educator
            # learned about lecture-heavy courses?"), and requiring every term
            # — or treating "lecture-heavy" as a phrase — returns an empty paid
            # answer against relevant publications. bm25 still ranks the best
            # match first; disclosure is unaffected because only active
            # owner-approved publications are searched at all.
            terms = re.findall(r"\w+", query, re.UNICODE)
            if not terms:
                return []
            match = " OR ".join(f'"{term}"' for term in terms)
            sql = (
                "SELECT p.* FROM publications_fts f JOIN publications p ON p.id=f.rowid "
                "WHERE publications_fts MATCH ? AND p.active=1 "
                "ORDER BY bm25(publications_fts),p.updated_at DESC LIMIT ?"
            )
            args: list[object] = [match, limit or -1]
        else:
            sql = "SELECT * FROM publications WHERE active=1 ORDER BY updated_at DESC LIMIT ?"
            args = [limit or -1]
        return [Publication.from_row(row) for row in self.db.execute(sql, args).fetchall()]




