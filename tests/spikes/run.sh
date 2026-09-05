#!/bin/sh
# Re-run the FTS5 runtime spike. Needs Docker; needs no AWS account.
#
# Answers: can this runtime host an exported publication bundle, i.e. create the
# FTS5 schema, rank with BM25, fold diacritics, and query read-only? Findings and
# their consequences live in docs/fts5-lambda-runtime-spike.md.
#
# Usage: tests/spikes/run.sh [runtime-tag...]     (default: 3.13 3.12 3.11 3.10)
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
TAGS="${*:-3.13 3.12 3.11 3.10}"
IMAGE="public.ecr.aws/lambda/python"
# Runtimes Lore claims to support. A failure here is a real regression; failures
# on anything else are the expected, documented outcome.
SUPPORTED="3.13 3.12"
STATUS=0

echo "== local baseline (the machine that builds bundles) =="
python3 "$HERE/fts5_probe.py" --brief || STATUS=1

for tag in $TAGS; do
  for platform in linux/arm64 linux/amd64; do
    echo "== lambda/python:$tag $platform =="
    if docker run --rm --platform "$platform" --entrypoint "python$tag" \
        -v "$HERE/fts5_probe.py:/tmp/fts5_probe.py:ro" \
        "$IMAGE:$tag" /tmp/fts5_probe.py --brief 2>/dev/null; then
      :
    else
      case " $SUPPORTED " in
        *" $tag "*)
          echo "    REGRESSION: $tag is a supported runtime and must pass"
          STATUS=1
          ;;
        *) echo "    (expected: $tag is below Lore's floor of Python 3.12)" ;;
      esac
    fi
  done
done

# The production shape: a bundle built by a modern SQLite, read by the runtime.
echo "== reading a locally-built bundle inside each runtime =="
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM
python3 - "$WORK/bundle.db" "$HERE" <<'PY'
import sqlite3
import sys

sys.path.insert(0, sys.argv[2])  # so this runs from any working directory
from fts5_probe import BUNDLE_DDL, ROWS

db = sqlite3.connect(sys.argv[1])
db.execute("PRAGMA journal_mode=DELETE")  # so the copy opens read-only
db.executescript(BUNDLE_DDL)
db.executemany(
    "INSERT INTO publications(id,title,content,kind,created_at,updated_at) "
    "VALUES (?,?,?,?,'2026-07-30T00:00:00Z','2026-07-30T00:00:00Z')",
    ROWS,
)
db.execute("INSERT INTO publications_fts(publications_fts) VALUES ('rebuild')")
db.commit()
db.close()
print(f"  built bundle with sqlite {sqlite3.sqlite_version}")
PY

for tag in $TAGS; do
  echo "-- lambda/python:$tag --"
  docker run --rm --platform linux/arm64 --entrypoint "python$tag" \
    -v "$HERE/read_probe.py:/tmp/read_probe.py:ro" \
    -v "$WORK/bundle.db:/tmp/bundle.db:ro" \
    "$IMAGE:$tag" /tmp/read_probe.py /tmp/bundle.db 2>&1 |
    grep -E '"(sqlite_version|ok|error)"' | sed 's/^/    /'
done

exit "$STATUS"
