"""Read a pre-built bundle the way the Lambda handler would.

The bundle is always built on the owner's machine, which has FTS5. This probe
answers the separate question: what does a runtime *without* FTS5 do when handed
that file — raise, or quietly return nothing? A silent empty result on the
disclosure path would be far worse than an error.

Usage: read_probe.py /path/to/bundle.db
"""

from __future__ import annotations

import json
import sqlite3
import sys


def main(path: str) -> int:
    report: dict[str, object] = {
        "python": sys.version.split()[0],
        "sqlite_version": sqlite3.sqlite_version,
    }

    def attempt(name: str, fn) -> None:
        try:
            report[name] = {"ok": True, "result": fn()}
        except Exception as error:  # noqa: BLE001 - a probe reports whatever a runtime raises
            report[name] = {"ok": False, "error": f"{type(error).__name__}: {error}"}

    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)

    # Can it open the file and read the plain table at all?
    attempt("open_and_count_publications", lambda: db.execute("SELECT count(*) FROM publications").fetchone()[0])
    attempt("list_tables", lambda: [r[0] for r in db.execute("SELECT name FROM sqlite_master ORDER BY name")])

    # The question that matters: querying the FTS index.
    def fts_query() -> list[int]:
        rows = db.execute(
            "SELECT p.id FROM publications_fts f JOIN publications p ON p.id=f.rowid "
            "WHERE publications_fts MATCH ? ORDER BY bm25(publications_fts) LIMIT 5",
            ('"consensus"',),
        ).fetchall()
        return [r[0] for r in rows]

    attempt("fts_match_query", fts_query)

    # And the fallback a degraded runtime might silently use instead.
    attempt(
        "like_fallback",
        lambda: [
            r[0]
            for r in db.execute(
                "SELECT id FROM publications WHERE content LIKE '%consensus%' ORDER BY id"
            )
        ],
    )

    db.close()
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
