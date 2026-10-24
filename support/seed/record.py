"""Record what a real service answers, using Lore's own readers, then scrub it for commit.

    uv run python support/seed/record.py feed CONNECTOR LOCATOR
    uv run python support/seed/record.py hosted granola|notion
    uv run python support/seed/record.py export-shape ZIP
    uv run python support/seed/record.py obsidian
    uv run python support/seed/record.py cli-append CONNECTOR --command TEXT < output

`feed`, `hosted` and `obsidian` write the unscrubbed answers to RAW/<connector>/ (default
~/lore-seed/private/raw, outside the repo) and scrubbed copies plus meta.json to
OUT/<connector>/ (default tests/fixtures/live). `export-shape` prints key names and value
types of a real export and never a value. `cli-append` scrubs one CLI answer read from
stdin and appends it to OUT/<connector>/cli.jsonl.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import patch
from urllib.parse import urlsplit

import anyio
from scrub import Rule, load_rules, scrub

from lore import __version__
from lore.paths import obsidian_home
from lore.sources import Connector, FeedReader, Hosted, HostedReader, Source

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_RAW = Path.home() / "lore-seed" / "private" / "raw"
DEFAULT_OUT = ROOT / "tests" / "fixtures" / "live"
# Enum-like fields whose values, not just types, the shape inventory may show.
VOCABULARY = {"content_type", "role", "sender", "type", "recipient", "channel"}
VOCABULARY_VALUE = re.compile(r"[a-z_][a-z0-9_.-]{0,39}")


class Recording:
    """One connector's session: every answer is kept raw, then scrubbed beside a meta.json."""

    def __init__(
        self, connector: str, locator: str, raw: Path, out: Path, rules: list[Rule]
    ) -> None:
        self.connector = connector
        self.locator = locator
        self.raw = raw / connector
        self.out = out / connector
        self.rules = rules
        self.requests: list[dict[str, Any]] = []
        self.raw.mkdir(parents=True, exist_ok=True)
        self.out.mkdir(parents=True, exist_ok=True)

    def keep(
        self, name: str, body: bytes, target: str, arguments: object = None
    ) -> None:
        """Save one answer under `name`; `target` is the URL or tool it came from."""
        (self.raw / name).write_bytes(body)
        cleaned, hits = scrub(body.decode("utf-8", errors="replace"), self.rules)
        (self.out / name).write_text(cleaned, encoding="utf-8")
        self.requests.append(
            {
                "n": len(self.requests) + 1,
                "url_or_tool": scrub(target, self.rules)[0],
                "arguments": arguments,
                "file": name,
                "sha256_raw": hashlib.sha256(body).hexdigest(),
                "bytes_raw": len(body),
                "scrub_hits": hits,
            }
        )

    def finish(self) -> Path:
        meta = {
            "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "lore_version": __version__,
            "locator": scrub(self.locator, self.rules)[0],
            "requests": self.requests,
        }
        path = self.out / "meta.json"
        path.write_text(
            scrub(json.dumps(meta, indent=2), self.rules)[0] + "\n", encoding="utf-8"
        )
        return path


def extension(body: bytes) -> str:
    head = body.lstrip()[:200].lower()
    if head.startswith((b"{", b"[")):
        return "json"
    if b"<rss" in head or b"<feed" in head or head.startswith(b"<?xml"):
        return "xml"
    return "html"


def slug(url: str) -> str:
    last = urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1]
    stem = last.rsplit(".", 1)[0] if "." in last else last
    return re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-") or "index"


def record_feed(
    connector: str, locator: str, raw: Path, out: Path, rules: list[Rule]
) -> dict[str, int]:
    """Read a feed the way Lore does, saving every page it fetched, and count the result."""
    source = Source.owner(locator, kind="feed", connector=connector)
    reader = source.reader()
    assert isinstance(reader, FeedReader)
    recording = Recording(connector, source.locator, raw, out, rules)
    fetch = FeedReader.fetch

    def tee(self: FeedReader, url: str) -> bytes:
        body = fetch(self, url)
        number = len(recording.requests) + 1
        recording.keep(f"{number:02d}-{slug(url)}.{extension(body)}", body, url)
        return body

    with patch.object(FeedReader, "fetch", tee):
        state = reader.probe()
        items = list(reader.items())
    recording.finish()
    kept = sum(reader.keeps(item) for item in items)
    result = {"found": len(items), "kept": kept, "dropped": len(items) - kept}
    print(json.dumps({"state": state.value, **result}))
    return result


def record_hosted(
    app: str, raw: Path, out: Path, rules: list[Rule], address: str = ""
) -> dict[str, int]:
    """Ask an app's server what it offers and what each page says, saving every answer."""
    connector = Connector.named(app)
    if not isinstance(connector, Hosted):
        raise SystemExit(f"{app} is not a hosted app")
    source = Source.owner(connector.address(address), kind="mcp", connector=app)
    reader = source.reader()
    assert isinstance(reader, HostedReader)
    recording = Recording(app, source.locator, raw, out, rules)
    counts = {"listed": 0, "fetched": 0, "errors": 0}

    async def ask(
        client: Any, tool: str, arguments: dict[str, object]
    ) -> tuple[bool, str]:
        answer = await client.call_tool(tool, arguments)
        text = "\n".join(
            block.text for block in answer.content if getattr(block, "text", None)
        )
        return bool(answer.is_error), text

    def save(stem: str, tool: str, arguments: object, failed: bool, text: str) -> None:
        if failed:
            payload = json.dumps({"is_error": True, "text": text}, indent=2)
            recording.keep(f"{stem}.error.json", payload.encode(), tool, arguments)
            counts["errors"] += 1
            return
        kind = "json" if extension(text.encode()) == "json" else "txt"
        recording.keep(f"{stem}.{kind}", text.encode(), tool, arguments)

    async def work(client: Any) -> None:
        offered = await client.list_tools()
        recording.keep(
            "tools-list.json",
            json.dumps(
                offered.model_dump(mode="json", by_alias=True), indent=2
            ).encode(),
            "list_tools",
        )
        names = {tool.name for tool in offered.tools}
        cursor: str | None = None
        entries = []
        for page in range(reader.pages):
            if page:
                await anyio.sleep(connector.pause)
            arguments = connector.listing(cursor)
            failed, text = await ask(client, connector.lister, arguments)
            save(f"list-{page + 1:02d}", connector.lister, arguments, failed, text)
            if failed:
                break
            found, cursor = connector.entries(text)
            entries += found
            if not cursor:
                break
        counts["listed"] = len(entries)
        for entry in entries:
            arguments = connector.reading(entry.key)
            failed, text = await ask(client, connector.fetcher, arguments)
            key = re.sub(r"[^A-Za-z0-9_-]+", "-", entry.key)
            save(f"fetch-{key}", connector.fetcher, arguments, failed, text)
            counts["fetched"] += 0 if failed else 1
        extras = {
            "get_account_info": "account-info",
            "notion-get-tool-access": "tool-access",
        }
        for tool, stem in extras.items():
            if tool in names:
                failed, text = await ask(client, tool, {})
                save(stem, tool, {}, failed, text)

    reader._run(reader._auth(), work)
    recording.finish()
    print(json.dumps(counts))
    return counts


def shape(
    node: Any, path: str, into: dict[str, set[str]], words: dict[str, set[str]]
) -> None:
    """Add every key path under `node` to `into`, with the value types found there."""
    if isinstance(node, dict):
        into.setdefault(path or ".", set()).add("object")
        for key, value in node.items():
            name = "<id>" if looks_like_id(str(key)) else str(key)
            shape(value, f"{path}.{name}" if path else name, into, words)
        return
    if isinstance(node, list):
        into.setdefault(path or ".", set()).add("array")
        for value in node:
            shape(value, f"{path}[]", into, words)
        return
    kind = "null" if node is None else type(node).__name__
    into.setdefault(path, set()).add(kind)
    last = path.rsplit(".", 1)[-1]
    if (
        last in VOCABULARY
        and isinstance(node, str)
        and VOCABULARY_VALUE.fullmatch(node)
    ):
        words.setdefault(path, set()).add(node)


def looks_like_id(key: str) -> bool:
    return bool(
        re.fullmatch(r"[0-9a-fA-F-]{16,}", key)
        or (len(key) >= 16 and re.search(r"\d", key) and re.fullmatch(r"[\w-]+", key))
    )


def export_shape(archive: Path) -> dict[str, Any]:
    with zipfile.ZipFile(archive) as bundle:
        name = next(
            n for n in bundle.namelist() if n.rsplit("/", 1)[-1] == "conversations.json"
        )
        document = json.loads(bundle.read(name))
    into: dict[str, set[str]] = {}
    words: dict[str, set[str]] = {}
    shape(document, "", into, words)
    return {
        "paths": {path: sorted(kinds) for path, kinds in sorted(into.items())},
        "vocabulary": {path: sorted(seen)[:20] for path, seen in sorted(words.items())},
    }


def record_obsidian(raw: Path, out: Path, rules: list[Rule]) -> None:
    recording = Recording("obsidian", "obsidian.json", raw, out, rules)
    config = obsidian_home() / "obsidian.json"
    if config.is_file():
        recording.keep("obsidian.json", config.read_bytes(), str(config))
    answer = subprocess.run(
        [sys.executable, "-m", "lore", "sources", "choices", "obsidian", "--json"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    recording.keep(
        "choices.json", answer.encode(), "lore sources choices obsidian --json"
    )
    recording.finish()


def append_cli(
    connector: str, command: str, output: str, out: Path, rules: list[Rule]
) -> Path:
    """Add one CLI answer, scrubbed, to the connector's cli.jsonl."""
    text = output.strip()
    try:
        answer: Any = json.loads(text)
    except ValueError:
        answer = text
    line = json.dumps({"command": command, "output": answer}, ensure_ascii=False)
    cleaned, _ = scrub(line, rules)
    path = out / connector / "cli.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(cleaned + "\n")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Record a service and scrub the answers."
    )
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    commands = parser.add_subparsers(dest="command", required=True)
    feed = commands.add_parser("feed")
    feed.add_argument("connector")
    feed.add_argument("locator")
    hosted = commands.add_parser("hosted")
    hosted.add_argument("app", choices=["granola", "notion"])
    hosted.add_argument("--address", default="")
    shaped = commands.add_parser("export-shape")
    shaped.add_argument("archive", type=Path)
    commands.add_parser("obsidian")
    cli = commands.add_parser("cli-append")
    cli.add_argument("connector")
    cli.add_argument("--command", dest="text", required=True)
    args = parser.parse_args(argv)
    rules = load_rules()
    if args.command == "feed":
        record_feed(args.connector, args.locator, args.raw, args.out, rules)
    elif args.command == "hosted":
        record_hosted(args.app, args.raw, args.out, rules, args.address)
    elif args.command == "export-shape":
        print(json.dumps(export_shape(args.archive), indent=2))
    elif args.command == "obsidian":
        record_obsidian(args.raw, args.out, rules)
    else:
        append_cli(args.connector, args.text, sys.stdin.read(), args.out, rules)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
