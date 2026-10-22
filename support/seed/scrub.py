"""Scrub a recording so it can be committed.

    uv run python support/seed/scrub.py IN OUT

Applies the ordered rules in scrub-rules.json to IN, writes OUT, and writes
OUT.scrub.json beside it with each rule's hit count (never the matched text).
`find` is what hygiene_check.py uses: the same rules, reporting instead of rewriting.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

SEED = Path(__file__).resolve().parent
RULES = SEED / "scrub-rules.json"


@dataclass(frozen=True)
class Rule:
    name: str
    pattern: re.Pattern[str]
    replacement: str
    allow: tuple[re.Pattern[str], ...]

    def allowed(self, matched: str) -> bool:
        return any(found.search(matched) for found in self.allow)


class Violation(NamedTuple):
    line: int
    rule: str


def load_rules(path: Path = RULES) -> list[Rule]:
    document = json.loads(path.read_text(encoding="utf-8"))
    return [
        Rule(
            entry["name"],
            re.compile(entry["pattern"]),
            entry["replacement"],
            tuple(re.compile(allowed) for allowed in entry.get("allow", [])),
        )
        for entry in document["rules"]
    ]


def scrub(text: str, rules: list[Rule]) -> tuple[str, dict[str, int]]:
    """Rewrite every match no allow entry excuses; report how often each rule fired."""
    hits: dict[str, int] = {}
    for rule in rules:

        def replace(found: re.Match[str], rule: Rule = rule) -> str:
            if rule.allowed(found.group(0)):
                return found.group(0)
            hits[rule.name] = hits.get(rule.name, 0) + 1
            return found.expand(rule.replacement)

        text = rule.pattern.sub(replace, text)
    return text, hits


def find(text: str, rules: list[Rule]) -> list[Violation]:
    """Every match, on the text as written, that no allow entry excuses."""
    violations: list[Violation] = []
    for rule in rules:
        for found in rule.pattern.finditer(text):
            if not rule.allowed(found.group(0)):
                violations.append(
                    Violation(text.count("\n", 0, found.start()) + 1, rule.name)
                )
    return sorted(violations)


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2:
        print("usage: scrub.py IN OUT", file=sys.stderr)
        return 2
    source, target = Path(args[0]), Path(args[1])
    cleaned, hits = scrub(source.read_text(encoding="utf-8"), load_rules())
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(cleaned, encoding="utf-8")
    report = target.with_name(target.name + ".scrub.json")
    report.write_text(
        json.dumps(hits, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"scrubbed {source.name}: {sum(hits.values())} replacements", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
