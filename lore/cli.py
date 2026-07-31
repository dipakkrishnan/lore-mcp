from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from . import blueprint as blueprint_module
from . import deploy as deploy_module
from .paths import home
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

    review = commands.add_parser("review", help="keep or discard memories")
    review.add_argument("query", nargs="*", help="words to narrow the review queue")
    review.add_argument("--status", choices=STATUSES, default="private")
    review.add_argument("--limit", type=int, default=0, help="maximum to review; 0 means all")

    search = commands.add_parser("search", help="search local memories")
    search.add_argument("query", nargs="*", help="words to search for")
    search.add_argument("--status", choices=STATUSES)
    search.add_argument("--limit", type=int, default=20, help="maximum results; 0 means all")
    search.add_argument("--json", action="store_true")

    profile = commands.add_parser("profile", help="save an agent-written synthesis profile")
    profile.add_argument("path", help="JSON profile file; use - for stdin")
    profile.add_argument("--no-schedule", action="store_true", help="write the profile without installing schedules")

    commands.add_parser("status", help="show source and review status")
    commands.add_parser("help", help="show the Lore workflow manual")
    price = commands.add_parser("price", help="show or set the fixed answer price")
    price.add_argument("amount", nargs="?", type=float, help="USD per answer; use 0 for free")
    serve = commands.add_parser("serve", help="run the Lore MCP server")
    serve.add_argument("--transport", choices=["stdio", "http"], default="stdio")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--token")

    node = commands.add_parser("node", help="deploy and manage your hosted Lore node")
    node_commands = node.add_subparsers(dest="node_command", required=True)
    node_deploy = node_commands.add_parser(
        "deploy", help="deploy the node Worker to your own Cloudflare account"
    )
    node_deploy.add_argument(
        "--wallet", help="public payout address (0x + 40 hex) set as the node's LORE_WALLET"
    )

    blueprint = commands.add_parser("blueprint", help="capture the shape of your lore")
    blueprint_commands = blueprint.add_subparsers(dest="blueprint_command")
    blueprint_apply = blueprint_commands.add_parser(
        "apply", help="validate and persist a blueprint file"
    )
    blueprint_apply.add_argument("file", help="path to a blueprint JSON file")
    blueprint_commands.add_parser("show", help="show the current lore map")
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
        if args.command == "profile":
            return profile(args.path, not args.no_schedule)
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
        if args.command == "node":
            return deploy_module.deploy(args.wallet)
        if args.command == "blueprint":
            if args.blueprint_command == "apply":
                return blueprint_apply(args.file)
            return blueprint_show()
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
            review("", "private", 0)
        elif choice == "s":
            sync()


def manual() -> int:
    """Print the short end-user workflow manual."""
    print(
        """Lore workflow

  1. lore setup
     Import native memories, then continue with the lore-onboard agent skill.

  2. lore sync
     Import memories created or changed since setup.

  3. lore review [words] [--status private|discarded]
     Walk the private library and keep or discard; revisit any prior decision.
     Reviewing never discloses anything — only a publication does that.

  4. lore search [words] [--status STATUS]
     Inspect the local library without changing disclosure.

  5. lore price [USD]
     Show or set the advertised fixed price per answer.

  6. lore status
     Check imports, the private library, active publications, and price.

  7. lore serve
     Start the MCP endpoint used by local agents or a protected gateway.

  8. lore node deploy
     Deploy your node to your own Cloudflare account (source ships with Lore;
     the URL lands in `lore status`).

  9. lore blueprint show
     See the shape of your lore captured by the gamified onboarding skill
     (run `lore blueprint apply <file>` from that skill to update it).

Use `lore <command> --help` for command-specific options.
"""
    )
    return 0


def setup(yes: bool = False) -> int:
    """Choose native memory sources and perform the first import."""
    logo()
    automation_dir = home() / "automation"
    automation_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    automation_dir.chmod(0o700)
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
    print('Next, tell Claude or Codex: "Onboard me to Lore."')
    return 0


def sync(names: set[str] | None = None) -> int:
    """Import new and changed memories from configured sources."""
    with Store() as store:
        if names is None:
            configured = set(store.setting("sources", []))
            names = configured | {"automation"}
        report = scan(store, names)
    for name, item in report.items():
        print(f"{name:<20} {item['added']} added, {item['updated']} updated, {item['unchanged']} unchanged")
    return 0


def review(query: str = "", status_name: str = "private", limit: int = 0) -> int:
    """Let the owner revisit a targeted memory queue.

    Imports are private on arrival, so review is a retention pass over the
    private library rather than a disclosure queue. Nothing here can publish:
    disclosure happens only through an owner-approved publication.
    """
    if limit < 0:
        raise ValueError("limit cannot be negative")
    logo()
    with Store() as store:
        memories = store.search(query, status=status_name, limit=limit)
        memories = memories[:limit] if limit else memories
        if not memories:
            success(f"No {status_name} memories to review")
            return 0
        for index, memory in enumerate(memories, 1):
            memory_card(memory, index, len(memories))
            print("\n  [k] keep private   [d] discard   [s] skip   [q] quit")
            while True:
                choice = ask("Choose", "k").lower()
                # No disclosure choice here by design: review is retention only.
                new_status = {"k": "private", "p": "private", "d": "discarded"}.get(
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
        node_url = store.setting("node_url", None)
        published = len(store.list_publications(active_only=True))
        stale = len(store.stale_publications())
    heading("Library")
    print(
        f"  {counts['private']} private · {counts['discarded']} discarded · "
        f"{published} active publication{'' if published == 1 else 's'} (externally usable)"
    )
    if stale:
        muted(
            f"  {stale} {'derives' if stale == 1 else 'of them derive'} from a memory "
            "that changed since you approved it. Re-approve or revoke."
        )
    heading("Sources")
    for source in available_sources():
        if source.origin == "automation":
            continue
        enabled = source.name in configured
        marker = "●" if enabled else "○"
        print(f"  {marker} {source.label:<14} {sources.get(source.name, 0)} imported")
    print(f"\nDatabase: {database_path}")
    print(f"Answer price: {'not set' if answer_price is None else f'${answer_price:.2f}'}")
    if node_url:
        # A cache of remote truth, not local truth like the price: another
        # machine or the Cloudflare dashboard can move the node after this.
        print(f"Node (last deploy): {node_url}")
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


def profile(path: str, schedule: bool = True) -> int:
    """Save a profile written by an onboarding agent and install its schedule."""
    from . import automation

    text = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("profile must be a JSON object")
    data = automation.save_profile(data)
    success(f"Saved profile to {automation.profile_path()}")
    if not schedule:
        muted("Existing schedules still use their previously installed prompt.")
        return 0
    automation.install(data)
    success(f"Configured {str(data['executor']).title()} local schedule")
    return 0


def blueprint_apply(file: str) -> int:
    """Validate and persist a blueprint file written by the onboarding skill."""
    blueprint_module.apply(file)
    success("Lore blueprint captured")
    print(f"Run `lore blueprint show` to see your lore map, at {blueprint_module.lore_map_path()}")
    return 0


def blueprint_show() -> int:
    """Print the current lore map, or the raw blueprint, or a first-run nudge."""
    map_path = blueprint_module.lore_map_path()
    if map_path.exists():
        print(map_path.read_text(encoding="utf-8"))
        return 0
    current = blueprint_module.load_blueprint()
    if current is not None:
        print(json.dumps(current, indent=2))
        return 0
    print("No blueprint yet. Run the lore-onboard skill inside Claude or Codex.")
    return 0
