"""Fail if anything committed under the seed trees could leak a secret or a real identity.

    uv run python support/seed/hygiene_check.py [PATH ...]

With no PATH, checks support/seed and tests/fixtures/live (docs/backlog is opt-in:
older files there already trip the rules). Prints `path:line:rule` for every scrub-rule match no allow entry excuses,
and exits 1 if there is any. It also fails on a file over 2 MB, a zip archive, a
manifest key named like a credential, a .json/.jsonl/.xml file that no longer parses
(a scrub rule that ate a brace or a number), and a manifest `real_library` block holding
anything but source names and counts: a key outside REAL_LIBRARY_KEYS or an id-shaped value.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from defusedxml.ElementTree import fromstring
from scrub import find, load_rules

SEED = Path(__file__).resolve().parent
ROOT = SEED.parent.parent
DEFAULT_PATHS = ("support/seed", "tests/fixtures/live")
MAX_BYTES = 2 * 1024 * 1024
SKIPPED_DIRS = {".git", "__pycache__", ".venv", "node_modules", ".mypy_cache"}
# Compiled with a character class so this file does not spell the words it forbids.
FORBIDDEN_KEY = re.compile(r"(?i)t[o]ken|s[e]cret|c[o]okie|p[a]ssword|j[w]t")
# A real_library block records what the owner's real library did, never what is in it.
REAL_LIBRARY_KEYS = frozenset(
    {
        "name",
        "state",
        "imported",
        "connected_at",
        "library_before",
        "library_after",
        "active_publications",
        "canaries",
        "note",
        "recorded",
        "preview",
        "feed_headers",
        "connect_label",
        "preview_label",
        "label",
        "publication_title_actual",
        "seeded_via",
        "deployed_at",
        "account",
        "obsidian_app_registration",
    }
)
AN_ID = re.compile(
    r"\b[0-9a-f]{32}\b|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b", re.I
)


def files(paths: list[Path]) -> list[Path]:
    found: list[Path] = []
    for path in paths:
        if path.is_file():
            found.append(path)
        elif path.is_dir():
            found += sorted(
                child
                for child in path.rglob("*")
                if child.is_file() and not SKIPPED_DIRS & set(child.parts)
            )
    return found


def keys(node: Any) -> list[str]:
    if isinstance(node, dict):
        return [str(key) for key in node] + [
            name for value in node.values() for name in keys(value)
        ]
    if isinstance(node, list):
        return [name for value in node for name in keys(value)]
    return []


def strings(node: Any) -> list[str]:
    if isinstance(node, dict):
        return [text for value in node.values() for text in strings(value)]
    if isinstance(node, list):
        return [text for value in node for text in strings(value)]
    return [node] if isinstance(node, str) else []


def unparseable(path: Path, text: str) -> int | None:
    """The line (0 for the whole file) where a recording stops parsing, or None."""
    if path.suffix == ".jsonl":
        for number, line in enumerate(text.splitlines(), start=1):
            try:
                if line.strip():
                    json.loads(line)
            except ValueError:
                return number
        return None
    try:
        if path.suffix == ".json":
            json.loads(text)
        elif path.suffix == ".xml":
            fromstring(text)
    # ParseError is a SyntaxError; defusedxml's refusals and JSON errors are ValueErrors.
    except (ValueError, SyntaxError):
        return 0
    return None


def real_library_problems(document: Any, name: str) -> list[str]:
    sources = document.get("sources") if isinstance(document, dict) else None
    problems: list[str] = []
    for source, entry in (sources or {}).items():
        block = entry.get("real_library") if isinstance(entry, dict) else None
        if not isinstance(block, dict):
            continue
        for key, value in block.items():
            if key not in REAL_LIBRARY_KEYS:
                problems.append(f"{name}:0:real-library-key:{source}.{key}")
            elif any(AN_ID.search(text) for text in strings(value)):
                problems.append(f"{name}:0:real-library-id:{source}.{key}")
    return problems


def check(paths: list[Path], root: Path = ROOT) -> list[str]:
    rules = load_rules()
    problems: list[str] = []

    def label(path: Path) -> str:
        try:
            return str(path.resolve().relative_to(root.resolve()))
        except ValueError:
            return str(path)

    for path in files(paths):
        name = label(path)
        if path.suffix == ".zip":
            problems.append(f"{name}:0:zip-archive")
        if path.stat().st_size > MAX_BYTES:
            problems.append(f"{name}:0:over-2mb")
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            problems.append(f"{name}:0:not-utf8")
            continue
        problems += [f"{name}:{v.line}:{v.rule}" for v in find(text, rules)]
        if path.name != "manifest.json":
            line = unparseable(path, text)
            if line is not None:
                problems.append(f"{name}:{line}:not-parseable")
        else:
            try:
                document = json.loads(text)
            except ValueError:
                problems.append(f"{name}:0:manifest-not-json")
                continue
            problems += [
                f"{name}:0:credential-key:{key}"
                for key in keys(document)
                if FORBIDDEN_KEY.search(key)
            ]
            problems += real_library_problems(document, name)
    return problems


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    targets = [Path(a) for a in args] or [
        ROOT / rel for rel in DEFAULT_PATHS if (ROOT / rel).exists()
    ]
    problems = check(targets)
    for problem in problems:
        print(problem)
    if problems:
        print(f"hygiene_check: {len(problems)} problem(s)", file=sys.stderr)
        return 1
    print("hygiene_check: clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
