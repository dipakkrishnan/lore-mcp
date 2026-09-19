from __future__ import annotations

import hashlib
import re
from abc import ABC, abstractmethod
from dataclasses import replace
from datetime import date, datetime, timezone
from enum import Enum
from functools import cached_property
from pathlib import Path
from typing import Iterator, Literal

from pydantic import BaseModel, TypeAdapter, ValidationError
from pydantic.dataclasses import dataclass

from .paths import claude_home, codex_home, home
from .store import Store


class State(Enum):
    # The only green: a locator that merely resolves has not been read.
    CONNECTED = "connected"
    NOTHING_FOUND = "nothing_found"
    NEEDS_PERMISSION = "needs_permission"
    UNREACHABLE = "unreachable"
    OFF = "off"


class SourceError(ValueError):
    pass


@dataclass(frozen=True)
class Item:
    title: str
    content: str
    source_path: str
    dated: str | None


@dataclass(frozen=True)
class Source:
    name: str
    label: str
    locator: str
    pattern: str = "**/*.md"
    origin: Literal["native", "automation"] = "native"
    kind: Literal["folder"] = "folder"
    owned: bool = False
    since: str | None = None

    def reader(self) -> Reader:
        readers: dict[str, type[Reader]] = {"folder": FolderReader}
        reader = readers[self.kind]
        return reader(self)

    @classmethod
    def owner(
        cls,
        locator: str,
        label: str | None = None,
        since: str | None = None,
        kind: str = "folder",
    ) -> Source:
        try:
            source = cls(
                "",
                label or "",
                locator,
                kind=TypeAdapter(Literal["folder"]).validate_python(kind),
                owned=True,
                since=_day(since),
            )
        except ValidationError as error:
            raise SourceError(str(error)) from None
        locator, default = source.reader().locate(locator)
        digest = hashlib.sha256(locator.encode()).hexdigest()[:8]
        return replace(
            source, name=f"{kind}-{digest}", label=label or default, locator=locator
        )


class Reader(ABC):
    # An owner's folder is arbitrary notes, not agent-written memory files: a
    # line shorter than a sentence is a heading or a stub, never a lesson.
    sentence = 40

    def __init__(self, source: Source) -> None:
        self.source = source
        self.errors = 0

    @classmethod
    @abstractmethod
    def locate(cls, locator: str) -> tuple[str, str]:
        """Normalise what the owner typed into the source's identity and a default label."""

    @abstractmethod
    def probe(self) -> State:
        """Read the source and distinguish empty, inaccessible, and connected."""

    @abstractmethod
    def items(self) -> Iterator[Item]:
        """Yield source items, counting unreadable records in errors."""

    def keeps(self, item: Item) -> bool:
        source = self.source
        if not source.owned:
            return bool(item.content)
        return len(item.content) >= self.sentence and (
            source.since is None or item.dated is None or item.dated >= source.since
        )


class FolderReader(Reader):
    # Vault plumbing and blank templates, which read as memories but are not.
    skipped = {".obsidian", ".trash", "templates"}
    frontmatter = re.compile(r"\A---\n(.*?)\n---", re.DOTALL)

    @classmethod
    def locate(cls, locator: str) -> tuple[str, str]:
        # Two spellings of one folder are one source, so the identity is the
        # resolved path rather than what the owner typed.
        root = Path(locator).expanduser().resolve()
        return str(root), root.name

    @cached_property
    def files(self) -> list[Path]:
        return sorted(
            path
            for path in Path(self.source.locator).glob(self.source.pattern)
            if path.is_file() and not path.is_symlink() and self._included(path)
        )

    def probe(self) -> State:
        root = Path(self.source.locator)
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
            yield Item(
                _title(path, content), content, str(path), self._dated(path, content)
            )

    def _included(self, path: Path) -> bool:
        if not self.source.owned:
            return not (self.source.origin == "automation" and path.name == "INDEX.md")
        parts = path.relative_to(Path(self.source.locator)).parts[:-1]
        return not any(part.lower() in self.skipped for part in parts)

    def _dated(self, path: Path, content: str) -> str | None:
        front = self.frontmatter.match(content)
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


class LastRead(BaseModel):
    at: str
    state: State


class Registry:
    """Source configuration and imports, sharing one store and one read snapshot."""

    source_records = TypeAdapter(list[Source])
    read_records = TypeAdapter(dict[str, LastRead])

    def __init__(self, store: Store) -> None:
        self.store = store
        try:
            self.owned = self.source_records.validate_python(
                store.setting("owner_sources", [])
            )
            self.reads = self.read_records.validate_python(
                store.setting("source_reads", {})
            )
        except ValidationError as error:
            raise SourceError(f"invalid saved sources: {error}") from None
        configured = store.setting("sources", [])
        self.enabled = set(configured) if isinstance(configured, list) else set()
        self.sources = available_sources() + self.owned

    def entries(self) -> list[dict[str, object]]:
        counts = self.store.source_counts()
        entries: list[dict[str, object]] = []
        for source in self.sources:
            if source.origin == "automation":
                continue
            enabled = source.owned or source.name in self.enabled
            last = self.reads.get(source.name)
            state = (
                (last.state if last else source.reader().probe())
                if enabled
                else State.OFF
            )
            entries.append(
                {
                    "name": source.name,
                    "label": source.label,
                    "kind": source.kind,
                    "locator": source.locator,
                    "owned": source.owned,
                    "enabled": enabled,
                    "imported": counts.get(source.name, 0),
                    "state": state.value,
                    "last_read_at": last.at if last else None,
                }
            )
        return entries

    def add(
        self,
        locator: str,
        label: str | None = None,
        since: str | None = None,
        kind: str = "folder",
    ) -> dict[str, object]:
        source = Source.owner(locator, label, since, kind)
        if source.reader().probe() is State.UNREACHABLE:
            raise SourceError(f"can't reach {locator}")
        if source.name not in {record.name for record in self.owned}:
            self.owned.append(source)
            self.sources.append(source)
            self.store.set_setting(
                "owner_sources",
                self.source_records.dump_python(self.owned, mode="json"),
            )
            self.scan({source.name})
        return next(entry for entry in self.entries() if entry["name"] == source.name)

    def read(self, names: list[str] | None = None) -> list[dict[str, object]]:
        known = {s.name: s for s in self.sources if s.origin != "automation"}
        if names:
            unknown = set(names) - known.keys()
            if unknown:
                raise SourceError(f"unknown source: {sorted(unknown)[0]}")
            chosen = names
        else:
            chosen = [
                s.name for s in known.values() if s.owned or s.name in self.enabled
            ]
        report = self.scan(set(chosen))
        return [
            {
                "name": name,
                **{key: value for key, value in report[name].items() if key != "found"},
                "state": self.reads[name].state.value,
            }
            for name in chosen
        ]

    def remove(self, name: str, *, delete: bool) -> dict[str, object]:
        if name in {source.name for source in available_sources()}:
            raise SourceError(f"{name} is built in and cannot be removed")
        remaining = [source for source in self.owned if source.name != name]
        if len(remaining) == len(self.owned):
            raise SourceError(f"unknown source: {name}")
        self.owned = remaining
        self.sources = [source for source in self.sources if source.name != name]
        self.reads.pop(name, None)
        self.store.set_setting(
            "owner_sources", self.source_records.dump_python(self.owned, mode="json")
        )
        self.store.set_setting(
            "source_reads", self.read_records.dump_python(self.reads, mode="json")
        )
        memories = (
            self.store.delete_source_memories(name)
            if delete
            else {"kept": self.store.source_counts().get(name, 0)}
        )
        return {"name": name, "removed": True, "memories": memories}

    def scan(self, names: set[str] | None = None) -> dict[str, dict[str, int]]:
        """Import changed items privately, preserving stable keys and review status."""
        report: dict[str, dict[str, int]] = {}
        for source in self.sources:
            if names is not None and source.name not in names:
                continue
            stats = {"found": 0, "added": 0, "updated": 0, "unchanged": 0, "errors": 0}
            reader = source.reader()
            state = reader.probe()
            for item in reader.items():
                stats["found"] += 1
                if not reader.keeps(item):
                    continue
                path = Path(item.source_path)
                result = self.store.put(
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
            self.reads[source.name] = LastRead(
                at=datetime.now(timezone.utc).isoformat(), state=state
            )
            report[source.name] = stats
        self.store.set_setting(
            "source_reads", self.read_records.dump_python(self.reads, mode="json")
        )
        return report


def available_sources() -> list[Source]:
    """Return native and synthesized memory sources for the current user."""
    return [
        Source("codex", "Codex", str(codex_home() / "memories"), "MEMORY.md"),
        Source(
            "claude", "Claude Code", str(claude_home() / "projects"), "*/memory/*.md"
        ),
        Source(
            "automation", "Synthesis", str(home() / "memories"), origin="automation"
        ),
    ]


def preview(locator: str, kind: str = "folder") -> dict[str, object]:
    """Report what a source would import, writing nothing."""
    reader = Source.owner(locator, kind=kind).reader()
    state = reader.probe()
    kept: list[Item] = []
    skipped = 0
    for item in reader.items():
        if reader.keeps(item):
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


def _day(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise SourceError(f"not a date: {value}") from None


def _title(path: Path, content: str) -> str:
    match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    return (
        match.group(1).strip()
        if match
        else path.stem.replace("_", " ").replace("-", " ").title()
    )


def _project(source: Source, path: Path) -> str:
    if source.name == "claude":
        return path.parents[1].name
    if source.name == "codex":
        relative = path.relative_to(Path(source.locator))
        return relative.parts[0] if len(relative.parts) > 1 else ""
    return "personal"
