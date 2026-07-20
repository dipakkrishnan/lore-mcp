from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .sources import available_sources, scan
from .store import STATUSES, Store
from .ui import ask, confirm, heading, logo, memory_card, muted, success


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="lore", description="Local memory for personal agents")
    commands = root.add_subparsers(dest="command")

    setup = commands.add_parser("setup", help="guided first-time setup")
    setup.add_argument("--yes", action="store_true", help="enable detected sources without prompting")

    sync = commands.add_parser("sync", help="import new and changed memories")
    sync.add_argument("--source", action="append", choices=[s.name for s in available_sources()])

    review = commands.add_parser("review", help="review pending memories")
    review.add_argument("--limit", type=int, default=0)

    search = commands.add_parser("search", help="search local memories")
    search.add_argument("query", nargs="*", help="words to search for")
    search.add_argument("--status", choices=STATUSES)
    search.add_argument("--limit", type=int, default=20)
    search.add_argument("--json", action="store_true")

    commands.add_parser("status", help="show source and review status")
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if not args.command:
        args = parser().parse_args(["status"])
    try:
        if args.command == "setup":
            return setup(args.yes)
        if args.command == "sync":
            return sync(set(args.source) if args.source else None)
        if args.command == "review":
            return review(args.limit)
        if args.command == "search":
            return search(" ".join(args.query), args.status, args.limit, args.json)
        if args.command == "status":
            return status()
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled.")
        return 130
    except (OSError, ValueError) as error:
        print(f"lore: {error}", file=sys.stderr)
        return 1
    return 0


def setup(yes: bool = False) -> int:
    logo()
    muted("Lore imports only agent-generated memory files. Session transcripts stay untouched.")
    native = [source for source in available_sources() if source.origin == "native"]
    enabled: list[str] = []
    heading("Detected agents")
    for source in native:
        count = len(source.files())
        state = f"{count} memory file{'s' if count != 1 else ''}" if source.root.exists() else "not found"
        print(f"  {source.label:<14} {state}")
        if source.root.exists() and (yes or confirm(f"Import {source.label} memories?")):
            enabled.append(source.name)
    with Store() as store:
        store.set_setting("sources", enabled)
        report = scan(store, set(enabled))
    total = sum(item["added"] + item["updated"] for item in report.values())
    heading("Ready")
    success(f"Imported {total} candidate memories")
    print("Run `lore review` to classify them and `lore search <words>` to recall them.")
    return 0


def sync(names: set[str] | None = None) -> int:
    with Store() as store:
        if names is None:
            configured = set(store.setting("sources", []))
            names = configured | {"automation-codex", "automation-claude"}
        report = scan(store, names)
    for name, item in report.items():
        print(f"{name:<20} {item['added']} added, {item['updated']} updated, {item['unchanged']} unchanged")
    return 0


def review(limit: int = 0) -> int:
    logo()
    with Store() as store:
        memories = store.pending()
        if limit:
            memories = memories[:limit]
        if not memories:
            success("Nothing waiting for review")
            return 0
        for index, memory in enumerate(memories, 1):
            memory_card(memory, index, len(memories))
            print("\n  [k] keep private   [e] allow external answers   [d] discard   [s] skip   [q] quit")
            while True:
                choice = ask("Choose", "k").lower()
                status_name = {"k": "private", "e": "external", "d": "discarded"}.get(choice)
                if status_name:
                    store.set_status(memory.id, status_name)
                    break
                if choice == "s":
                    break
                if choice == "q":
                    return 0
    success("Review complete")
    return 0


def search(query: str, status_name: str | None, limit: int, as_json: bool) -> int:
    with Store() as store:
        memories = store.search(query, status=status_name, limit=limit)
    if as_json:
        print(json.dumps([memory.__dict__ for memory in memories], indent=2))
        return 0
    if not memories:
        print("No matching memories.")
        return 0
    for memory in memories:
        memory_card(memory)
    return 0


def status() -> int:
    logo()
    with Store() as store:
        counts = store.counts()
        sources = store.source_counts()
        configured = set(store.setting("sources", []))
        database_path = store.path
    heading("Library")
    print(f"  {sum(counts.values())} memories · {counts['pending']} awaiting review · {counts['external']} externally usable")
    heading("Sources")
    for source in available_sources():
        if source.origin == "automation":
            continue
        enabled = source.name in configured
        marker = "●" if enabled else "○"
        print(f"  {marker} {source.label:<14} {sources.get(source.name, 0)} imported")
    print(f"\nDatabase: {database_path}")
    return 0
