"""Full-text search helpers shared by the local library and an exported bundle.

Stdlib only, deliberately. This module is imported by `lore.store` (the owner's
private library) and by `lore.bundle` (the read-only export a deployed node
serves), and the deployment artifact must stay dependency-free.

One implementation, not two, is also what makes local and deployed search
*identical* rather than merely similar. A deployed node that ranked differently
from `lore serve` would be a silent behavioral fork across a disclosure boundary,
which is exactly the failure `docs/node-deployment.md` FR18 exists to prevent.
"""

from __future__ import annotations

import re
import sqlite3

# Words and hyphenated words. Everything else is punctuation as far as the query
# is concerned, including the double quotes used to build the MATCH expression.
_TERM = re.compile(r"[\w-]+", re.UNICODE)


def match_expression(query: str) -> str | None:
    """Build an FTS5 MATCH expression, or None when the query has no terms.

    None means "no possible match" rather than "match everything" — callers
    return an empty result set instead of falling through to an unfiltered query.
    """
    terms = _TERM.findall(query)
    if not terms:
        return None
    # Each term is quoted so FTS5 reads it as a literal rather than as syntax.
    return " AND ".join(f'"{term.replace(chr(34), "")}"' for term in terms)


def fts5_available() -> bool:
    """Report whether this runtime's SQLite has the FTS5 module compiled in.

    Worth checking explicitly: the AWS Lambda python3.10 and python3.11 runtimes
    ship SQLite 3.7.17 without FTS5, and the resulting error on a bundle is
    `malformed database schema`, which names neither FTS5 nor the runtime. See
    docs/fts5-lambda-runtime-spike.md.
    """
    probe = sqlite3.connect(":memory:")
    try:
        probe.execute("CREATE VIRTUAL TABLE probe USING fts5(x)")
        return True
    except sqlite3.Error:
        return False
    finally:
        probe.close()
