from __future__ import annotations

import argparse
import json
import math
import shutil
import sys

from .sources import available_sources, scan
from .store import STATUSES, Store
from .ui import ask, confirm, heading, logo, memory_card, muted, success


def parser() -> argparse.ArgumentParser:
    """Build the Lore command-line parser."""
    root = argparse.ArgumentParser(prog="lore", description="Local memory for personal agents")
    commands = root.add_subparsers(dest="command")

    setup = commands.add_parser("setup", help="guided first-time setup")
    setup.add_argument("--yes", action="store_true", help="enable detected sources without prompting")

    sync = commands.add_parser("sync", help="import new and changed memories")
    sync.add_argument("--source", action="append", choices=[s.name for s in available_sources()])

    review = commands.add_parser("review", help="classify or reclassify memories")
    review.add_argument("query", nargs="*", help="words to narrow the review queue")
    review.add_argument("--status", choices=STATUSES, default="pending")
    review.add_argument("--limit", type=int, default=0, help="maximum to review; 0 means all")

    search = commands.add_parser("search", help="search local memories")
    search.add_argument("query", nargs="*", help="words to search for")
    search.add_argument("--status", choices=STATUSES)
    search.add_argument("--limit", type=int, default=20, help="maximum results; 0 means all")
    search.add_argument("--json", action="store_true")

    commands.add_parser("status", help="show source and review status")
    commands.add_parser("help", help="show the Lore workflow manual")
    price = commands.add_parser("price", help="show or set the fixed answer price")
    price.add_argument("amount", nargs="?", type=float, help="USD per answer; use 0 for free")
    serve = commands.add_parser("serve", help="run the Lore MCP server")
    serve.add_argument("--transport", choices=["stdio", "http"], default="stdio")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--token")
    return root


def main(argv: list[str] | None = None) -> int:
    """Parse and run one Lore command."""
    args = parser().parse_args(argv)
    if not args.command:
        if sys.stdin.isatty() and sys.stdout.isatty():
            return dashboard()
        args = parser().parse_args(["status"])
    try:
        if args.command == "setup":
            return setup(args.yes)
        if args.command == "sync":
            return sync(set(args.source) if args.source else None)
        if args.command == "review":
            return review(" ".join(args.query), args.status, args.limit)
        if args.command == "search":
            return search(" ".join(args.query), args.status, args.limit, args.json)
        if args.command == "status":
            return status()
        if args.command == "help":
            return manual()
        if args.command == "price":
            return price(args.amount)
        if args.command == "serve":
            from .mcp import main as serve

            serve_args = ["--transport", args.transport, "--host", args.host, "--port", str(args.port)]
            if args.token:
                serve_args.extend(["--token", args.token])
            return serve(serve_args)
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled.")
        return 130
    except (OSError, ValueError) as error:
        print(f"lore: {error}", file=sys.stderr)
        return 1
    return 0


def dashboard() -> int:
    """Run the small interactive dashboard until the user quits."""
    while True:
        status()
        print("\n  [/] search   [r] review   [s] sync   [q] quit")
        choice = ask("Choose", "/").lower()
        if choice == "q":
            return 0
        if choice == "/":
            query = ask("Search your lore")
            if query:
                search(query, None, 20, False)
        elif choice == "r":
            review("", "pending", 0)
        elif choice == "s":
            sync()


def manual() -> int:
    """Print the short end-user workflow manual."""
    print(
        """Lore workflow

  1. lore setup
     Import native memories and configure automatic synthesis.

  2. lore sync
     Import memories created or changed since setup.

  3. lore review [words] [--status pending|private|external|discarded]
     Mark context private, external, or discarded; revisit any prior decision.

  4. lore search [words] [--status STATUS]
     Inspect the local library without changing disclosure.

  5. lore price [USD]
     Show or set the advertised fixed price per answer.

  6. lore status
     Check imports, pending review, external context, and price.

  7. lore serve
     Start the MCP endpoint used by local agents or a protected gateway.

Use `lore <command> --help` for command-specific options.
"""
    )
    return 0


def setup(yes: bool = False) -> int:
    """Choose native memory sources and perform the first import."""
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
    configure_automation(yes)
    heading("Ready")
    success(f"Imported {total} candidate memories")
    print("Run `lore review` to classify them and `lore search <words>` to recall them.")
    return 0


def sync(names: set[str] | None = None) -> int:
    """Import new and changed memories from configured sources."""
    with Store() as store:
        if names is None:
            configured = set(store.setting("sources", []))
            names = configured | {"automation-codex", "automation-claude"}
        report = scan(store, names)
    for name, item in report.items():
        print(f"{name:<20} {item['added']} added, {item['updated']} updated, {item['unchanged']} unchanged")
    return 0


def review(query: str = "", status_name: str = "pending", limit: int = 0) -> int:
    """Let the owner classify or reclassify a targeted memory queue."""
    if limit < 0:
        raise ValueError("limit cannot be negative")
    logo()
    with Store() as store:
        memories = (
            store.pending()
            if not query and status_name == "pending"
            else store.search(query, status=status_name, limit=limit)
        )
        memories = memories[:limit] if limit else memories
        if not memories:
            success("Nothing waiting for review")
            return 0
        for index, memory in enumerate(memories, 1):
            memory_card(memory, index, len(memories))
            print("\n  [p] private   [e] external   [d] discard   [s] skip   [q] quit")
            while True:
                choice = ask("Choose", "p").lower()
                new_status = {"p": "private", "e": "external", "d": "discarded"}.get(
                    choice
                )
                if new_status:
                    store.set_status(memory.id, new_status)
                    break
                if choice == "s":
                    break
                if choice == "q":
                    return 0
    success("Review complete")
    return 0


def search(query: str, status_name: str | None, limit: int, as_json: bool) -> int:
    """Search local memories and print cards or JSON."""
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
    """Print library, source, database, and pricing status."""
    logo()
    with Store() as store:
        counts = store.counts()
        sources = store.source_counts()
        configured = set(store.setting("sources", []))
        database_path = store.path
        answer_price = store.setting("price_usd", None)
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
    print(f"Answer price: {'not set' if answer_price is None else f'${answer_price:.2f}'}")
    return 0


def price(amount: float | None) -> int:
    """Show or update the configured answer price."""
    with Store() as store:
        if amount is None:
            current = store.setting("price_usd", None)
            print("not set" if current is None else f"${current:.2f} per answer")
            return 0
        if not math.isfinite(amount) or amount < 0:
            raise ValueError("price must be a finite, non-negative number")
        store.set_setting("price_usd", round(amount, 6))
    success("Answers are free" if amount == 0 else f"Answer price set to ${amount:.2f}")
    return 0


def configure_automation(yes: bool) -> None:
    """Configure native synthesis during the main setup flow."""
    from . import automation

    installed = [agent for agent in automation.AGENTS if shutil.which(agent)]
    if not installed or (not yes and not confirm("Set up automatic memory synthesis?")):
        return
    heading("Personal synthesis")
    muted(f"These answers stay in {automation.profile_path().parent}.")
    if yes:
        agents = installed
        models = {agent: "" for agent in agents}
        role, domains, valuable, preferences = "", "", "", ""
        boundaries, cadence, hour = "secrets and third-party private data", "daily", 21
    else:
        role = ask("What kind of work do you do?")
        domains = ask("Which projects or domains matter most right now?")
        valuable = ask("What experience might be unusually valuable to others?")
        preferences = ask("Which working preferences should every agent learn?")
        boundaries = ask(
            "What should Lore never retain?", "secrets and third-party private data"
        )
        agents = [
            agent
            for agent in installed
            if confirm(f"Configure synthesis for {agent.title()}?")
        ]
        if not agents:
            return
        models = {
            agent: ask(f"{agent.title()} model (blank uses its native default)")
            for agent in agents
        }
        cadence = ask("Run daily or weekly?", "daily").lower()
        hour = int(ask("Run at which local hour (0-23)?", "21"))
    profile = {
        "role": role,
        "domains": domains,
        "valuable_context": valuable,
        "preferences": preferences,
        "boundaries": boundaries,
        "agents": agents,
        "models": models,
        "cadence": cadence if cadence in {"daily", "weekly"} else "daily",
        "hour": max(0, min(hour, 23)),
    }
    automation.save_profile(profile)
    for agent in agents:
        automation.run_setup(agent, profile)
        success(f"Configured {agent.title()} native schedule")
