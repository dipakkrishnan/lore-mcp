from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

from . import blueprint as blueprint_module
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

    review = commands.add_parser("review", help="classify or reclassify memories")
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

    payment = commands.add_parser("payment", help="configure how buyers pay for answers")
    payment_commands = payment.add_subparsers(dest="payment_command")
    payment_commands.add_parser("status", help="show which payment settings are configured")
    payment_auth = payment_commands.add_parser(
        "auth", help="store payment credentials; prompts on this terminal with echo off"
    )
    payment_auth.add_argument(
        "--buyer", action="store_true", help="store the test buyer's testnet key instead"
    )
    payment_auth.add_argument(
        "--generate",
        action="store_true",
        help="with --buyer, create a throwaway testnet wallet instead of pasting a key",
    )
    payment_auth.add_argument(
        "--clear", action="store_true", help="delete every stored payment credential"
    )
    payment_payout = payment_commands.add_parser(
        "payout", help="set the address buyers' USDC is paid to"
    )
    payment_payout.add_argument("address", help="an EVM address you control (0x + 40 hex)")
    payment_payout.add_argument(
        "--network", help="base-sepolia (the default) or base; base moves real money"
    )
    payment_test_buy = payment_commands.add_parser(
        "test-buy", help="pay for one answer against a running node, to prove the path"
    )
    payment_test_buy.add_argument("query", nargs="*", help="what to ask the node")
    payment_test_buy.add_argument(
        "--url", default="http://127.0.0.1:8765/mcp", help="the node's MCP endpoint"
    )
    payment_test_buy.add_argument("--token", help="bearer token, if the node requires one")

    serve = commands.add_parser("serve", help="run the Lore MCP server")
    serve.add_argument("--transport", choices=["stdio", "http"], default="stdio")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--token")

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
        if args.command == "payment":
            if args.payment_command == "auth":
                return payment_auth(args.buyer, args.clear, args.generate)
            if args.payment_command == "payout":
                return payment_payout(args.address, args.network)
            if args.payment_command == "test-buy":
                return payment_test_buy(" ".join(args.query), args.url, args.token)
            return payment_status()
        if args.command == "serve":
            from .mcp import main as serve

            serve_args = ["--transport", args.transport, "--host", args.host, "--port", str(args.port)]
            if args.token:
                serve_args.extend(["--token", args.token])
            return serve(serve_args)
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
     Show or set the advertised fixed price per answer. 0 means free, which is a
     perfectly good place to stop.

  6. lore payment status
     See which payment settings are configured. `lore payment payout <address>`
     sets where USDC lands and `lore payment auth` stores the Coinbase
     credentials, prompting on this terminal so no secret reaches an agent.
     `lore payment test-buy <words>` buys one answer to prove the path works.

  7. lore status
     Check imports, the private library, active publications, and price.

  8. lore serve
     Start the MCP endpoint used by local agents or a protected gateway.

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
        problem = _payment_problem(store) if amount else None
    if amount == 0:
        # Free is a first-class end state, not a failure to monetize.
        success("Answers are free")
        return 0
    success(f"Answer price set to ${amount:.2f}")
    if problem:
        # Warn now rather than only at `lore serve`: the gap between setting a price
        # and starting a server is exactly where an owner assumes they are done.
        muted(f"Not chargeable yet: {problem}")
        muted('Run the lore-enable-payments skill — tell your agent "enable payments on Lore".')
    return 0


def _payment_problem(store: Store) -> str | None:
    """Return why this node could not collect a price, if it could not."""
    from .payments import config as payment_config

    return payment_config.resolve(store).missing()


def payment_status() -> int:
    """Report what payment configuration is present — never what any secret is."""
    from .payments import config as payment_config
    from .payments import credentials

    with Store() as store:
        answer_price = store.setting("price_usd", None)
        resolved = payment_config.resolve(store)
    present = credentials.configured()

    heading("Payout")
    print(f"  Address   {resolved.x402_pay_to or 'not set'}")
    print(f"  Network   {resolved.network_name}" + ("  (real money)" if resolved.is_mainnet else ""))
    print(f"  Price     {'not set' if answer_price is None else f'${answer_price:.2f} per answer'}")

    heading("Credentials")
    # Report what the node will actually use, not just what is on disk — the
    # environment overrides the file, and a status that ignores that reads
    # "not configured" next to a node that is charging perfectly well.
    from_environment = {
        credentials.CDP_KEY_ID: bool(os.environ.get("CDP_API_KEY_ID", "").strip()),
        credentials.CDP_KEY_SECRET: bool(os.environ.get("CDP_API_KEY_SECRET", "").strip()),
        credentials.TEST_BUYER_KEY: bool(os.environ.get("LORE_TEST_BUYER_KEY", "").strip()),
    }
    effective = {
        credentials.CDP_KEY_ID: bool(resolved.cdp_api_key_id),
        credentials.CDP_KEY_SECRET: bool(resolved.cdp_api_key_secret),
        credentials.TEST_BUYER_KEY: present.get(credentials.TEST_BUYER_KEY, False)
        or from_environment[credentials.TEST_BUYER_KEY],
    }
    labels = {
        credentials.CDP_KEY_ID: "CDP key id",
        credentials.CDP_KEY_SECRET: "CDP key secret",
        credentials.TEST_BUYER_KEY: "Test buyer key",
    }
    for field, label in labels.items():
        # Values are never printed. Presence and origin are all an owner needs here,
        # and all that is safe to put on a screen someone may be sharing.
        if not effective[field]:
            source = "not configured"
        elif from_environment[field]:
            source = "from the environment"
        else:
            source = "stored"
        print(f"  {'●' if effective[field] else '○'} {label:<16} {source}")
    muted(f"\nStored credentials live in {credentials.path()} (0600), and are never printed.")

    problem = resolved.missing()
    print()
    if answer_price:
        if problem:
            muted(f"This node has a price but cannot collect it: {problem}")
        else:
            success("Ready to charge for answers")
    elif not problem:
        muted("Payment is configured; `lore price <USD>` starts charging.")
    else:
        muted("Answers are free. That is a supported place to stop.")
    return 0


def payment_auth(buyer: bool = False, clear: bool = False, generate: bool = False) -> int:
    """Capture payment secrets from this terminal, with echo off.

    This prompt is the only interactive path for a payment secret. No agent, skill,
    or command argument ever carries one — a secret pasted into an agent session
    lands in transcripts under ``~/.claude/projects/``, the very files synthesis
    later reads.
    """
    import getpass

    from .payments import credentials

    if clear:
        removed = credentials.clear()
        success("Removed stored payment credentials" if removed else "No credentials were stored")
        return 0

    if generate and not buyer:
        raise ValueError("--generate only applies to --buyer; Lore never creates a payout wallet")

    if buyer and generate:
        # The test buyer is a throwaway that holds faucet money for one transaction.
        # Making one here beats teaching someone to export a private key out of a
        # real wallet, which is a habit worth not starting.
        try:
            from eth_account import Account
        except ImportError:
            raise ValueError(
                "the payments extra is not installed — reinstall with "
                "`uv pip install 'lore-mcp[payments]'`"
            )
        account = Account.create()
        credentials.save(test_buyer_key=account.key.hex())
        success(f"Created a throwaway test wallet: {account.address}")
        muted("Its key is stored locally and never printed.")
        muted("Fund that address with Base Sepolia USDC from a testnet faucet, then run")
        muted("`lore payment test-buy <words>`. Never send real funds to this address.")
        return 0

    if buyer:
        muted("Paste the private key of a testnet wallet you control. Input stays hidden.")
        muted("Use a throwaway wallet funded from a faucet — never your payout wallet.")
        muted("No wallet to hand? `lore payment auth --buyer --generate` makes one.")
        key = getpass.getpass("Test buyer private key: ")
        credentials.save(test_buyer_key=key)
        success(f"Stored the test buyer key in {credentials.path()}")
        return 0

    muted("Paste your Coinbase Developer Platform x402 API key. Input stays hidden.")
    key_id = getpass.getpass("CDP API key id: ")
    key_secret = getpass.getpass("CDP API key secret: ")
    credentials.save(cdp_api_key_id=key_id, cdp_api_key_secret=key_secret)
    # The id is not a secret, so echoing it lets the owner catch a bad paste. The
    # secret is never echoed, in whole or in part.
    success(f"Stored credentials for key id {key_id.strip()} in {credentials.path()}")
    return 0


def payment_payout(address: str, network: str | None = None) -> int:
    """Validate and persist the address buyers' USDC is paid to."""
    from .payments import config as payment_config

    address = payment_config.normalize_pay_to(address)
    with Store() as store:
        store.set_setting(payment_config.PAY_TO_SETTING, address)
        if network is not None:
            resolved = payment_config.normalize_network(network)
            store.set_setting(payment_config.NETWORK_SETTING, resolved)
        else:
            resolved = str(
                store.setting(payment_config.NETWORK_SETTING, payment_config.DEFAULT_NETWORK)
            )
    name = payment_config.NETWORK_NAMES.get(resolved, resolved)
    success(f"Payouts go to {address} on {name}")
    if resolved == payment_config.BASE_MAINNET:
        muted("This is mainnet: payments settle in real USDC to that address.")
    else:
        muted("This is a test network: nothing here moves real money.")
    muted("Lore never holds, custodies, or can recover these funds.")
    return 0


def payment_test_buy(query: str, url: str, token: str | None = None) -> int:
    """Buy one answer from a running node, proving the whole path before mainnet."""
    from .payments import config as payment_config
    from .payments import credentials

    query = query.strip()
    if not query:
        raise ValueError("say what to ask, e.g. `lore payment test-buy what do you know about me`")

    with Store() as store:
        answer_price = store.setting("price_usd", None)
        resolved = payment_config.resolve(store)
        # Titles of everything this query would return. If any of them shows up in
        # the challenge, the gate is disclosing content it has not been paid for.
        watch_for = [p.title for p in store.search_publications(query, limit=10)]
    if not answer_price:
        raise ValueError("this node is free — set a price with `lore price <USD>` first")
    problem = resolved.missing()
    if problem:
        raise ValueError(problem)

    key = os.environ.get("LORE_TEST_BUYER_KEY", "").strip() or credentials.load().get(
        credentials.TEST_BUYER_KEY, ""
    )
    if not key:
        raise ValueError(
            "no test buyer key configured — run `lore payment auth --buyer`, using a "
            "throwaway testnet wallet funded from a Base Sepolia USDC faucet"
        )

    try:
        from .payments.buyer import test_buy
    except ImportError:
        raise ValueError(
            "the payments extra is not installed — reinstall with "
            "`uv pip install 'lore-mcp[payments]'`"
        )

    heading("Test purchase")
    muted(f"Asking {url} for {query!r} at ${float(answer_price):.2f} on {resolved.network_name}")
    report = test_buy(url, query, key, resolved, token=token, watch_for=watch_for)

    success(f"Paid from {report['buyer']} and settled")
    print(f"  Paid to      {report['pay_to']}")
    print(f"  Network      {report['network_name']}")
    print(f"  Transaction  {report['transaction'] or 'not reported'}")
    success("The unpaid challenge disclosed no publication content")
    if not resolved.is_mainnet:
        muted("\nThat was a test network. Nothing above moved real money.")
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
