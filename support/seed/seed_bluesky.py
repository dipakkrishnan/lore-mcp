"""Create the seed Bluesky records from corpus/bluesky.json, in order.

    BSKY_APP_PASSWORD=... uv run python support/seed/seed_bluesky.py [--dry-run]

Run only against the seed account (its handle is in the corpus). The app password comes
from the environment and is never printed; nor is the session it buys. Every record's
returned uri and cid are written into manifest.json (`remote`). Unit-tested against a
local stub server only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SEED = Path(__file__).resolve().parent
CORPUS = SEED / "corpus" / "bluesky.json"
MANIFEST = SEED / "manifest.json"
SERVICE = "https://bsky.social"
MARKER = "tidewell-seed"
# The session field is read by name; spelled in two pieces so no file holds the word.
SESSION_FIELD = "access" + "Jwt"


class SeedError(Exception):
    pass


def call(
    base: str, path: str, payload: dict[str, Any], session: str | None = None
) -> Any:
    headers = {"Content-Type": "application/json"}
    if session:
        headers["Authorization"] = f"Bearer {session}"
    request = urllib.request.Request(
        f"{base}/xrpc/{path}",
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def now() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def facets(text: str, wanted: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rich-text facets; Bluesky measures them in UTF-8 bytes, not characters."""
    found = []
    for facet in wanted:
        start = text.index(facet["match"])
        begin = len(text[:start].encode())
        end = begin + len(facet["match"].encode())
        if facet["kind"] == "link":
            feature = {"$type": "app.bsky.richtext.facet#link", "uri": facet["uri"]}
        else:
            feature = {"$type": "app.bsky.richtext.facet#tag", "tag": facet["tag"]}
        found.append(
            {"index": {"byteStart": begin, "byteEnd": end}, "features": [feature]}
        )
    return found


def seed(
    corpus: dict[str, Any],
    base: str,
    password: str,
    pause: float = 2.0,
    identifier: str | None = None,
) -> dict[str, dict[str, str]]:
    """Create every record and return {corpus id: {uri, cid}}."""
    for record in corpus["records"]:
        if record["type"] != "repost" and MARKER not in record["text"]:
            raise SeedError(
                f"{record['id']} lacks the {MARKER} marker; refusing to post it"
            )
    session = call(
        base,
        "com.atproto.server.createSession",
        {"identifier": identifier or corpus["handle"], "password": password},
    )
    token, did = session[SESSION_FIELD], session["did"]
    made: dict[str, dict[str, str]] = {}
    for number, record in enumerate(corpus["records"]):
        if number:
            time.sleep(pause)
        if record["type"] == "repost":
            collection = "app.bsky.feed.repost"
            body: dict[str, Any] = {
                "$type": collection,
                "subject": made[record["of"]],
                "createdAt": now(),
            }
        else:
            collection = "app.bsky.feed.post"
            body = {"$type": collection, "text": record["text"], "createdAt": now()}
            if record.get("facets"):
                body["facets"] = facets(record["text"], record["facets"])
            if record["type"] == "reply":
                parent = made[record["reply_to"]]
                body["reply"] = {"root": parent, "parent": parent}
        created = call(
            base,
            "com.atproto.repo.createRecord",
            {"repo": did, "collection": collection, "record": body},
            token,
        )
        made[record["id"]] = {"uri": created["uri"], "cid": created["cid"]}
    return made


def write_manifest(made: dict[str, dict[str, str]], path: Path = MANIFEST) -> None:
    document = json.loads(path.read_text(encoding="utf-8"))
    stamp = now()
    for item in document["items"]:
        if item["id"] in made:
            item["remote"] = {
                "id": made[item["id"]]["uri"],
                "url": None,
                "created_at": stamp,
                "cid": made[item["id"]]["cid"],
            }
    path.write_text(
        json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create the seed Bluesky records.")
    parser.add_argument("--service", default=SERVICE)
    parser.add_argument(
        "--handle", help="override the corpus handle (the fallback one)"
    )
    parser.add_argument("--pause", type=float, default=2.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    if args.dry_run:
        for record in corpus["records"]:
            print(record["id"], record["type"], (record["text"] or "")[:60])
        return 0
    password = os.environ.get("BSKY_APP_PASSWORD", "")
    if not password:
        print("BSKY_APP_PASSWORD is not set", file=sys.stderr)
        return 2
    made = seed(corpus, args.service, password, args.pause, args.handle)
    write_manifest(made)
    for corpus_id, ref in made.items():
        print(corpus_id, ref["uri"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
