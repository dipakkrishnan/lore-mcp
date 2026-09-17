from __future__ import annotations

import hashlib
import json
import re
import zipfile
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, fields
from datetime import date, datetime, timezone
from enum import Enum
from functools import cached_property
from pathlib import Path
from typing import Iterator

from .paths import claude_home, codex_home, home
from .store import Store


class State(str, Enum):
    # The only green: a locator that merely resolves has not been read.
    CONNECTED = "connected"
    NOTHING_FOUND = "nothing_found"
    NEEDS_PERMISSION = "needs_permission"
    UNREACHABLE = "unreachable"
    OFF = "off"

    def __str__(self) -> str:
        return self.value


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
    origin: str = "native"
    kind: str = "folder"
    owned: bool = False
    since: str | None = None

    @property
    def root(self) -> Path:
        return Path(self.locator)

    def reader(self) -> Reader:
        reader = next(cls for cls in Reader.__subclasses__() if cls.kind == self.kind)
        return reader(self)  # type: ignore[abstract]

    @classmethod
    def owner(
        cls,
        locator: str,
        label: str | None = None,
        since: str | None = None,
        kind: str = "folder",
    ) -> Source:
        reader = next(r for r in Reader.__subclasses__() if r.kind == kind)
        locator, default = reader.locate(locator)
        digest = hashlib.sha256(locator.encode()).hexdigest()[:8]
        return cls(
            f"{kind}-{digest}",
            label or default,
            locator,
            kind=kind,
            owned=True,
            since=since,
        )

    @classmethod
    def load(cls, record: dict[str, object]) -> Source:
        names = {field.name for field in fields(cls)}
        return cls(**{key: value for key, value in record.items() if key in names})  # type: ignore[arg-type]


class Reader(ABC):
    kind = ""
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
    def probe(self) -> State: ...

    @abstractmethod
    def items(self) -> Iterator[Item]: ...

    def keeps(self, item: Item) -> bool:
        source = self.source
        if not source.owned:
            return bool(item.content)
        return len(item.content) >= self.sentence and (
            source.since is None or item.dated is None or item.dated >= source.since
        )


class FolderReader(Reader):
    kind = "folder"
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
            yield Item(
                _title(path, content), content, str(path), self._dated(path, content)
            )

    def _included(self, path: Path) -> bool:
        if not self.source.owned:
            return not (self.source.origin == "automation" and path.name == "INDEX.md")
        parts = path.relative_to(self.source.root).parts[:-1]
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


class ExportReader(Reader):
    kind = "export"
    member = "conversations.json"
    # The assistant's turn is what the owner's words were answering, not a
    # memory of its own, so it is kept only as trimmed context.
    reply = 600
    products = {"mapping": "ChatGPT", "chat_messages": "Claude"}

    @classmethod
    def locate(cls, locator: str) -> tuple[str, str]:
        path = Path(locator).expanduser().resolve()
        return str(path), cls._product(cls._read(path))

    @classmethod
    def _read(cls, path: Path) -> list[dict] | None:
        """None when the path is not an export at all, as against an empty one."""
        try:
            if zipfile.is_zipfile(path):
                with zipfile.ZipFile(path) as archive:
                    name = next(
                        (n for n in archive.namelist() if n.endswith(cls.member)), ""
                    )
                    with archive.open(name) as member:
                        loaded = json.load(member)
            else:
                loaded = json.loads(path.read_bytes())
        except (OSError, ValueError, KeyError, zipfile.BadZipFile):
            return None
        if not isinstance(loaded, list):
            return None
        return [entry for entry in loaded if isinstance(entry, dict)]

    @classmethod
    def _product(cls, conversations: list[dict] | None) -> str:
        first = conversations[0] if conversations else {}
        return next(
            (name for key, name in cls.products.items() if key in first), "Export"
        )

    @cached_property
    def conversations(self) -> list[dict] | None:
        return self._read(self.source.root)

    def probe(self) -> State:
        if self.conversations is None:
            return State.UNREACHABLE
        return State.CONNECTED if self.conversations else State.NOTHING_FOUND

    def items(self) -> Iterator[Item]:
        for index, conversation in enumerate(self.conversations or []):
            turns = list(self._turns(conversation))
            held = conversation.get("uuid") or conversation.get("id") or index
            yield Item(
                self._name(conversation, turns),
                self._content(turns),
                f"{self.source.locator}#{held}",
                self._day(conversation, turns),
            )

    def _turns(self, conversation: dict) -> Iterator[tuple[str, str, object]]:
        if "mapping" in conversation:
            yield from self._kept(conversation)
            return
        for message in conversation.get("chat_messages") or []:
            said = "human" if message.get("sender") == "human" else "assistant"
            text = str(message.get("text") or "").strip()
            yield said, text, message.get("created_at")

    def _kept(self, conversation: dict) -> Iterator[tuple[str, str, object]]:
        """Walk `current_node` back to the root and keep only that path: a
        regenerated answer hangs off the same tree but was never said."""
        mapping = conversation.get("mapping") or {}
        walked: list[str] = []
        node = str(conversation.get("current_node") or "")
        while node in mapping and node not in walked:
            walked.append(node)
            node = str(mapping[node].get("parent") or "")
        for node in reversed(walked):
            message = mapping[node].get("message") or {}
            role = (message.get("author") or {}).get("role")
            parts = (message.get("content") or {}).get("parts") or []
            text = "\n".join(part for part in parts if isinstance(part, str)).strip()
            if role in ("user", "assistant") and text:
                said = "human" if role == "user" else "assistant"
                yield said, text, message.get("create_time")

    def _content(self, turns: list[tuple[str, str, object]]) -> str:
        blocks: list[str] = []
        for index, (role, text, _) in enumerate(turns):
            if role != "human" or len(text) < self.sentence:
                continue
            blocks.append(text)
            answer = turns[index + 1] if index + 1 < len(turns) else None
            if answer and answer[0] == "assistant":
                blocks.append(f"Reply: {answer[1][: self.reply]}")
        return "\n\n".join(blocks)

    def _name(self, conversation: dict, turns: list[tuple[str, str, object]]) -> str:
        titled = conversation.get("title") or conversation.get("name") or ""
        spoken = next((text for role, text, _ in turns if role == "human"), "")
        return str(titled).strip() or spoken.split("\n")[0][:60]

    def _day(
        self, conversation: dict, turns: list[tuple[str, str, object]]
    ) -> str | None:
        stamped = next((at for _, _, at in turns if at), None)
        started = conversation.get("create_time") or conversation.get("created_at")
        when = stamped or started
        try:
            if isinstance(when, (int, float)):
                return datetime.fromtimestamp(when, timezone.utc).date().isoformat()
            return date.fromisoformat(str(when)[:10]).isoformat() if when else None
        except (ValueError, OSError, OverflowError):
            return None


class Registry:
    """The owner's connected sources and the outcome of each source's last read."""

    sources_key = "owner_sources"
    reads_key = "source_reads"

    def __init__(self, store: Store) -> None:
        self.store = store

    @property
    def records(self) -> list[dict[str, object]]:
        stored = self.store.setting(self.sources_key, [])
        return (
            [r for r in stored if isinstance(r, dict)]
            if isinstance(stored, list)
            else []
        )

    @records.setter
    def records(self, value: list[dict[str, object]]) -> None:
        self.store.set_setting(self.sources_key, value)

    @property
    def reads(self) -> dict[str, dict[str, str]]:
        stored = self.store.setting(self.reads_key, {})
        return stored if isinstance(stored, dict) else {}

    @reads.setter
    def reads(self, value: dict[str, dict[str, str]]) -> None:
        self.store.set_setting(self.reads_key, value)

    @property
    def enabled(self) -> set[str]:
        configured = self.store.setting("sources", [])
        return set(configured) if isinstance(configured, list) else set()

    def record(self, source: Source, state: State) -> None:
        reads = self.reads
        reads[source.name] = {
            "at": datetime.now(timezone.utc).isoformat(),
            "state": state.value,
        }
        self.reads = reads


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


def owner_sources(store: Store) -> list[Source]:
    return [Source.load(record) for record in Registry(store).records]


def all_sources(store: Store) -> list[Source]:
    return available_sources() + owner_sources(store)


def scan(store: Store, names: set[str] | None = None) -> dict[str, dict[str, int]]:
    """Import changed items from selected sources and return per-source counts."""
    return {
        source.name: _import(store, source)
        for source in all_sources(store)
        if names is None or source.name in names
    }


def entries(store: Store) -> list[dict[str, object]]:
    registry = Registry(store)
    counts = store.source_counts()
    return [
        _entry(
            source,
            source.owned or source.name in registry.enabled,
            counts,
            registry.reads,
        )
        for source in all_sources(store)
        if source.origin != "automation"
    ]


def preview(locator: str, kind: str = "folder") -> dict[str, object]:
    """Report what a source would import, writing nothing."""
    source = Source.owner(locator, kind=kind)
    reader = source.reader()
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
        "label": source.label,
    }


def add(
    store: Store,
    locator: str,
    label: str | None = None,
    since: str | None = None,
    kind: str = "folder",
) -> dict[str, object]:
    source = Source.owner(locator, label, _day(since), kind)
    if source.reader().probe() is State.UNREACHABLE:
        raise SourceError(f"can't reach {locator}")
    registry = Registry(store)
    records = registry.records
    if source.name not in {record["name"] for record in records}:
        registry.records = records + [asdict(source)]
        _import(store, source)
    return next(entry for entry in entries(store) if entry["name"] == source.name)


def read(store: Store, names: list[str] | None = None) -> list[dict[str, object]]:
    known = {s.name: s for s in all_sources(store) if s.origin != "automation"}
    if names:
        unknown = [name for name in names if name not in known]
        if unknown:
            raise SourceError(f"unknown source: {unknown[0]}")
        chosen = [known[name] for name in names]
    else:
        enabled = Registry(store).enabled
        chosen = [s for s in known.values() if s.owned or s.name in enabled]
    report = scan(store, {source.name for source in chosen})
    reads = Registry(store).reads
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
    if name in {source.name for source in available_sources()}:
        raise SourceError(f"{name} is built in and cannot be removed")
    registry = Registry(store)
    records = registry.records
    remaining = [record for record in records if record["name"] != name]
    if len(remaining) == len(records):
        raise SourceError(f"unknown source: {name}")
    registry.records = remaining
    reads = registry.reads
    reads.pop(name, None)
    registry.reads = reads
    memories = (
        store.delete_source_memories(name)
        if delete
        else {"kept": store.source_counts().get(name, 0)}
    )
    return {"name": name, "removed": True, "memories": memories}


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


def _import(store: Store, source: Source) -> dict[str, int]:
    stats = {"found": 0, "added": 0, "updated": 0, "unchanged": 0, "errors": 0}
    reader = source.reader()
    state = reader.probe()
    for item in reader.items():
        stats["found"] += 1
        if not reader.keeps(item):
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
    Registry(store).record(source, state)
    return stats


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
        relative = path.relative_to(source.root)
        return relative.parts[0] if len(relative.parts) > 1 else ""
    return "personal"
