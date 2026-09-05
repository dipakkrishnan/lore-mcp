"""Probe whether a runtime can host Lore's publication bundle.

Stdlib only, by design: the bundle and the Lambda handler are meant to run with
no third-party dependency, so this probe must too. Emits one JSON object.

The checks mirror `Store.search_publications` and the bundle format proposed in
DEP-001 rather than asking `PRAGMA compile_options` alone. A runtime can report
ENABLE_FTS5 and still fail on the tokenizer options Lore actually passes, or on
opening the bundle read-only, so each of those is exercised for real.
"""

from __future__ import annotations

import json
import platform
import re
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

# Exactly the DDL a bundle would carry: the publication subset (no provenance,
# no source_changed_at, no memories) plus its external-content FTS index.
BUNDLE_DDL = """
CREATE TABLE publications (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE publications_fts USING fts5(
    title, content,
    content='publications', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);
"""

ROWS = [
    # High term frequency in a short document: should win on BM25.
    (1, "Consensus tradeoffs", "consensus consensus consensus raft paxos", "claim"),
    # One mention buried in a long document: should lose.
    (
        2,
        "Networking notes",
        (
            "a long note about many unrelated topics including routing, switching, "
            "congestion control, queueing, and somewhere in here consensus appears "
            "exactly once among a great many other words"
        ),
        "claim",
    ),
    # Diacritics, to prove `remove_diacritics 2` is honored rather than ignored.
    (3, "Café preferences", "I prefer a café latté when reviewing", "content"),
]


def match_expression(query: str) -> str:
    """Build the MATCH string the way `Store.search_publications` does."""
    terms = re.findall(r"[\w-]+", query, re.UNICODE)
    return " AND ".join(f'"{term.replace(chr(34), "")}"' for term in terms)


def build(path: Path, *, wal: bool) -> None:
    """Create a bundle-shaped database at `path`."""
    db = sqlite3.connect(path)
    db.execute(f"PRAGMA journal_mode={'WAL' if wal else 'DELETE'}")
    db.executescript(BUNDLE_DDL)
    db.executemany(
        "INSERT INTO publications(id,title,content,kind,created_at,updated_at) "
        "VALUES (?,?,?,?,'2026-07-30T00:00:00Z','2026-07-30T00:00:00Z')",
        ROWS,
    )
    # External-content FTS is populated by a rebuild, which is what an export
    # would do once at build time instead of carrying triggers.
    db.execute("INSERT INTO publications_fts(publications_fts) VALUES ('rebuild')")
    db.commit()
    db.close()


def search(db: sqlite3.Connection, query: str, limit: int = 5) -> list[int]:
    """Run the bundle's search and return matching ids, best match first."""
    rows = db.execute(
        "SELECT p.id FROM publications_fts f JOIN publications p ON p.id=f.rowid "
        "WHERE publications_fts MATCH ? "
        "ORDER BY bm25(publications_fts),p.updated_at DESC LIMIT ?",
        (match_expression(query), limit),
    ).fetchall()
    return [row[0] for row in rows]


def main() -> int:
    report: dict[str, object] = {
        "python": sys.version.split()[0],
        "platform": f"{platform.system()} {platform.machine()}",
        "sqlite_version": sqlite3.sqlite_version,
        "checks": {},
        "failures": [],
    }
    checks: dict[str, object] = report["checks"]  # type: ignore[assignment]
    failures: list[str] = report["failures"]  # type: ignore[assignment]

    def record(
        name: str, ok: bool, detail: object = None, *, gating: bool = True
    ) -> None:
        checks[name] = {"ok": ok, "detail": detail}
        if not ok and gating:
            failures.append(name)

    # 1. What the build reports about itself.
    try:
        options = [
            row[0]
            for row in sqlite3.connect(":memory:").execute("PRAGMA compile_options")
        ]
        record(
            "compile_options_report_fts5",
            any("ENABLE_FTS5" in option for option in options),
            [o for o in options if "FTS" in o or "JSON" in o],
        )
    except sqlite3.Error as error:
        record("compile_options_report_fts5", False, repr(error))

    def emit() -> int:
        """Print the report in the requested shape and return an exit code."""
        report["verdict"] = "USABLE" if not failures else "PROBLEM"
        if "--brief" in sys.argv:
            print(
                "  python={python:<8} sqlite={sqlite_version:<8} {platform:<16}"
                " -> {verdict}".format(**report)
            )
            for name in failures:
                print(f"    failed: {name} :: {checks[name]['detail']}")
        else:
            print(json.dumps(report, indent=2))
        return 0 if not failures else 1

    tmp = Path(tempfile.mkdtemp())
    try:
        # 2. Can the exact bundle schema be created, tokenizer options included?
        #    Without FTS5 this is where a runtime fails, so the remaining checks
        #    have nothing left to measure.
        bundle = tmp / "bundle.db"
        try:
            build(bundle, wal=False)
            record("create_bundle_schema", True)
        except sqlite3.Error as error:
            record("create_bundle_schema", False, repr(error))
            return emit()

        db = sqlite3.connect(bundle)

        # 3. Does the real search query run, and does BM25 actually rank?
        try:
            ids = search(db, "consensus")
            record(
                "bm25_ranking",
                ids == [1, 2],
                {"expected": [1, 2], "got": ids},
            )
        except sqlite3.Error as error:
            record("bm25_ranking", False, repr(error))

        # 4. Is `remove_diacritics 2` honored? Without it, "cafe" misses "café".
        try:
            ids = search(db, "cafe")
            record("remove_diacritics_2", ids == [3], {"got": ids})
        except sqlite3.Error as error:
            record("remove_diacritics_2", False, repr(error))

        # 5. Multi-term AND, the shape most real queries take.
        try:
            ids = search(db, "consensus raft")
            record("multi_term_and", ids == [1], {"got": ids})
        except sqlite3.Error as error:
            record("multi_term_and", False, repr(error))

        db.close()

        # 6. The handler opens the bundle read-only. FTS5 external-content
        #    queries must not need write access to the index.
        try:
            readonly = sqlite3.connect(f"file:{bundle}?mode=ro", uri=True)
            ids = search(readonly, "consensus")
            readonly.close()
            record("query_readonly", ids == [1, 2], {"got": ids})
        except sqlite3.Error as error:
            record("query_readonly", False, repr(error))

        # 7. Informational, not gating: does a WAL-mode bundle survive being
        #    copied without its -wal sidecar, as an S3 upload would copy it?
        #    SQLite checkpoints on last-connection-close, so this is expected to
        #    survive — but the exporter should still not rely on that, and the
        #    answer decides whether it must force a non-WAL journal mode.
        try:
            wal_source = tmp / "wal.db"
            build(wal_source, wal=True)
            sidecars = sorted(p.name for p in tmp.glob("wal.db-*"))
            copied = tmp / "wal-copy.db"
            shutil.copyfile(wal_source, copied)  # main file only, as an upload would
            probe = sqlite3.connect(f"file:{copied}?mode=ro", uri=True)
            count = probe.execute("SELECT count(*) FROM publications").fetchone()[0]
            hits = search(probe, "consensus")
            probe.close()
            record(
                "wal_copy_survives",
                count == len(ROWS) and hits == [1, 2],
                {"rows": count, "search": hits, "sidecars_left": sidecars},
                gating=False,
            )
        except sqlite3.Error as error:
            record("wal_copy_survives", False, repr(error), gating=False)

        # 8. The remedy for check 7: an exporter that resets the journal mode
        #    before closing produces a file that opens read-only after a copy.
        #    Gating, because the handler has no other way to read the bundle.
        try:
            fixed_source = tmp / "fixed.db"
            build(fixed_source, wal=True)
            closer = sqlite3.connect(fixed_source)
            closer.execute("PRAGMA journal_mode=DELETE")
            closer.close()
            fixed_copy = tmp / "fixed-copy.db"
            shutil.copyfile(fixed_source, fixed_copy)
            probe = sqlite3.connect(f"file:{fixed_copy}?mode=ro", uri=True)
            hits = search(probe, "consensus")
            probe.close()
            record("non_wal_copy_opens_readonly", hits == [1, 2], {"got": hits})
        except sqlite3.Error as error:
            record("non_wal_copy_opens_readonly", False, repr(error))

        report["bundle_bytes"] = bundle.stat().st_size
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    return emit()


if __name__ == "__main__":
    raise SystemExit(main())
