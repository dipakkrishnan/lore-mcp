"""Collections (MON-044) and the feed (MON-045).

A collection: make one, drop context into it, price it.

Each dropped file or pasted text becomes a piece of the collection, kept as a
private memory and put on sale with it. Pricing a collection puts it on sale;
every change that reaches buyers pushes the store.
"""

from __future__ import annotations

import contextlib
import subprocess
import sys
from pathlib import Path
from typing import Callable

from pydantic import BaseModel, ConfigDict, Field

from .capture import CaptureEntry
from .store import Collection, Store, new_public_id

TEXT = {".md", ".markdown", ".txt", ".text", ".csv", ".json", ".org", ".rst"}
# Formats macOS's textutil turns into plain text.
CONVERTIBLE = {".docx", ".doc", ".rtf", ".rtfd", ".html", ".htm", ".odt", ".webarchive"}
MAX_FILES = 200


class Paste(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    title: str = ""
    content: str = Field(min_length=1)


class Drop(BaseModel):
    """What the owner dropped on a collection: pasted text and file paths."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    items: list[Paste] = []
    files: list[str] = []


class Collections:
    def __init__(self, push: Callable[[], object]) -> None:
        self.push = push

    def new(self, title: str) -> Collection:
        with Store() as store:
            return store.new_collection(title)

    def add(self, collection_id: int, drop: Drop) -> list[dict[str, object]]:
        entries = self.entries(drop)
        with Store() as store:
            pieces = [
                store.add_to_collection(collection_id, entry.title, entry.content)
                for entry in entries
            ]
            on_sale = store.collection(collection_id).on_sale
        if on_sale:
            self._push()
        return [
            {"publication_id": p.id, "public_id": p.public_id, "title": p.title}
            for p in pieces
        ]

    def sell(self, drop: Drop) -> list[dict[str, object]]:
        """Put each dropped item on sale on its own, at the store's price."""
        entries = self.entries(drop)
        with Store() as store:
            ids = [store.sell_piece(e.title, e.content) for e in entries]
            pieces = [store.active_publication(i) for i in ids]
        self._push()
        return [
            {"publication_id": p.id, "public_id": p.public_id, "title": p.title}
            for p in pieces
        ]

    def entries(self, drop: Drop) -> list[CaptureEntry]:
        texts = [(item.title, item.content) for item in drop.items]
        texts += [self._read(path) for path in self._files(drop.files)]
        entries = [
            CaptureEntry(title=title or _first_line(content), content=content)
            for title, content in texts
            if content.strip()
        ]
        if not entries:
            raise ValueError("there was no text to add")
        return entries

    def rename(self, collection_id: int, title: str) -> Collection:
        with Store() as store:
            collection = store.rename_collection(collection_id, title)
        if collection.on_sale:
            self._push()
        return collection

    def price(self, collection_id: int, price_usd: float) -> Collection:
        with Store() as store:
            was = store.collection(collection_id).on_sale
            collection = store.price_collection(collection_id, price_usd)
        if was or collection.on_sale:
            self._push()
        return collection

    def remove(self, collection_id: int, publication_id: int) -> Collection:
        with Store() as store:
            store.remove_from_collection(collection_id, publication_id)
            collection = store.collection(collection_id)
        self._push()
        return collection

    def delete(self, collection_id: int) -> None:
        with Store() as store:
            was = store.collection(collection_id).on_sale
            store.delete_collection(collection_id)
        if was:
            self._push()

    def _push(self) -> None:
        push_open_store(self.push)

    @staticmethod
    def _files(paths: list[str]) -> list[Path]:
        found: list[Path] = []
        for path in map(Path, paths):
            if path.is_dir():
                found += sorted(
                    child
                    for child in path.rglob("*")
                    if child.is_file()
                    and child.suffix.lower() in TEXT | CONVERTIBLE
                    and not any(part.startswith(".") for part in child.parts)
                )
            elif path.is_file():
                found.append(path)
            else:
                raise ValueError(f"{path.name} isn't there anymore")
        if len(found) > MAX_FILES:
            raise ValueError(f"that's over {MAX_FILES} files; drop fewer at a time")
        return found

    @staticmethod
    def _read(path: Path) -> tuple[str, str]:
        suffix = path.suffix.lower()
        if suffix in CONVERTIBLE:
            result = subprocess.run(
                ["textutil", "-convert", "txt", "-stdout", str(path)],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode != 0:
                raise ValueError(f"Lore couldn't read {path.name}")
            return path.stem, result.stdout
        try:
            return path.stem, path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            raise ValueError(
                f"Lore can't read {path.name} yet; paste its text instead"
            ) from None


def push_open_store(push: Callable[[], object]) -> None:
    """Push when the owner has a store; the caller's JSON keeps stdout to itself."""
    with Store() as store:
        if not store.setting("node_url", None):
            return
    with contextlib.redirect_stdout(sys.stderr):
        push()


def _first_line(content: str) -> str:
    line = next((line for line in content.splitlines() if line.strip()), "")
    return line.lstrip("#").strip()[:80] or "Untitled piece"


FEED_SETTING = "feed_price_usd"
# A piece-shaped id for the feed, so card checkout can sell it like a piece.
FEED_ID_SETTING = "feed_id"
FEED_DAYS = 30


class Feed:
    """A 30-day pass to every piece in the store, old and new, for agents."""

    def __init__(self, push: Callable[[], object]) -> None:
        self.push = push

    @staticmethod
    def price() -> float:
        with Store() as store:
            value = store.setting(FEED_SETTING, 0)
        return float(value) if isinstance(value, (int, float)) else 0.0

    @staticmethod
    def suggested() -> float:
        with Store() as store:
            piece = store.setting("price_usd", 0)
        piece = float(piece) if isinstance(piece, (int, float)) else 0.0
        return float(max(5, round(piece * 10)))

    def on(self, price_usd: float | None = None) -> float:
        price = self.suggested() if price_usd is None else round(price_usd, 2)
        if not price > 0 or price == float("inf"):
            raise ValueError("a feed price has to be above zero")
        self._set(price)
        return price

    def off(self) -> None:
        self._set(0)

    def _set(self, price: float) -> None:
        with Store() as store:
            store.set_setting(FEED_SETTING, price)
            if not store.setting(FEED_ID_SETTING, ""):
                store.set_setting(FEED_ID_SETTING, new_public_id())
        push_open_store(self.push)
