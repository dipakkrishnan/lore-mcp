from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

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

    review = commands.add_parser("review", help="review pending memories")
    review.add_argument("--limit", type=int, default=0)

    search = commands.add_parser("search", help="search local memories")
    search.add_argument("query", nargs="*", help="words to search for")
    search.add_argument("--status", choices=STATUSES)
    search.add_argument("--limit", type=int, default=20)
    search.add_argument("--json", action="store_true")

    commands.add_parser("status", help="show source and review status")
    price = commands.add_parser("price", help="show or set the fixed answer price")
    price.add_argument("amount", nargs="?", type=float, help="USD per answer; use 0 for free")
    automate = commands.add_parser("automate", help="agent-assisted memory synthesis")
    automate_commands = automate.add_subparsers(dest="automate_command")
    automate_setup = automate_commands.add_parser("setup", help="create a personal synthesis profile")
    automate_setup.add_argument("--yes", action="store_true", help="accept safe defaults")
    automate_commands.add_parser("show", help="show generated prompts")
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
            return review(args.limit)
        if args.command == "search":
            return search(" ".join(args.query), args.status, args.limit, args.json)
        if args.command == "status":
            return status()
        if args.command == "price":
            return price(args.amount)
        if args.command == "automate":
            return automate(args)
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
        print("\n  [/] search   [r] review   [s] sync   [a] automation   [q] quit")
        choice = ask("Choose", "/").lower()
        if choice == "q":
            return 0
        if choice == "/":
            query = ask("Search your lore")
            if query:
                search(query, None, 20, False)
        elif choice == "r":
            review(0)
        elif choice == "s":
            sync()
        elif choice == "a":
            from .automation import profile_path

            automate(parser().parse_args(["automate", "show" if profile_path().exists() else "setup"]))


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


def review(limit: int = 0) -> int:
    """Let the owner classify pending memories."""
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
        if amount < 0:
            raise ValueError("price cannot be negative")
        store.set_setting("price_usd", round(amount, 6))
    success("Answers are free" if amount == 0 else f"Answer price set to ${amount:.2f}")
    return 0


def automate(args: argparse.Namespace) -> int:
    """Configure native memory synthesis or show its generated prompts."""
    from . import automation

    command = args.automate_command or "show"
    if command == "setup":
        logo()
        heading("Personal synthesis")
        muted(
            f"These answers guide what your agents preserve. "
            f"They stay in {automation.profile_path().parent}."
        )
        if args.yes:
            agents = list(automation.AGENTS)
            models = {agent: "" for agent in agents}
            role, domains, valuable, preferences, boundaries = "", "", "", "", "secrets and third-party private data"
            cadence, hour = "daily", 21
        else:
            role = ask("What kind of work do you do?")
            domains = ask("Which projects or domains matter most right now?")
            valuable = ask("What experience might be unusually valuable to others?")
            preferences = ask("Which working preferences should every agent learn?")
            boundaries = ask("What should Lore never retain?", "secrets and third-party private data")
            agents = [
                agent
                for agent in automation.AGENTS
                if confirm(f"Create a native scheduling prompt for {agent.title()}?")
            ]
            models = {
                agent: ask(f"{agent.title()} model (blank uses its native default)")
                for agent in agents
            }
            cadence = ask("Run daily or weekly?", "daily").lower()
            hour = int(ask("Run at which local hour (0-23)?", "21"))
        if not agents:
            raise ValueError("no agents selected")
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
            automation.launch_setup(agent, profile)
            success(f"Opened {agent.title()} native setup")
        print("Review and send each prefilled request; the native agents create the schedules.")
        return 0
    profile = automation.load_profile()
    for agent in profile.get("agents", []):
        path = automation.profile_path().parent / f"{agent}-prompt.md"
        heading(str(agent).title())
        print(path.read_text(encoding="utf-8"))
        muted("Native setup request")
        print(automation.setup_prompt(str(agent), profile))
    return 0
