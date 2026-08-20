"""The publication bundle: what a deployed node serves, and nothing else.

Deployment copies disclosable content to infrastructure Lore does not control, so
what goes into that copy is a security boundary rather than a serialization
detail. This module owns both ends of it — writing the export and reading it back
— and is the only place that decides which columns cross over.

What crosses: active publications' `public_id`, `title`, `content`, `kind`,
`topic`, `created_at`, `updated_at`, plus the `price_usd` setting. The internal
integer primary key never crosses — see `public_id` below.

What never crosses: memories of any status, revoked publications, `provenance`,
and `source_changed_at`. `provenance` is omitted because `STO-001` requires that
no buyer-facing payload disclose provenance memory ids, and the strongest way to
honor that on a remote copy is for the ids to never be in the copy — the columns
are absent from the schema, not merely unpopulated.

Stdlib only, deliberately: this module is the deployment artifact, and
`lore.store` imports pydantic. Keeping the import graph clean here is what lets
the Lambda zip stay pure-stdlib. See docs/node-deployment.md.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import NamedTuple

from .search import fts5_available, match_expression

# Bumped when the bundle's shape changes. It is part of the digest, so a format
# change reads as drift and forces a re-push rather than being silently served.
SCHEMA_VERSION = 2

# The owner-facing default, per docs/node-deployment.md. Its only job is bounding
# how long a revoked publication can stay answerable from a copy.
DEFAULT_MAX_AGE_DAYS = 7.0

# The buyer-facing shape. Deliberately `public_id`, never the internal `id`:
# sequential integer ids on the wire leak withdrawals, because revoking one
# leaves a visible gap in the sequence (see `lore.store.Publication.public_id`).
_EXPORTED_COLUMNS = (
    "public_id",
    "title",
    "content",
    "kind",
    "topic",
    "created_at",
    "updated_at",
)


# Sentinel for `BundleReader(max_age_days=...)`: use the bound the bundle records.
# A dedicated class, because both `None` (bound disabled) and every number are
# meaningful values the caller may legitimately pass, and a distinct type (unlike
# a bare `object()`) lets mypy narrow the `isinstance(max_age_days, _InheritMaxAge)`
# check below.
class _InheritMaxAge:
    pass


INHERIT_MAX_AGE = _InheritMaxAge()

SCHEMA = """
CREATE TABLE publications (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    kind TEXT NOT NULL,
    topic TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE publications_fts USING fts5(
    title, content,
    content='publications', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


class BundleExpired(Exception):
    """Raised when a bundle is older than the owner's configured max age.

    Fail-closed is the whole point: revocation is immediate locally but a deployed
    bundle is a copy, so this bound caps how long a revoked publication can keep
    being answerable when the owner forgets to re-push.
    """


class BundleUnreadable(Exception):
    """Raised when a bundle cannot be served at all, with a diagnosable reason."""


class BundlePublication(NamedTuple):
    """A publication as it exists inside a bundle.

    Field-compatible with the attributes `lore.mcp.call_tool` reads off a
    `lore.store.Publication` (`public_id`, `title`, `content`, `topic`, `kind`,
    `updated_at`), so the MCP tool code runs unchanged against either. Carries
    `public_id`, never the internal integer primary key — see the module
    docstring. A NamedTuple rather than a pydantic model keeps this module
    dependency-free.
    """

    public_id: str
    title: str
    content: str
    kind: str
    topic: str
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class BundleInfo:
    """What was exported, and the digest that makes drift detectable offline."""

    path: Path
    digest: str
    publication_count: int
    built_at: str
    price_usd: float | None
    max_age_days: float | None


def _normalize(
    publications: Iterable[BundlePublication],
) -> list[BundlePublication]:
    """Coerce rows to `BundlePublication` and order them by public_id.

    Ordering is what makes the digest independent of the query that produced the
    rows, so the same library always hashes the same way.
    """
    rows = [
        row if isinstance(row, BundlePublication) else BundlePublication(*row)
        for row in publications
    ]
    return sorted(rows, key=lambda row: row.public_id)


def digest(
    publications: Iterable[BundlePublication], price_usd: float | None
) -> str:
    """Hash the bundle's *contents*, canonically.

    Deliberately not a hash of the file bytes: SQLite files are not stable across
    rebuilds, so byte-hashing would report drift on every export. Deliberately
    excludes `built_at` for the same reason. Two exports of the same publications
    at the same price therefore produce the same digest, which is what makes
    "does the deployment match the library?" answerable without a network call.
    """
    payload = {
        "schema_version": SCHEMA_VERSION,
        "price_usd": price_usd,
        # `_asdict` rather than zipping against the column tuple, so the digest
        # cannot silently change meaning if the field order is ever edited.
        "publications": [row._asdict() for row in _normalize(publications)],
    }
    canonical = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def export(
    publications: Iterable[BundlePublication],
    *,
    price_usd: float | None,
    destination: Path,
    max_age_days: float | None = DEFAULT_MAX_AGE_DAYS,
    built_at: str | None = None,
) -> BundleInfo:
    """Write a bundle containing exactly `publications` and `price_usd`.

    Callers pass already-filtered rows; this function does not query the library,
    which keeps the "what may be exported" decision at one call site in
    `lore.deploy` instead of split across two modules.
    """
    if not fts5_available():
        raise BundleUnreadable(
            "this Python's SQLite has no FTS5 module, so a bundle cannot be built; "
            "Lore requires Python 3.12+ (see docs/fts5-lambda-runtime-spike.md)"
        )
    rows = _normalize(publications)
    if max_age_days is not None and max_age_days <= 0:
        raise ValueError("max_age_days must be positive, or None to disable")
    stamp = built_at or datetime.now(timezone.utc).isoformat()
    content_digest = digest(rows, price_usd)

    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Rebuild from empty rather than updating in place, so a bundle can never
    # retain a row that is no longer active in the library.
    destination.unlink(missing_ok=True)
    db = sqlite3.connect(destination)
    try:
        # Not WAL, and not incidentally. A WAL-mode database copied without its
        # -wal sidecar — exactly what uploading this one file does — opens
        # read-only on some SQLite builds and fails on others (3.40 and 3.53 yes,
        # 3.51 no; see docs/fts5-lambda-runtime-spike.md). DELETE mode records
        # file-format versions 1/1, which every build can read. The bundle is
        # written once and never mutated, so WAL buys nothing here anyway.
        db.execute("PRAGMA journal_mode=DELETE")
        db.executescript(SCHEMA)
        db.executemany(
            f"INSERT INTO publications({','.join(_EXPORTED_COLUMNS)}) "
            f"VALUES ({','.join('?' * len(_EXPORTED_COLUMNS))})",
            [tuple(row) for row in rows],
        )
        # One rebuild at write time instead of triggers: the bundle is written
        # once and never mutated, so triggers would be pure overhead.
        db.execute("INSERT INTO publications_fts(publications_fts) VALUES ('rebuild')")
        db.executemany(
            "INSERT INTO meta(key,value) VALUES (?,?)",
            [
                ("schema_version", json.dumps(SCHEMA_VERSION)),
                ("built_at", json.dumps(stamp)),
                ("digest", json.dumps(content_digest)),
                ("publication_count", json.dumps(len(rows))),
                ("price_usd", json.dumps(price_usd, allow_nan=False)),
                ("max_age_days", json.dumps(max_age_days, allow_nan=False)),
            ],
        )
        db.commit()
    finally:
        db.close()
    destination.chmod(0o600)
    return BundleInfo(
        path=destination,
        digest=content_digest,
        publication_count=len(rows),
        built_at=stamp,
        price_usd=price_usd,
        max_age_days=max_age_days,
    )


class BundleReader:
    """Read-only access to a bundle, shaped like the subset of `Store` MCP uses.

    Exposes `search_publications` and `setting` so `lore.mcp.call_tool` works
    against a bundle without a second implementation of the tool surface.
    """

    def __init__(
        self,
        path: Path,
        *,
        max_age_days: float | None | _InheritMaxAge = INHERIT_MAX_AGE,
        now: datetime | None = None,
    ):
        """Open a bundle.

        `max_age_days` defaults to using the bound recorded in the bundle. Pass
        None to disable the bound, or a number to override it.
        """
        if not fts5_available():
            raise BundleUnreadable(
                "this runtime's SQLite has no FTS5 module, so the bundle's search "
                "index cannot be read; deploy on Python 3.12 or newer "
                "(see docs/fts5-lambda-runtime-spike.md)"
            )
        self.path = Path(path)
        try:
            self.db = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
            self.db.row_factory = sqlite3.Row
            self._meta = {
                row["key"]: json.loads(row["value"])
                for row in self.db.execute("SELECT key,value FROM meta")
            }
        except sqlite3.Error as error:
            raise BundleUnreadable(f"bundle at {self.path} is not readable: {error}")
        version = self._meta.get("schema_version")
        if version != SCHEMA_VERSION:
            raise BundleUnreadable(
                f"bundle schema version {version!r} is not {SCHEMA_VERSION}"
            )
        self._now = now
        self._max_age_days: float | None = (
            self._meta.get("max_age_days")
            if isinstance(max_age_days, _InheritMaxAge)
            else max_age_days
        )

    def close(self) -> None:
        self.db.close()

    def __enter__(self) -> "BundleReader":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    @property
    def built_at(self) -> str:
        return str(self._meta["built_at"])

    @property
    def digest(self) -> str:
        return str(self._meta["digest"])

    @property
    def max_age_days(self) -> float | None:
        return self._max_age_days

    @property
    def age(self) -> timedelta:
        """How long ago this bundle was built."""
        now = self._now or datetime.now(timezone.utc)
        try:
            built = datetime.fromisoformat(self.built_at)
        except ValueError as error:
            raise BundleUnreadable(f"bundle has an unparseable build time: {error}")
        # A bundle Lore wrote always stamps an aware timestamp. Treating a naive
        # one as UTC keeps a hand-edited bundle from failing the age check with a
        # TypeError, which would read as a bug rather than as bad input.
        if built.tzinfo is None:
            built = built.replace(tzinfo=timezone.utc)
        return now - built

    @property
    def expired(self) -> bool:
        """Whether the bundle is past the owner's configured max age."""
        if self._max_age_days is None:
            return False
        return self.age > timedelta(days=self._max_age_days)

    def assert_serveable(self) -> None:
        """Raise unless this bundle may still answer queries."""
        if self.expired:
            raise BundleExpired(
                f"bundle is {self.age.days} days old, past the {self._max_age_days}-day "
                "limit set at deploy time; the owner must push a current bundle"
            )

    def setting(self, key: str, default: object = None) -> object:
        """Read an exported setting. Only `price_usd` is ever exported."""
        return self._meta.get(key, default)

    def search_publications(self, query: str, *, limit: int = 5) -> list[BundlePublication]:
        """Search the bundle. Mirrors `Store.search_publications` exactly.

        Refuses to answer from an expired bundle rather than returning content,
        so staleness cannot be served by a caller that forgot to check.
        """
        if limit < 0:
            raise ValueError("limit cannot be negative")
        self.assert_serveable()
        columns = ",".join(f"p.{column}" for column in _EXPORTED_COLUMNS)
        if query.strip():
            match = match_expression(query)
            if match is None:
                return []
            sql = (
                f"SELECT {columns} FROM publications_fts f "
                "JOIN publications p ON p.id=f.rowid "
                "WHERE publications_fts MATCH ? "
                "ORDER BY bm25(publications_fts),p.updated_at DESC LIMIT ?"
            )
            args: list[object] = [match, limit or -1]
        else:
            sql = (
                f"SELECT {columns} FROM publications p "
                "ORDER BY p.updated_at DESC LIMIT ?"
            )
            args = [limit or -1]
        return [
            BundlePublication(*[row[column] for column in _EXPORTED_COLUMNS])
            for row in self.db.execute(sql, args)
        ]
