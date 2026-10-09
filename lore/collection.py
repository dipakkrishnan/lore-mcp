"""Collections (MON-044): make one, drop context into it, price it.

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
from .store import Collection, Store

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
        texts = [(item.title, item.content) for item in drop.items]
        texts += [self._read(path) for path in self._files(drop.files)]
        entries = [
            CaptureEntry(title=title or _first_line(content), content=content)
            for title, content in texts
            if content.strip()
        ]
        if not entries:
            raise ValueError("there was no text to add")
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
        with Store() as store:
            if not store.setting("node_url", None):
                return
        # The caller prints JSON on stdout; the push's own lines go to stderr.
        with contextlib.redirect_stdout(sys.stderr):
            self.push()

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


def _first_line(content: str) -> str:
    line = next((line for line in content.splitlines() if line.strip()), "")
    return line.lstrip("#").strip()[:80] or "Untitled piece"
