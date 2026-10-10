"""Create the seed Notion pages from corpus/notion.json through the REST API.

    NOTION_TOKEN=... uv run python support/seed/seed_notion.py --parent PAGE_ID [--dry-run]

PAGE_ID is the hand-made "Tidewell HQ" page the seed integration was connected to; the
pages are created under it. The token comes from the environment and is never printed.
The nt-05 child database is skipped, and logged, if Notion refuses it. Every created
page id is written into manifest.json (`remote`). Unit-tested against a local stub only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SEED = Path(__file__).resolve().parent
CORPUS = SEED / "corpus" / "notion.json"
MANIFEST = SEED / "manifest.json"
API = "https://api.notion.com"
VERSION = "2022-06-28"
MARKER = "tidewell-seed"
PROPERTY_TYPES: dict[str, dict[str, dict[str, Any]]] = {
    "title": {"title": {}},
    "number": {"number": {}},
    "select": {"select": {}},
}


class SeedError(Exception):
    pass


def call(base: str, path: str, payload: dict[str, Any], token: str) -> Any:
    request = urllib.request.Request(
        f"{base}/v1/{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": VERSION,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def rich(text: str) -> list[dict[str, Any]]:
    return [{"type": "text", "text": {"content": text}}]


def block(entry: dict[str, Any]) -> dict[str, Any]:
    kind = entry["type"]
    body: dict[str, Any] = {"rich_text": rich(entry["text"])}
    if kind == "to_do":
        body["checked"] = bool(entry.get("checked"))
    if kind == "code":
        body["language"] = entry.get("language", "plain text")
    return {"object": "block", "type": kind, kind: body}


def cell(kind: str, value: Any) -> dict[str, Any]:
    if kind == "title":
        return {"title": rich(str(value))}
    if kind == "number":
        return {"number": value}
    return {"select": {"name": str(value)}}


def create_page(base: str, token: str, parent: str, page: dict[str, Any]) -> str:
    blocks = [block(b) for b in page["blocks"] if b["type"] != "database"]
    payload: dict[str, Any] = {
        "parent": {"page_id": parent},
        "properties": {"title": {"title": rich(page["title"])}},
    }
    if blocks:
        payload["children"] = blocks
    return str(call(base, "pages", payload, token)["id"])


def create_database(base: str, token: str, parent: str, spec: dict[str, Any]) -> str:
    properties = {
        name: PROPERTY_TYPES[kind] for name, kind in spec["properties"].items()
    }
    database = str(
        call(
            base,
            "databases",
            {
                "parent": {"type": "page_id", "page_id": parent},
                "title": rich(spec["title"]),
                "properties": properties,
            },
            token,
        )["id"]
    )
    for row in spec["rows"]:
        cells = {
            name: cell(spec["properties"][name], value) for name, value in row.items()
        }
        call(
            base,
            "pages",
            {"parent": {"database_id": database}, "properties": cells},
            token,
        )
    return database


def seed(
    corpus: dict[str, Any], base: str, token: str, parent: str
) -> tuple[dict[str, str], list[str]]:
    """Create every page under `parent`; return ({corpus id: page id}, notes on what was skipped)."""
    made: dict[str, str] = {}
    notes: list[str] = []
    for page in corpus["pages"]:
        texts = [b.get("text", "") for b in page["blocks"]]
        if page["blocks"] and not any(MARKER in t for t in texts):
            raise SeedError(
                f"{page['id']} lacks the {MARKER} marker; refusing to create it"
            )
        made[page["id"]] = create_page(base, token, parent, page)
        for entry in page["blocks"]:
            if entry["type"] == "database":
                try:
                    create_database(base, token, made[page["id"]], entry)
                except urllib.error.HTTPError as error:
                    notes.append(
                        f"{page['id']}: database '{entry['title']}' skipped, HTTP {error.code}"
                    )
    return made, notes


def write_manifest(made: dict[str, str], path: Path = MANIFEST) -> None:
    document = json.loads(path.read_text(encoding="utf-8"))
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for item in document["items"]:
        if item["id"] in made:
            page = made[item["id"]]
            item["remote"] = {
                "id": page,
                "url": f"https://www.notion.so/{page.replace('-', '')}",
                "created_at": stamp,
            }
    path.write_text(
        json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create the seed Notion pages.")
    parser.add_argument("--parent", help="id of the Tidewell HQ page")
    parser.add_argument("--api", default=API)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    if args.dry_run:
        for page in corpus["pages"]:
            print(page["id"], page["title"], f"{len(page['blocks'])} blocks")
        return 0
    token = os.environ.get("NOTION_TOKEN", "")
    if not token or not args.parent:
        print("set NOTION_TOKEN and pass --parent", file=sys.stderr)
        return 2
    made, notes = seed(corpus, args.api, token, args.parent)
    write_manifest(made)
    for corpus_id, page in made.items():
        print(corpus_id, page)
    for note in notes:
        print(note, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
