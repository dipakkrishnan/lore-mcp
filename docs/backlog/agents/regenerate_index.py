#!/usr/bin/env python3
"""Validate every backlog item and regenerate docs/backlog/INDEX.md from scratch.

Implements audit.md steps 1-4 (enumerate, validate frontmatter, check id
sequencing/uniqueness, validate cross-references), step 5 (blocker-cycle
detection), and step 9 (regenerate INDEX.md's table). Steps 6-8 (stale
in-progress flags, ideation->in-review promotion, completion-drift) stay a
human/agent judgment call for a dedicated audit pass — this script answers
the narrower, purely mechanical question "is the derived table correct",
the same way detect_completion_drift.py answers a narrow question for step 8
rather than eyeballing ~100 files by hand.

Usage:
    python3 docs/backlog/agents/regenerate_index.py [--write] [docs/backlog]

Without --write, only prints validation findings and the row count that
would be written. With --write, rewrites INDEX.md's table in place. Exits
non-zero (and does not write) if any hard error is found — duplicate ids,
unresolvable cross-references, or a blocker cycle.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SKIP_DIRS = {"agents", "automation", "_template"}
STATUS_ORDER = [
    "ideation",
    "in-review",
    "ready",
    "in-progress",
    "completed",
    "obsolete",
]
PRIORITY_ORDER = ["P0", "P1", "P2", "P3"]
EFFORT_SET = {"XS", "S", "M", "L", "XL"}
ID_RE = re.compile(r"^([A-Z]+)-(\d{3})$")
BACKLOG_ID_RE = re.compile(r"\b[A-Z]+-\d{3}\b")

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)
FIELD_RE = re.compile(r"^(\w+):\s*(.*)$", re.M)
TABLE_HEADER = (
    "| ID | Title | Priority | Effort | Component | Status | Related | "
    "Blockers | Dependencies | Issue |\n|---|---|---|---|---|---|---|---|---|---|\n"
)


def strip_quotes(value: str) -> str:
    """Strip one layer of matching leading/trailing double quotes.

    Scalar frontmatter values (e.g. `github_issue: "https://.../174"`) can be
    YAML-quoted; list values (e.g. `dependencies: [A-001, "free text"]`)
    quote their *elements*, not the field itself, so they never start with
    `"` here and are left untouched.
    """
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return value[1:-1]
    return value


def parse_frontmatter(text: str) -> dict[str, str] | None:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return None
    return {
        m.group(1): strip_quotes(m.group(2).strip())
        for m in FIELD_RE.finditer(match.group(1))
    }


def parse_list_field(raw: str | None) -> list[str]:
    """Parse a YAML flow sequence like `[A-001, "free text, with commas"]`.

    Deliberately not a full YAML parser — just enough to split on top-level
    commas while respecting double-quoted strings, since `dependencies`
    values are free text that can itself contain commas (see e.g.
    `MON-008`'s dependencies). A naive `str.split(",")` silently mis-splits
    those.
    """
    if not raw:
        return []
    raw = raw.strip()
    if raw in ("[]", "null", "~"):
        return []
    if not (raw.startswith("[") and raw.endswith("]")):
        return [raw]
    inner = raw[1:-1]
    items: list[str] = []
    current = ""
    in_quotes = False
    for ch in inner:
        if ch == '"':
            in_quotes = not in_quotes
            continue
        if ch == "," and not in_quotes:
            items.append(current.strip())
            current = ""
            continue
        current += ch
    if current.strip():
        items.append(current.strip())
    return items


def component_prefix(folder: str, root: Path) -> str | None:
    readme = root / folder / "README.md"
    if not readme.exists():
        return None
    m = re.search(r"Prefix:\s*`([A-Z]+)`", readme.read_text())
    return m.group(1) if m else None


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    write = "--write" in argv
    positional = [a for a in argv if a != "--write"]
    root = Path(positional[0]) if positional else Path("docs/backlog")

    items: dict[str, dict] = {}
    errors: list[str] = []
    dupes: dict[str, list[str]] = {}

    for folder_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        folder = folder_dir.name
        if folder in SKIP_DIRS:
            continue
        prefix = component_prefix(folder, root)
        for path in sorted(folder_dir.glob("*.md")):
            if path.name == "README.md":
                continue
            rel = path.relative_to(root)
            fields = parse_frontmatter(path.read_text())
            if fields is None:
                errors.append(f"{rel}: no parseable frontmatter")
                continue

            item_id = fields.get("id", "")
            id_match = ID_RE.match(item_id)
            if not id_match:
                errors.append(f"{rel}: id '{item_id}' doesn't match <PREFIX>-NNN")
                continue
            if prefix and id_match.group(1) != prefix:
                errors.append(
                    f"{rel}: id prefix '{id_match.group(1)}' doesn't match "
                    f"folder '{folder}' (expected '{prefix}')"
                )
            if fields.get("component") != folder:
                errors.append(
                    f"{rel}: component '{fields.get('component')}' != folder '{folder}'"
                )

            priority = fields.get("priority", "")
            if priority not in PRIORITY_ORDER:
                errors.append(f"{rel}: priority '{priority}' not in {PRIORITY_ORDER}")

            effort = fields.get("effort", "")
            if effort not in EFFORT_SET:
                errors.append(f"{rel}: effort '{effort}' not in {sorted(EFFORT_SET)}")

            status = fields.get("status", "")
            if status not in STATUS_ORDER:
                errors.append(f"{rel}: status '{status}' not in {STATUS_ORDER}")

            if item_id in items:
                dupes.setdefault(item_id, [items[item_id]["rel"]]).append(str(rel))
            else:
                items[item_id] = {
                    "id": item_id,
                    "title": fields.get("title", ""),
                    "priority": priority,
                    "effort": effort,
                    "component": folder,
                    "status": status,
                    "related": parse_list_field(fields.get("related")),
                    "blockers": parse_list_field(fields.get("blockers")),
                    "dependencies": parse_list_field(fields.get("dependencies")),
                    "github_issue": fields.get("github_issue", ""),
                    "rel": str(rel),
                    "path": path,
                }

    for dup_id, locations in dupes.items():
        errors.append(f"duplicate id {dup_id}: {locations}")

    # Cross-reference validation (step 4)
    for item in items.values():
        for field_name in ("related", "blockers"):
            for ref in item[field_name]:
                if BACKLOG_ID_RE.fullmatch(ref) and ref not in items:
                    errors.append(
                        f"{item['rel']}: {field_name} references unknown id '{ref}'"
                    )
        for dep in item["dependencies"]:
            if BACKLOG_ID_RE.fullmatch(dep) and dep not in items:
                errors.append(
                    f"{item['rel']}: dependencies references unknown id '{dep}'"
                )

    # Blocker-cycle detection (step 5)
    def has_cycle_from(start: str) -> list[str] | None:
        stack = [(start, [start])]
        seen_edges = set()
        while stack:
            node, path = stack.pop()
            for blocker in items.get(node, {}).get("blockers", []):
                if not BACKLOG_ID_RE.fullmatch(blocker) or blocker not in items:
                    continue
                if blocker == start:
                    return path + [blocker]
                edge = (node, blocker)
                if edge in seen_edges:
                    continue
                seen_edges.add(edge)
                stack.append((blocker, path + [blocker]))
        return None

    cycle_errors = [
        " -> ".join(cycle) for item_id in items if (cycle := has_cycle_from(item_id))
    ]
    if cycle_errors:
        errors.append(f"blocker cycle(s) detected: {cycle_errors}")

    if errors:
        print(f"{len(errors)} validation error(s):")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"Validated {len(items)} items, 0 errors.")

    # Tie-break within a (status, priority) bucket by the existing INDEX.md's
    # row order rather than id, so regenerating doesn't reorder items whose
    # bucket didn't change. Step 9 mandates overwriting the whole table
    # rather than diff/patching it, but that's about not hand-patching rows,
    # not license to shuffle ones that didn't move. New ids absent from the
    # current table sort after all known ones, by id, within their bucket.
    index_path = root / "INDEX.md"
    existing_order: dict[str, int] = {}
    if index_path.exists():
        for line in index_path.read_text().splitlines():
            m = re.match(r"^\|\s*\[([A-Z]+-\d{3})\]", line)
            if m:
                existing_order.setdefault(m.group(1), len(existing_order))

    def sort_key(item: dict) -> tuple:
        return (
            STATUS_ORDER.index(item["status"]),
            PRIORITY_ORDER.index(item["priority"]),
            existing_order.get(item["id"], len(existing_order)),
            item["id"],
        )

    rows = sorted(items.values(), key=sort_key)

    def fmt_list(values: list[str]) -> str:
        if not values:
            return "—"
        # Bare backlog ids render unquoted; free-text dependency strings are
        # quoted, matching the existing table's convention for telling the
        # two apart at a glance.
        return ", ".join(v if BACKLOG_ID_RE.fullmatch(v) else f'"{v}"' for v in values)

    def fmt_issue(url: str) -> str:
        if not url or url == "null":
            return "—"
        if url.isdigit():
            url = f"https://github.com/dipakkrishnan/lore-mcp/issues/{url}"
        m = re.search(r"/issues/(\d+)$", url)
        return f"[#{m.group(1)}]({url})" if m else url

    lines = []
    for item in rows:
        link = f"./{item['component']}/{item['path'].name}"
        lines.append(
            "| "
            + " | ".join(
                [
                    f"[{item['id']}]({link})",
                    item["title"],
                    item["priority"],
                    item["effort"],
                    item["component"],
                    item["status"],
                    fmt_list(item["related"]),
                    fmt_list(item["blockers"]),
                    fmt_list(item["dependencies"]),
                    fmt_issue(item["github_issue"]),
                ]
            )
            + " |"
        )

    print(f"{len(lines)} rows generated.")

    if write:
        text = index_path.read_text()
        header_end = text.index(TABLE_HEADER) + len(TABLE_HEADER)
        index_path.write_text(text[:header_end] + "\n".join(lines) + "\n")
        print(f"Wrote {index_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
