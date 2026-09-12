#!/usr/bin/env python3
"""Convert a filled manual-test walkthrough into JSON.

Reads a run recorded against docs/manual-test-walkthrough.md and emits one
JSON document: session metadata, every testable item with its result, the
per-scenario catchall verdicts, and counts. Validation is the point as much
as conversion — a record that silently drops a row, scores an item above the
declared tier, or invents a result value is worse than no record at all, so
those are hard errors and no JSON is written.

The walkthrough document itself is the canonical list of testable items. A
run is diffed against it in both directions, so the two cannot drift.

Usage:
    python3 support/manual_test_report.py RUN.md [--output PATH] [--check]

Schema version 1. Bump SCHEMA_VERSION when a key is removed or changes
meaning; adding a key does not require a bump.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

SCHEMA_VERSION = 1

RESULTS: tuple[str, ...] = ("Pass", "Partial", "Fail", "Skipped", "Other")
BLANK_RESULTS = frozenset({"", "-", "—", "TBD"})
COUNT_KEYS: tuple[str, ...] = RESULTS + ("NotRun", "total")

# Ordered: an item may only be scored if its tier is at or below the tier the
# tester declared. "none" means they did not run the tiered scenario at all.
TIERS: tuple[str, ...] = ("none", "walkthrough", "switch", "purchase")

SCENARIOS: tuple[str, ...] = ("S1", "S2", "S3", "S4")
ITEM_COLUMNS: tuple[str, ...] = (
    "TI ID",
    "TI Name",
    "Result",
    "Notes",
    "Reference URLs",
)
SESSION_COLUMNS: tuple[str, ...] = ("Field", "Value")
SESSION_FIELDS: tuple[str, ...] = (
    "tester",
    "date",
    "app_version",
    "git_commit",
    "platform",
    "scenarios_run",
    "s4_tier",
)

TI_ID_RE = re.compile(r"^S([1-4])(?:-(\d{2}))?$")
OPEN_RE = re.compile(r"^<!--\s*rubric:(?P<name>[\w.:-]+)(?P<attrs>[^>]*?)-->$")
CLOSE_RE = re.compile(r"^<!--\s*/rubric\s*-->$")
ATTR_RE = re.compile(r'(\w+)=(?:"([^"]*)"|(\S+))')
CELL_SPLIT = re.compile(r"(?<!\\)\|")
FENCE_RE = re.compile(r"^(?P<fence>`{3,}|~{3,})")
SEPARATOR_RE = re.compile(r"^\|[\s:|-]+\|$")
MD_LINK_RE = re.compile(r"^\[[^\]]*\]\((?P<url>[^)]+)\)$")

DEFAULT_TEMPLATE = (
    Path(__file__).resolve().parents[1] / "docs" / "manual-test-walkthrough.md"
)


@dataclass(frozen=True)
class Block:
    """One sentinel-delimited region of the document."""

    name: str
    attrs: dict[str, str]
    line: int
    lines: list[tuple[int, str]] = field(default_factory=list)


@dataclass(frozen=True)
class Item:
    """One scored row of a rubric table."""

    ti_id: str
    name: str
    result: str | None
    notes: str
    references: list[str]
    tier: str | None
    line: int

    @property
    def is_catchall(self) -> bool:
        return "-" not in self.ti_id


def blocks(text: str) -> tuple[list[Block], list[str]]:
    """Scan for sentinel-delimited blocks, ignoring anything inside a fence.

    Fenced content is dropped wholesale so the document can show a worked
    example rubric — sentinels and all — without the parser consuming it.
    """
    found: list[Block] = []
    errors: list[str] = []
    fence: str | None = None
    open_block: Block | None = None

    for number, raw in enumerate(text.splitlines(), start=1):
        stripped = raw.strip()

        if fence is not None:
            if stripped.startswith(fence[0]) and len(stripped.rstrip()) >= len(fence):
                candidate = stripped.rstrip()
                if set(candidate) == {fence[0]}:
                    fence = None
            continue

        match = FENCE_RE.match(stripped)
        if match:
            fence = match.group("fence")
            continue

        if CLOSE_RE.match(stripped):
            if open_block is None:
                errors.append(f"{number}: <!-- /rubric --> with no open block")
            else:
                found.append(open_block)
                open_block = None
            continue

        opener = OPEN_RE.match(stripped)
        if opener:
            if open_block is not None:
                errors.append(
                    f"{number}: rubric block opened inside the one at "
                    f"line {open_block.line}; nesting is not allowed"
                )
                continue
            open_block = Block(
                name=opener.group("name"),
                attrs=parse_attrs(opener.group("attrs")),
                line=number,
            )
            continue

        if open_block is not None:
            open_block.lines.append((number, raw))

    if open_block is not None:
        errors.append(
            f"{open_block.line}: rubric block was never closed with <!-- /rubric -->"
        )

    return found, errors


def parse_attrs(text: str) -> dict[str, str]:
    """Pull `key=value` and `key="quoted value"` pairs off a sentinel."""
    attrs: dict[str, str] = {}
    for key, quoted, bare in ATTR_RE.findall(text):
        attrs[key] = quoted if quoted else bare
    return attrs


def split_row(line: str) -> list[str]:
    """Split a markdown table row on unescaped pipes and unescape each cell."""
    parts = CELL_SPLIT.split(line.strip())
    if parts and not parts[0].strip():
        parts = parts[1:]
    if parts and not parts[-1].strip():
        parts = parts[:-1]
    return [part.strip().replace("\\|", "|") for part in parts]


def parse_table(
    block: Block, columns: Sequence[str], errors: list[str]
) -> list[tuple[int, dict[str, str]]]:
    """Validate the header, then return one (line, row) pair per body row."""
    rows = [(number, raw) for number, raw in block.lines if raw.strip()]
    if not rows:
        errors.append(f"{block.line}: rubric:{block.name} has no table")
        return []

    header_line, header_raw = rows[0]
    header = split_row(header_raw)
    if tuple(header) != tuple(columns):
        errors.append(
            f"{header_line}: expected the header row "
            f"| {' | '.join(columns)} |, found | {' | '.join(header)} |"
        )
        return []

    if len(rows) < 2 or not SEPARATOR_RE.match(rows[1][1].strip()):
        errors.append(f"{header_line + 1}: expected a |---| separator row")
        return []

    parsed: list[tuple[int, dict[str, str]]] = []
    for number, raw in rows[2:]:
        cells = split_row(raw)
        if len(cells) != len(columns):
            errors.append(
                f"{number}: expected {len(columns)} cells, found {len(cells)}"
                " (write a literal pipe as \\|)"
            )
            continue
        parsed.append((number, dict(zip(columns, cells, strict=True))))
    return parsed


def parse_result(cell: str, line: int, errors: list[str]) -> str | None:
    """Canonicalize a result cell; blank forms mean the item was not run."""
    if cell in BLANK_RESULTS:
        return None
    for value in RESULTS:
        if cell.lower() == value.lower():
            return value
    errors.append(
        f"{line}: {cell!r} is not a result; use one of {' | '.join(RESULTS)}, "
        "or leave it blank"
    )
    return None


def parse_references(cell: str, line: int, warnings: list[str]) -> list[str]:
    """Split a reference cell into URLs, unwrapping markdown links."""
    references: list[str] = []
    for token in re.split(r"[\s,]+", cell):
        if not token:
            continue
        link = MD_LINK_RE.match(token)
        url = link.group("url") if link else token
        if "://" not in url and not url.startswith("/"):
            warnings.append(f"{line}: {url!r} does not look like a URL")
        references.append(url)
    return references


def parse_items(block: Block, errors: list[str], warnings: list[str]) -> list[Item]:
    """Read one scenario rubric table into items."""
    tier = block.attrs.get("tier")
    if tier is not None and tier not in TIERS:
        errors.append(f"{block.line}: tier {tier!r} is not one of {' | '.join(TIERS)}")
        tier = None

    items: list[Item] = []
    for line, row in parse_table(block, ITEM_COLUMNS, errors):
        ti_id = row["TI ID"]
        match = TI_ID_RE.match(ti_id)
        if not match:
            errors.append(
                f"{line}: {ti_id!r} is not a testable item id "
                "(S1, or S1-01 with two digits)"
            )
            continue
        if "S" + match.group(1) != block.name:
            errors.append(f"{line}: {ti_id} appears in the rubric:{block.name} block")
            continue
        items.append(
            Item(
                ti_id=ti_id,
                name=row["TI Name"],
                result=parse_result(row["Result"], line, errors),
                notes=row["Notes"],
                references=parse_references(row["Reference URLs"], line, warnings),
                tier=tier,
                line=line,
            )
        )
    return items


def parse_session(
    block: Block, errors: list[str], warnings: list[str]
) -> dict[str, Any]:
    """Read the Field | Value session table."""
    session: dict[str, Any] = {name: "" for name in SESSION_FIELDS}
    session["scenarios_run"] = []
    session["s4_tier"] = "none"
    session["extra"] = {}

    for line, row in parse_table(block, SESSION_COLUMNS, errors):
        key = row["Field"].strip().lower().replace(" ", "_")
        value = row["Value"].strip()
        if key not in SESSION_FIELDS:
            warnings.append(f"{line}: unknown session field {row['Field']!r}")
            session["extra"][key] = value
            continue
        if key == "scenarios_run":
            session[key] = parse_scenarios(value, line, errors)
        elif key == "s4_tier":
            session[key] = parse_tier(value, line, errors)
        elif key == "date":
            session[key] = parse_date(value, line, errors)
        else:
            session[key] = value

    session["_line"] = block.line
    return session


def parse_scenarios(value: str, line: int, errors: list[str]) -> list[str]:
    scenarios: list[str] = []
    for token in re.split(r"[\s,]+", value):
        if not token:
            continue
        name = token.upper()
        if name not in SCENARIOS:
            errors.append(f"{line}: {token!r} is not a scenario id")
            continue
        scenarios.append(name)
    return scenarios


def parse_tier(value: str, line: int, errors: list[str]) -> str:
    if not value:
        return "none"
    if value.lower() not in TIERS:
        errors.append(f"{line}: tier {value!r} is not one of {' | '.join(TIERS)}")
        return "none"
    return value.lower()


def parse_date(value: str, line: int, errors: list[str]) -> str:
    if not value:
        return ""
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        errors.append(f"{line}: {value!r} is not an ISO date (YYYY-MM-DD)")
        return ""
    return value


def observations(block: Block) -> str:
    """Capture an observations block verbatim, minus surrounding blank lines."""
    lines = [raw.rstrip() for _, raw in block.lines]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


def counts(items: Iterable[Item]) -> dict[str, int]:
    """Tally results. Catchall rows are summary, not data, so they are excluded."""
    tally = {key: 0 for key in COUNT_KEYS}
    for item in items:
        if item.is_catchall:
            continue
        tally[item.result or "NotRun"] += 1
        tally["total"] += 1
    return tally


def check_notes(items: Iterable[Item], warnings: list[str]) -> None:
    for item in items:
        if item.result in ("Fail", "Partial", "Other") and not item.notes:
            warnings.append(
                f"{item.line}: {item.ti_id} is {item.result} with empty Notes"
            )


def check_tiers(
    items: Sequence[Item],
    declared: str,
    run: bool,
    errors: list[str],
    warnings: list[str],
) -> None:
    """Refuse a record that scores work the tester said they did not do.

    Scoring above the declared tier is always an error. Leaving an above-tier
    row blank rather than Skipped is only worth mentioning once the tester has
    said they ran the scenario at all — otherwise every blank template would
    report it for every tiered row.
    """
    ceiling = TIERS.index(declared)
    for item in items:
        if item.tier is None:
            continue
        if TIERS.index(item.tier) <= ceiling:
            if item.result == "Skipped" and not item.notes:
                warnings.append(
                    f"{item.line}: {item.ti_id} is within the declared tier but "
                    "Skipped with no reason"
                )
            continue
        if item.result in ("Pass", "Partial", "Fail"):
            errors.append(
                f"{item.line}: {item.ti_id} is {item.result}, but its tier "
                f"({item.tier}) is above the declared tier ({declared}); "
                "raise S4 tier, or mark this row Skipped"
            )
        elif item.result is None and run:
            warnings.append(
                f"{item.line}: {item.ti_id} is above the declared tier and "
                "left blank; mark it Skipped"
            )


def template_ids(path: Path) -> tuple[set[str], list[str]]:
    """Read the canonical set of testable item ids out of the walkthrough."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        return set(), [f"could not read the template: {error}"]
    found, errors = blocks(text)
    if errors:
        return set(), [f"the template does not parse: {errors[0]}"]
    ids: set[str] = set()
    for block in found:
        if block.name in SCENARIOS:
            for item in parse_items(block, [], []):
                ids.add(item.ti_id)
    return ids, []


def compare_to_template(run: set[str], template: set[str]) -> list[str]:
    errors = []
    for extra in sorted(run - template):
        errors.append(f"{extra} is not in the walkthrough document")
    for missing in sorted(template - run):
        errors.append(f"{missing} is in the walkthrough document but not in this run")
    return errors


def convert(
    text: str,
    *,
    source: str,
    generated_at: str | None = None,
    canonical: set[str] | None = None,
) -> tuple[dict[str, Any] | None, list[str], list[str]]:
    """Parse and validate a run. Returns (document or None, errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []

    found, scan_errors = blocks(text)
    errors.extend(scan_errors)
    if not found:
        errors.append("no rubric blocks found")
        return None, [f"{source}:{message}" for message in errors], warnings

    session: dict[str, Any] | None = None
    overall = ""
    per_scenario: dict[str, list[Item]] = {name: [] for name in SCENARIOS}
    names: dict[str, str] = {}
    notes: dict[str, str] = {}

    for block in found:
        if block.name == "session":
            if session is not None:
                errors.append(f"{block.line}: a second session table")
                continue
            session = parse_session(block, errors, warnings)
        elif block.name == "observations":
            overall = observations(block)
        elif block.name.startswith("observations:"):
            scenario = block.name.split(":", 1)[1]
            if scenario not in SCENARIOS:
                errors.append(f"{block.line}: {block.name!r} names no scenario")
                continue
            notes[scenario] = observations(block)
        elif block.name in SCENARIOS:
            per_scenario[block.name].extend(parse_items(block, errors, warnings))
            if "name" in block.attrs:
                names.setdefault(block.name, block.attrs["name"])
        else:
            errors.append(f"{block.line}: unknown rubric block {block.name!r}")

    if session is None:
        errors.append("the document has no <!-- rubric:session --> table")

    seen: dict[str, int] = {}
    for items in per_scenario.values():
        for item in items:
            if item.ti_id in seen:
                errors.append(
                    f"{item.line}: {item.ti_id} is already recorded at "
                    f"line {seen[item.ti_id]}"
                )
            else:
                seen[item.ti_id] = item.line

    tier = str(session["s4_tier"]) if session else "none"
    scenarios: list[dict[str, Any]] = []
    for name in SCENARIOS:
        items = per_scenario[name]
        if not items:
            continue
        catchall = next((item for item in items if item.is_catchall), None)
        if catchall is None:
            errors.append(f"{name} has no catchall row (a bare {name} id)")
        steps = [item for item in items if not item.is_catchall]
        declared = bool(session and name in session["scenarios_run"])
        check_notes(items, warnings)
        if name == "S4":
            check_tiers(steps, tier, declared, errors, warnings)

        blank = sum(1 for item in steps if item.result is None)
        if declared and blank == len(steps) and steps:
            warnings.append(f"{name} is declared run but nothing is recorded")
        elif declared and blank:
            warnings.append(f"{name}: {blank} of {len(steps)} items not run")
        elif not declared and blank < len(steps):
            warnings.append(f"{name} has recorded results but is not in Scenarios run")

        scenarios.append(
            {
                "id": name,
                "name": names.get(name, ""),
                "run": declared,
                "observations": notes.get(name, ""),
                "catchall": as_record(catchall) if catchall else None,
                "items": [as_record(item) for item in steps],
                "counts": counts(items),
            }
        )

    if canonical is not None:
        errors.extend(compare_to_template(set(seen), canonical))

    # The blank walkthrough is a valid document — it is the template, and
    # round-tripping it is what keeps the parser and the doc from drifting.
    # Session metadata is only required once something has actually been run.
    recorded = any(
        item.result is not None for items in per_scenario.values() for item in items
    )
    if session is not None:
        line = session.pop("_line")
        for required in ("tester", "date"):
            if session[required]:
                continue
            message = f"{line}: the session table needs a {required}"
            (errors if recorded else warnings).append(message)

    if errors:
        return None, [prefix(source, message) for message in errors], warnings

    assert session is not None
    session["observations"] = overall
    totals = {key: sum(s["counts"][key] for s in scenarios) for key in COUNT_KEYS}
    document = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at or now(),
        "source": source,
        "session": session,
        "scenarios": scenarios,
        "totals": totals,
        "warnings": [prefix(source, message) for message in warnings],
    }
    return document, [], [prefix(source, message) for message in warnings]


def as_record(item: Item) -> dict[str, Any]:
    return {
        "ti_id": item.ti_id,
        "name": item.name,
        "result": item.result,
        "notes": item.notes,
        "references": item.references,
        "tier": item.tier,
        "line": item.line,
    }


def prefix(source: str, message: str) -> str:
    """Prepend the source path, and a colon only when the message opens a line."""
    return f"{source}:{message}" if message[:1].isdigit() else f"{source}: {message}"


def now() -> str:
    stamp = datetime.datetime.now(datetime.timezone.utc)
    return stamp.strftime("%Y-%m-%dT%H:%M:%SZ")


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("run", help="the filled walkthrough to convert, or - for stdin")
    ap.add_argument("--output", help="write JSON here instead of stdout")
    ap.add_argument("--check", action="store_true", help="validate only; write no JSON")
    ap.add_argument(
        "--template",
        default=str(DEFAULT_TEMPLATE),
        help="the walkthrough that defines the canonical testable items",
    )
    ap.add_argument(
        "--no-template-check",
        action="store_true",
        help="skip the canonical-item diff (needed to convert the template)",
    )
    ap.add_argument(
        "--warnings-as-errors", action="store_true", help="exit non-zero on warnings"
    )
    ap.add_argument("--indent", type=int, default=2, help="JSON indent (default 2)")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)

    if args.run == "-":
        text = sys.stdin.read()
        source = "<stdin>"
    else:
        try:
            text = Path(args.run).read_text(encoding="utf-8")
        except OSError as problem:
            print(f"cannot read {args.run}: {problem}", file=sys.stderr)
            return 2
        source = args.run

    canonical: set[str] | None = None
    if not args.no_template_check:
        canonical, failures = template_ids(Path(args.template))
        if failures:
            for failure in failures:
                print(failure, file=sys.stderr)
            return 2

    document, errors, warnings = convert(text, source=source, canonical=canonical)

    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1
    if warnings and args.warnings_as_errors:
        return 1

    assert document is not None
    if args.check:
        print(
            f"{source}: {document['totals']['total']} items, {len(warnings)} warnings",
            file=sys.stderr,
        )
        return 0

    payload = json.dumps(document, indent=args.indent, allow_nan=False) + "\n"
    if args.output:
        Path(args.output).write_text(payload, encoding="utf-8")
        print(f"wrote {args.output}", file=sys.stderr)
    else:
        sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
