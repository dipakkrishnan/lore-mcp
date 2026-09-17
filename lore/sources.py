from __future__ import annotations

import hashlib
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime, timezone
from enum import Enum
from functools import cached_property
from pathlib import Path
from typing import Iterator

from .paths import claude_home, codex_home, home
from .store import Store

OWNER_SOURCES = "owner_sources"
OWNER_FIELDS = ("name", "label", "kind", "locator", "since")
SOURCE_READS = "source_reads"
OWNER_PATTERN = "**/*.md"
# An owner's folder is arbitrary notes, not agent-written memory files: a line
# shorter than a sentence is a heading or a stub, never a lesson worth keeping.
SENTENCE = 40
# Vault plumbing and blank templates, which read as memories but are not.
SKIPPED_DIRECTORIES = {".obsidian", ".trash", "templates"}
FRONTMATTER = re.compile(r"\A---\n(.*?)\n---", re.DOTALL)


class State(str, Enum):
    """What the last real read of a source found. `CONNECTED` is the only
    green: a locator that merely resolves has not been read."""

    CONNECTED = "connected"
    NOTHING_FOUND = "nothing_found"
    NEEDS_PERMISSION = "needs_permission"
    UNREACHABLE = "unreachable"
    OFF = "off"

    def __str__(self) -> str:
        return self.value


class SourceError(ValueError):
    """A source argument the owner can correct: an unknown name, a folder that
    is not there, a built-in that cannot be removed."""


@dataclass(frozen=True)
class Item:
    """One candidate memory as its source hands it over."""

    title: str
    content: str
    source_path: str
    dated: str | None


@dataclass(frozen=True)
class Source:
    name: str
    label: str
    locator: str
    pattern: str = OWNER_PATTERN
    origin: str = "native"
    kind: str = "folder"
    owned: bool = False
    since: str | None = None

    @property
    def root(self) -> Path:
        return Path(self.locator)

    def reader(self) -> Reader:
        return READERS[self.kind](self)

    def keeps(self, item: Item) -> bool:
        """Whether an item this source yielded becomes a memory."""
        if not self.owned:
            return bool(item.content)
        return len(item.content) >= SENTENCE and (
            self.since is None or item.dated is None or item.dated >= self.since
        )


class Reader(ABC):
    """How one kind of source is read. Only folders are readable in this cut;
    feeds, exports, and scripts are `CAP-004` through `CAP-007`."""

    def __init__(self, source: Source) -> None:
        self.source = source
        self.errors = 0

    @abstractmethod
    def probe(self) -> State:
        """Read enough of the source, for real, to name its state."""

    @abstractmethod
    def items(self) -> Iterator[Item]:
        """Yield every candidate, counting unreadable ones in `errors`."""


class FolderReader(Reader):
    @cached_property
    def files(self) -> list[Path]:
        return sorted(
            path
            for path in self.source.root.glob(self.source.pattern)
            if path.is_file() and not path.is_symlink() and self._included(path)
        )

    def probe(self) -> State:
        root = self.source.root
        if not root.is_dir():
            return State.UNREACHABLE
        try:
            # `glob` swallows a denied directory and returns nothing, so the
            # only way to tell "no permission" from "nothing there" is to ask.
            next(root.iterdir(), None)
        except PermissionError:
            return State.NEEDS_PERMISSION
        except OSError:
            return State.UNREACHABLE
        return State.CONNECTED if self.files else State.NOTHING_FOUND

    def items(self) -> Iterator[Item]:
        for path in self.files:
            try:
                content = path.read_text(encoding="utf-8").strip()
            except (OSError, UnicodeError):
                self.errors += 1
                continue
            yield Item(_title(path, content), content, str(path), _dated(path, content))

    def _included(self, path: Path) -> bool:
        if not self.source.owned:
            return not (self.source.origin == "automation" and path.name == "INDEX.md")
        parts = path.relative_to(self.source.root).parts[:-1]
        return not any(part.lower() in SKIPPED_DIRECTORIES for part in parts)


READERS: dict[str, type[Reader]] = {"folder": FolderReader}


def available_sources() -> list[Source]:
    """Return native and synthesized memory sources for the current user."""
    return [
        Source("codex", "Codex", str(codex_home() / "memories"), "MEMORY.md"),
        Source(
            "claude",
            "Claude Code",
            str(claude_home() / "projects"),
            "*/memory/*.md",
        ),
        Source(
            "automation",
            "Synthesis",
            str(home() / "memories"),
            OWNER_PATTERN,
            "automation",
        ),
    ]


def owner_sources(store: Store) -> list[Source]:
    """Return the folders the owner connected, in the order they added them."""
    return [
        Source(
            name=str(record["name"]),
            label=str(record["label"]),
            locator=str(record["locator"]),
            kind=str(record["kind"]),
            owned=True,
            since=record["since"],
        )
        for record in _records(store)
    ]


def all_sources(store: Store) -> list[Source]:
    return available_sources() + owner_sources(store)


def scan(store: Store, names: set[str] | None = None) -> dict[str, dict[str, int]]:
    """Import changed items from selected sources and return per-source counts."""
    report: dict[str, dict[str, int]] = {}
    for source in all_sources(store):
        if names is not None and source.name not in names:
            continue
        report[source.name] = _import(store, source)
    return report


def entries(store: Store) -> list[dict[str, object]]:
    """Describe every source the owner can see, built-ins first."""
    enabled = _enabled(store)
    counts = store.source_counts()
    reads = _reads(store)
    return [
        _entry(source, source.owned or source.name in enabled, counts, reads)
        for source in all_sources(store)
        if source.origin != "automation"
    ]


def preview(locator: str) -> dict[str, object]:
    """Report what a folder would import, writing nothing."""
    source = _owner_source(locator)
    reader = source.reader()
    state = reader.probe()
    kept: list[Item] = []
    skipped = 0
    for item in reader.items():
        if source.keeps(item):
            kept.append(item)
        else:
            skipped += 1
    dates = sorted(item.dated for item in kept if item.dated)
    return {
        "count": len(kept),
        "from": dates[0] if dates else None,
        "to": dates[-1] if dates else None,
        "skipped": skipped,
        "state": state.value,
    }


def add(
    store: Store,
    locator: str,
    label: str | None = None,
    since: str | None = None,
) -> dict[str, object]:
    """Connect a folder, read it once, and return the source it became."""
    source = _owner_source(locator, label, _day(since))
    if not source.root.is_dir():
        raise SourceError(f"not a folder: {locator}")
    records = _records(store)
    if source.name not in {record["name"] for record in records}:
        store.set_setting(
            OWNER_SOURCES,
            records + [{key: getattr(source, key) for key in OWNER_FIELDS}],
        )
        _import(store, source)
    return _one(store, source.name)


def read(store: Store, names: list[str] | None = None) -> list[dict[str, object]]:
    """Import from the named sources, or from every enabled one."""
    known = {
        source.name: source
        for source in all_sources(store)
        if source.origin != "automation"
    }
    if names:
        unknown = [name for name in names if name not in known]
        if unknown:
            raise SourceError(f"unknown source: {unknown[0]}")
        chosen = [known[name] for name in names]
    else:
        enabled = _enabled(store)
        chosen = [s for s in known.values() if s.owned or s.name in enabled]
    report = scan(store, {source.name for source in chosen})
    reads = _reads(store)
    return [
        {
            "name": source.name,
            **{
                key: report[source.name][key]
                for key in ("added", "updated", "unchanged", "errors")
            },
            "state": reads[source.name]["state"],
        }
        for source in chosen
    ]


def remove(store: Store, name: str, *, delete: bool) -> dict[str, object]:
    """Disconnect an owner-added source, keeping or deleting what it imported."""
    if name in {source.name for source in available_sources()}:
        raise SourceError(f"{name} is built in and cannot be removed")
    records = _records(store)
    remaining = [record for record in records if record["name"] != name]
    if len(remaining) == len(records):
        raise SourceError(f"unknown source: {name}")
    store.set_setting(OWNER_SOURCES, remaining)
    reads = _reads(store)
    reads.pop(name, None)
    store.set_setting(SOURCE_READS, reads)
    memories = (
        store.delete_source_memories(name)
        if delete
        else {"kept": store.source_counts().get(name, 0)}
    )
    return {"name": name, "removed": True, "memories": memories}


def _owner_source(
    locator: str, label: str | None = None, since: str | None = None
) -> Source:
    # Two spellings of one folder are one source, so the identity is the
    # resolved path rather than what the owner typed.
    root = Path(locator).expanduser().resolve()
    digest = hashlib.sha256(str(root).encode()).hexdigest()[:8]
    return Source(
        name=f"folder-{digest}",
        label=label or root.name,
        locator=str(root),
        owned=True,
        since=since,
    )


def _day(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise SourceError(f"not a date: {value}") from None


def _entry(
    source: Source,
    enabled: bool,
    counts: dict[str, int],
    reads: dict[str, dict[str, str]],
) -> dict[str, object]:
    last = reads.get(source.name)
    if not enabled:
        state = State.OFF
    elif last:
        state = State(last["state"])
    else:
        state = source.reader().probe()
    return {
        "name": source.name,
        "label": source.label,
        "kind": source.kind,
        "locator": source.locator,
        "owned": source.owned,
        "enabled": enabled,
        "imported": counts.get(source.name, 0),
        "state": state.value,
        "last_read_at": last["at"] if last else None,
    }


def _one(store: Store, name: str) -> dict[str, object]:
    return next(entry for entry in entries(store) if entry["name"] == name)


def _import(store: Store, source: Source) -> dict[str, int]:
    stats = {"found": 0, "added": 0, "updated": 0, "unchanged": 0, "errors": 0}
    reader = source.reader()
    state = reader.probe()
    for item in reader.items():
        stats["found"] += 1
        if not source.keeps(item):
            continue
        path = Path(item.source_path)
        result = store.put(
            source=source.name,
            origin=source.origin,
            source_path=item.source_path,
            source_key=f"{source.name}:{path.resolve()}",
            fingerprint=hashlib.sha256(item.content.encode()).hexdigest(),
            title=item.title,
            content=item.content,
            project=_project(source, path),
        )
        stats[result] += 1
    stats["found"] += reader.errors
    stats["errors"] = reader.errors
    reads = _reads(store)
    reads[source.name] = {
        "at": datetime.now(timezone.utc).isoformat(),
        "state": state.value,
    }
    store.set_setting(SOURCE_READS, reads)
    return stats


def _enabled(store: Store) -> set[str]:
    configured = store.setting("sources", [])
    return set(configured) if isinstance(configured, list) else set()


def _records(store: Store) -> list[dict[str, str | None]]:
    stored = store.setting(OWNER_SOURCES, [])
    if not isinstance(stored, list):
        return []
    return [record for record in stored if isinstance(record, dict)]


def _reads(store: Store) -> dict[str, dict[str, str]]:
    stored = store.setting(SOURCE_READS, {})
    return stored if isinstance(stored, dict) else {}


def _title(path: Path, content: str) -> str:
    match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    return (
        match.group(1).strip()
        if match
        else path.stem.replace("_", " ").replace("-", " ").title()
    )


def _dated(path: Path, content: str) -> str | None:
    front = FRONTMATTER.match(content)
    if front:
        for field in ("date", "created"):
            match = re.search(
                rf"^{field}:\s*['\"]?(\d{{4}}-\d{{2}}-\d{{2}})",
                front.group(1),
                re.MULTILINE,
            )
            if match:
                return match.group(1)
    return date.fromtimestamp(path.stat().st_mtime).isoformat()


def _project(source: Source, path: Path) -> str:
    if source.name == "claude":
        return path.parents[1].name
    if source.name == "codex":
        relative = path.relative_to(source.root)
        return relative.parts[0] if len(relative.parts) > 1 else ""
    return "personal"
