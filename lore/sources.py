from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from .paths import claude_home, codex_home, home
from .store import Store


@dataclass(frozen=True)
class Source:
    name: str
    label: str
    root: Path
    pattern: str
    origin: str = "native"

    def files(self) -> list[Path]:
        if not self.root.exists():
            return []
        return sorted(path for path in self.root.glob(self.pattern) if path.is_file())


def available_sources() -> list[Source]:
    return [
        Source("codex", "Codex", codex_home() / "memories", "MEMORY.md"),
        Source(
            "claude",
            "Claude Code",
            claude_home() / "projects",
            "*/memory/*.md",
        ),
        Source("automation-codex", "Codex synthesis", home() / "memories/codex", "*.md", "automation"),
        Source("automation-claude", "Claude synthesis", home() / "memories/claude", "*.md", "automation"),
    ]


def scan(store: Store, names: set[str] | None = None) -> dict[str, dict[str, int]]:
    report: dict[str, dict[str, int]] = {}
    for source in available_sources():
        if names is not None and source.name not in names:
            continue
        stats = {"found": 0, "added": 0, "updated": 0, "unchanged": 0, "errors": 0}
        for path in source.files():
            stats["found"] += 1
            try:
                content = path.read_text(encoding="utf-8").strip()
            except (OSError, UnicodeError):
                stats["errors"] += 1
                continue
            if not content:
                continue
            fingerprint = hashlib.sha256(content.encode()).hexdigest()
            result = store.put(
                source=source.name,
                origin=source.origin,
                source_path=str(path),
                source_key=f"{source.name}:{path.resolve()}",
                fingerprint=fingerprint,
                title=_title(path, content),
                content=content,
                project=_project(source, path),
            )
            stats[result] += 1
        report[source.name] = stats
    return report


def _title(path: Path, content: str) -> str:
    match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    return match.group(1).strip() if match else path.stem.replace("_", " ").replace("-", " ").title()


def _project(source: Source, path: Path) -> str:
    if source.name == "claude":
        return path.parents[1].name
    if source.name == "codex":
        relative = path.relative_to(source.root)
        return relative.parts[0] if len(relative.parts) > 1 else ""
    return "personal"
