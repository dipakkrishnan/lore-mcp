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

# The two trees share one `nodes` table with this discriminator. The privacy
# boundary is enforced at query sites, exactly like `active=1` already is for
# publications: everything externally reachable filters tree='public'.
TREES = ("private", "public")

# ponytail: small English question stoplist; replace with an FTS query builder
# if multilingual buyer search becomes a real requirement.
QUERY_STOPWORDS = frozenset(
    "a about an and are can could do does for has have how i is it me of on or "
    "person tell that the this to what when where who why with you your".split()
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
    # Private-tree placement; None means unfiled. Filing is organization only —
    # it never affects retention or disclosure.
    node_id: int | None = None

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
    # Owner-approved grouping label, assigned at publish-approval time. It is the
    # only field external discovery surfaces may ever group or label by — deriving
    # labels any other way would disclose text no one approved.
    topic: str = ""
    provenance: list[int]
    active: int
    # Public-tree placement; None means unfiled (searchable but absent from the
    # discovery manifest).
    node_id: int | None = None
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


class Node(BaseModel):
    """One node of a tree: owner-mutable structure that content attaches to.

    Nodes organize; they never disclose. Deleting or moving a node cannot
    delete a memory or revoke a publication, and only public-tree nodes are
    ever rendered externally — and then only their title and description.
    """

    model_config = ConfigDict(frozen=True)

    id: int
    tree: str
    parent_id: int | None
    title: str
    description: str = ""
    # Owner-private annotations (e.g. the blueprint axis a tree was seeded
    # from). Never serialized to any external surface.
    metadata: dict = {}
    position: int
    created_at: str
    updated_at: str

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Node:
        """Build a Node from a `nodes` row."""
        return cls.model_validate(
            {key: row[key] for key in row.keys()}
            | {"metadata": json.loads(row["metadata"])}
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
            CREATE TABLE IF NOT EXISTS nodes (
                id INTEGER PRIMARY KEY,
                tree TEXT NOT NULL CHECK(tree IN ('private','public')),
                parent_id INTEGER,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                metadata TEXT NOT NULL DEFAULT '{}',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                -- The composite key lets the parent FK carry `tree` too, so a
                -- public node can never parent under a private one (or vice
                -- versa) no matter what code writes the row.
                UNIQUE(id, tree),
                FOREIGN KEY(parent_id, tree) REFERENCES nodes(id, tree)
                    ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS nodes_by_parent
                ON nodes(tree, parent_id, position, id);
            -- ifnull collapses NULL parents so root titles are unique per tree:
            -- plain UNIQUE treats NULLs as distinct. Node ids start at 1, so 0
            -- is a safe sentinel. This is also what makes topic->node seeding
            -- and repeated `lore tree init` runs idempotent.
            CREATE UNIQUE INDEX IF NOT EXISTS nodes_sibling_title
                ON nodes(tree, ifnull(parent_id, 0), title);
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
                node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
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
                topic TEXT NOT NULL DEFAULT '',
                provenance TEXT NOT NULL DEFAULT '[]',
                active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
                node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
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
        # Databases created before the topic column existed: CREATE IF NOT EXISTS
        # never alters, so add it in place. New databases already have it.
        columns = {row["name"] for row in self.db.execute("PRAGMA table_info(publications)")}
        if "topic" not in columns:
            self.db.execute("ALTER TABLE publications ADD COLUMN topic TEXT NOT NULL DEFAULT ''")
        # Same pattern for the tree attachment columns. NULL means "unfiled",
        # which stays a valid state forever — deleting tree structure must never
        # delete content, so content rows only ever reference nodes weakly.
        if "node_id" not in columns:
            self.db.execute(
                "ALTER TABLE publications ADD COLUMN node_id INTEGER "
                "REFERENCES nodes(id) ON DELETE SET NULL"
            )
        memory_columns = {row["name"] for row in self.db.execute("PRAGMA table_info(memories)")}
        if "node_id" not in memory_columns:
            self.db.execute(
                "ALTER TABLE memories ADD COLUMN node_id INTEGER "
                "REFERENCES nodes(id) ON DELETE SET NULL"
            )
        self.db.commit()
        # Seed the public tree from legacy flat topics: each distinct topic on an
        # unfiled publication becomes a root public node. Revoked publications
        # seed too — the owner keeps their full structure; external surfaces
        # prune empty branches. Only `node_id IS NULL` rows are touched and node
        # creation is get-or-create, so reopening the database creates nothing.
        # The private tree is deliberately NOT seeded here: that needs the
        # blueprint, and this module stays blueprint-agnostic because _migrate
        # runs on every open, including inside the MCP request path. Private
        # seeding is an explicit owner action: `lore tree init`.
        for row in self.db.execute(
            "SELECT DISTINCT topic FROM publications "
            "WHERE node_id IS NULL AND trim(topic)<>''"
        ).fetchall():
            node_id = self.get_or_create_node(tree="public", title=row["topic"])
            self.db.execute(
                "UPDATE publications SET node_id=? WHERE topic=? AND node_id IS NULL",
                (node_id, row["topic"]),
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
        topic: str = "",
        provenance: list[int] | None = None,
        node_id: int | None = None,
    ) -> int:
        """Create an active publication and return its id.

        Every publication lands on a public node so the discovery manifest has
        no orphans: an explicit `node_id` wins, otherwise a root node named
        after the topic is reused or created.
        """
        kind = PublicationKind(kind)  # rejects unknown kinds
        if not all(isinstance(value, str) and value.strip() for value in (title, content, topic)):
            raise ValueError("publication title, content, and topic cannot be empty")
        if not isinstance(provenance, list) or not provenance or not all(
            isinstance(i, int) and not isinstance(i, bool) for i in provenance
        ):
            raise ValueError("publication provenance must be a non-empty list of memory ids")
        missing = self.missing_memories(provenance)
        if missing:
            raise ValueError(f"publication provenance references unknown memories: {missing}")
        if node_id is not None:
            node = self._node_row(node_id)
            if node["tree"] != "public":
                raise ValueError(f"publications attach to public nodes; node {node_id} is private")
        else:
            node_id = self.get_or_create_node(tree="public", title=topic)
        now = datetime.now(timezone.utc).isoformat()
        cursor = self.db.execute(
            """INSERT INTO publications(title,content,kind,topic,provenance,active,node_id,created_at,updated_at)
               VALUES (?,?,?,?,?,1,?,?,?)""",
            (title.strip(), content.strip(), kind.value, topic.strip(), json.dumps(provenance), node_id, now, now),
        )
        self.db.commit()
        return int(cursor.lastrowid)

    def missing_memories(self, ids: list[int]) -> list[int]:
        """Return the subset of ids with no memory row, preserving order."""
        found = {
            row["id"]
            for row in self.db.execute(
                f"SELECT id FROM memories WHERE id IN ({','.join('?' * len(ids))})",
                ids,
            )
        } if ids else set()
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

    def search_publications(self, query: str, *, limit: int = 5) -> list[Publication]:
        """Search active publications. This is the only externally-readable path."""
        if limit < 0:
            raise ValueError("limit cannot be negative")
        if query.strip():
            # OR over meaningful word tokens, not AND over hyphen-joined phrases:
            # buyers send natural-language queries ("What has this educator
            # learned about lecture-heavy courses?"), and requiring every term
            # — or treating "lecture-heavy" as a phrase — returns an empty paid
            # answer. Common question words are removed so OR does not turn
            # unrelated publications into false positives.
            terms = list(dict.fromkeys(
                term.casefold()
                for term in re.findall(r"\w+", query, re.UNICODE)
                if term.casefold() not in QUERY_STOPWORDS
            ))
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

    def _node_row(self, node_id: int) -> sqlite3.Row:
        row = self.db.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
        if row is None:
            raise ValueError(f"node not found: {node_id}")
        return row

    def add_node(
        self,
        *,
        tree: str,
        title: str,
        parent_id: int | None = None,
        description: str = "",
    ) -> int:
        """Create a node and return its id. Position appends after siblings."""
        if tree not in TREES:
            raise ValueError(f"invalid tree: {tree}")
        if not isinstance(title, str) or not title.strip():
            raise ValueError("node title cannot be empty")
        if parent_id is not None:
            parent = self._node_row(parent_id)
            if parent["tree"] != tree:
                raise ValueError(
                    f"parent node {parent_id} is in the {parent['tree']} tree, not {tree}"
                )
        position = self.db.execute(
            "SELECT coalesce(max(position),-1)+1 next FROM nodes "
            "WHERE tree=? AND parent_id IS ?",
            (tree, parent_id),
        ).fetchone()["next"]
        now = datetime.now(timezone.utc).isoformat()
        try:
            cursor = self.db.execute(
                """INSERT INTO nodes(tree,parent_id,title,description,metadata,
                   position,created_at,updated_at) VALUES (?,?,?,?,'{}',?,?,?)""",
                (tree, parent_id, title.strip(), description.strip(), position, now, now),
            )
        except sqlite3.IntegrityError as error:
            raise ValueError(f"a sibling node is already titled {title.strip()!r}") from error
        self.db.commit()
        return int(cursor.lastrowid)

    def get_or_create_node(
        self, *, tree: str, title: str, parent_id: int | None = None
    ) -> int:
        """Return the id of the matching node, creating it if absent.

        The idempotency workhorse: legacy topic seeding, `lore tree init`, and
        default publication placement all funnel through it.
        """
        if tree not in TREES:
            raise ValueError(f"invalid tree: {tree}")
        title = title.strip() if isinstance(title, str) else ""
        if not title:
            raise ValueError("node title cannot be empty")
        row = self.db.execute(
            "SELECT id FROM nodes WHERE tree=? AND parent_id IS ? AND title=?",
            (tree, parent_id, title),
        ).fetchone()
        if row:
            return int(row["id"])
        return self.add_node(tree=tree, title=title, parent_id=parent_id)

    def rename_node(
        self, node_id: int, *, title: str | None = None, description: str | None = None
    ) -> None:
        """Update a node's title and/or description.

        Renaming restructures the owner's catalog only: a publication's
        `topic` is approved text and is never rewritten by a node rename.
        """
        row = self._node_row(node_id)
        new_title = row["title"] if title is None else title.strip()
        new_description = row["description"] if description is None else description.strip()
        if not new_title:
            raise ValueError("node title cannot be empty")
        try:
            self.db.execute(
                "UPDATE nodes SET title=?,description=?,updated_at=? WHERE id=?",
                (new_title, new_description, datetime.now(timezone.utc).isoformat(), node_id),
            )
        except sqlite3.IntegrityError as error:
            raise ValueError(f"a sibling node is already titled {new_title!r}") from error
        self.db.commit()

    def move_node(
        self, node_id: int, *, parent_id: int | None = None, position: int | None = None
    ) -> None:
        """Reparent a node (None means root). Refuses cycles and cross-tree moves."""
        row = self._node_row(node_id)
        if parent_id is not None:
            if parent_id == node_id:
                raise ValueError("a node cannot be its own parent")
            parent = self._node_row(parent_id)
            if parent["tree"] != row["tree"]:
                raise ValueError(
                    f"node {node_id} is in the {row['tree']} tree; "
                    f"node {parent_id} is in the {parent['tree']} tree"
                )
            cycle = self.db.execute(
                """WITH RECURSIVE ancestors(id) AS (
                       SELECT parent_id FROM nodes WHERE id=?
                       UNION ALL
                       SELECT n.parent_id FROM nodes n JOIN ancestors a ON n.id=a.id
                   ) SELECT 1 FROM ancestors WHERE id=?""",
                (parent_id, node_id),
            ).fetchone()
            if cycle:
                raise ValueError("cannot move a node under its own descendant")
        if position is None:
            position = self.db.execute(
                "SELECT coalesce(max(position),-1)+1 next FROM nodes "
                "WHERE tree=? AND parent_id IS ?",
                (row["tree"], parent_id),
            ).fetchone()["next"]
        try:
            self.db.execute(
                "UPDATE nodes SET parent_id=?,position=?,updated_at=? WHERE id=?",
                (parent_id, position, datetime.now(timezone.utc).isoformat(), node_id),
            )
        except sqlite3.IntegrityError as error:
            raise ValueError(
                f"a node titled {row['title']!r} already exists there"
            ) from error
        self.db.commit()

    def delete_node(self, node_id: int, *, recursive: bool = False) -> None:
        """Delete a node. Structure only: attached rows survive, unfiled.

        Without `recursive`, refuses if the subtree has descendants or attached
        rows. With it, the subtree cascades away and every attached memory or
        publication is detached (node_id set NULL) — never deleted or revoked.
        """
        self._node_row(node_id)
        if not recursive:
            subtree = [
                r["id"]
                for r in self.db.execute(
                    """WITH RECURSIVE subtree(id) AS (
                           SELECT id FROM nodes WHERE id=?
                           UNION ALL
                           SELECT n.id FROM nodes n JOIN subtree s ON n.parent_id=s.id
                       ) SELECT id FROM subtree""",
                    (node_id,),
                )
            ]
            marks = ",".join("?" * len(subtree))
            attached = self.db.execute(
                f"SELECT (SELECT count(*) FROM memories WHERE node_id IN ({marks}))"
                f" + (SELECT count(*) FROM publications WHERE node_id IN ({marks})) total",
                subtree + subtree,
            ).fetchone()["total"]
            descendants = len(subtree) - 1
            if descendants or attached:
                raise ValueError(
                    f"node {node_id} still has {descendants} descendant node(s) and "
                    f"{attached} attached item(s); move them first or delete recursively"
                )
        self.db.execute("DELETE FROM nodes WHERE id=?", (node_id,))
        self.db.commit()

    def attach_publication(self, publication_id: int, node_id: int | None) -> None:
        """File a publication under a public node; None unfiles it.

        The publication's `updated_at` is untouched: filing changes structure,
        not the approved text, and the manifest's last-updated rollup must not
        move when nothing published actually changed.
        """
        if node_id is not None:
            node = self._node_row(node_id)
            if node["tree"] != "public":
                raise ValueError(f"publications attach to public nodes; node {node_id} is private")
        cursor = self.db.execute(
            "UPDATE publications SET node_id=? WHERE id=?", (node_id, publication_id)
        )
        if not cursor.rowcount:
            raise ValueError(f"publication not found: {publication_id}")
        self.db.commit()

    def attach_memory(self, memory_id: int, node_id: int | None) -> None:
        """File a memory under a private node; None unfiles it."""
        if node_id is not None:
            node = self._node_row(node_id)
            if node["tree"] != "private":
                raise ValueError(f"memories attach to private nodes; node {node_id} is public")
        cursor = self.db.execute(
            "UPDATE memories SET node_id=? WHERE id=?", (node_id, memory_id)
        )
        if not cursor.rowcount:
            raise ValueError(f"memory not found: {memory_id}")
        self.db.commit()

    def set_node_metadata(self, node_id: int, metadata: dict) -> None:
        """Replace a node's owner-private annotations (e.g. the seeding axis)."""
        self._node_row(node_id)
        if not isinstance(metadata, dict):
            raise ValueError("node metadata must be an object")
        self.db.execute(
            "UPDATE nodes SET metadata=?,updated_at=? WHERE id=?",
            (
                json.dumps(metadata, allow_nan=False),
                datetime.now(timezone.utc).isoformat(),
                node_id,
            ),
        )
        self.db.commit()

    def node_counts(self, tree: str) -> dict[int, int]:
        """Direct (non-recursive) retained/active attachment counts per node."""
        if tree not in TREES:
            raise ValueError(f"invalid tree: {tree}")
        table, where = (
            ("publications", "active=1") if tree == "public" else ("memories", "status='private'")
        )
        return {
            row["node_id"]: row["count"]
            for row in self.db.execute(
                f"SELECT node_id,count(*) count FROM {table} "
                f"WHERE {where} AND node_id IS NOT NULL GROUP BY node_id"
            )
        }

    def unfiled_counts(self) -> dict[str, int]:
        """Count retained memories and active publications with no node."""
        return {
            "private": self.db.execute(
                "SELECT count(*) count FROM memories "
                "WHERE status='private' AND node_id IS NULL"
            ).fetchone()["count"],
            "public": self.db.execute(
                "SELECT count(*) count FROM publications "
                "WHERE active=1 AND node_id IS NULL"
            ).fetchone()["count"],
        }

    def list_nodes(self, tree: str) -> list[Node]:
        """Return one tree's nodes, parents before their children's positions."""
        if tree not in TREES:
            raise ValueError(f"invalid tree: {tree}")
        rows = self.db.execute(
            "SELECT * FROM nodes WHERE tree=? ORDER BY parent_id,position,id", (tree,)
        ).fetchall()
        return [Node.from_row(row) for row in rows]

    def public_tree(self, *, include_empty: bool = False) -> list[dict]:
        """Build the externally-visible manifest from the public tree.

        Derived from active publications only, so it is byte-identical under
        any private change — that invariant is what makes it safe to return
        from `discover`. With the default `include_empty=False` (the only mode
        external surfaces may use), branches whose subtree holds no active
        publication are pruned entirely: revoking a publication removes any
        grouping that existed only to hold it.
        """
        stats = {
            row["node_id"]: (row["count"], row["last_updated"])
            for row in self.db.execute(
                "SELECT node_id,count(*) count,max(updated_at) last_updated "
                "FROM publications WHERE active=1 AND node_id IS NOT NULL "
                "GROUP BY node_id"
            )
        }
        return self._assemble("public", stats, "publication_count", include_empty)

    def private_tree(self) -> list[dict]:
        """Build the owner's private tree with retained-memory rollups.

        Owner-only: this structure must never be serialized to any external
        surface.
        """
        stats = {
            row["node_id"]: (row["count"], row["last_updated"])
            for row in self.db.execute(
                "SELECT node_id,count(*) count,max(updated_at) last_updated "
                "FROM memories WHERE status='private' AND node_id IS NOT NULL "
                "GROUP BY node_id"
            )
        }
        return self._assemble("private", stats, "memory_count", True)

    def _assemble(
        self,
        tree: str,
        stats: dict[int, tuple[int, str]],
        count_key: str,
        include_empty: bool,
    ) -> list[dict]:
        """Nest one tree's nodes with bottom-up count and freshness rollups.

        Output is deterministic — (position, id) order, fixed key set of
        title/description/count/last_updated/children — because the privacy
        test compares serialized manifests byte for byte. Node ids and
        `metadata` are deliberately absent: the external text surface is
        exactly the owner-approved title and description.
        """
        children: dict[int | None, list[sqlite3.Row]] = {}
        for row in self.db.execute(
            "SELECT id,parent_id,title,description FROM nodes "
            "WHERE tree=? ORDER BY position,id",
            (tree,),
        ).fetchall():
            children.setdefault(row["parent_id"], []).append(row)

        def build(parent_id: int | None) -> list[dict]:
            built = []
            for row in children.get(parent_id, []):
                subnodes = build(row["id"])
                count, last_updated = stats.get(row["id"], (0, None))
                for child in subnodes:
                    count += child[count_key]
                    if child["last_updated"] and (
                        last_updated is None or child["last_updated"] > last_updated
                    ):
                        last_updated = child["last_updated"]
                if not count and not include_empty:
                    continue
                built.append(
                    {
                        "title": row["title"],
                        "description": row["description"],
                        count_key: count,
                        "last_updated": last_updated,
                        "children": subnodes,
                    }
                )
            return built

        return build(None)


