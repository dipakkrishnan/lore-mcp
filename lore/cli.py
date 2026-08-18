from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Annotated

from pydantic import Field, TypeAdapter

from . import blueprint as blueprint_module
from . import capture as capture_module
from . import deploy as deploy_module
from .paths import home
from .sources import available_sources, scan
from .store import STATUSES, AnswerSettings, Publication, PublicationInput, Store
from .ui import (
    ask,
    confirm,
    heading,
    logo,
    memory_card,
    muted,
    publication_card,
    success,
    warn,
)

PUBLICATION_CANDIDATES: TypeAdapter[list[PublicationInput]] = TypeAdapter(
    Annotated[list[PublicationInput], Field(min_length=1)]
)


def parser() -> argparse.ArgumentParser:
    """Build the Lore command-line parser."""
    root = argparse.ArgumentParser(
        prog="lore", description="Local memory for personal agents"
    )
    commands = root.add_subparsers(dest="command")

    setup = commands.add_parser("setup", help="guided first-time setup")
    setup.add_argument(
        "--yes", action="store_true", help="enable detected sources without prompting"
    )

    sync = commands.add_parser("sync", help="import new and changed memories")
    sync.add_argument(
        "--source", action="append", choices=[s.name for s in available_sources()]
    )

    review = commands.add_parser("review", help="keep or discard memories")
    review.add_argument("query", nargs="*", help="words to narrow the review queue")
    review.add_argument("--status", choices=STATUSES, default="private")
    review.add_argument(
        "--limit", type=int, default=0, help="maximum to review; 0 means all"
    )
    review.add_argument(
        "--all",
        choices=STATUSES,
        default=None,
        help="apply this status to every match in one command, non-interactively",
    )

    search = commands.add_parser("search", help="search local memories")
    search.add_argument("query", nargs="*", help="words to search for")
    search.add_argument("--status", choices=STATUSES)
    search.add_argument(
        "--limit", type=int, default=20, help="maximum results; 0 means all"
    )
    search.add_argument("--json", action="store_true")

    profile = commands.add_parser(
        "profile", help="save an agent-written synthesis profile"
    )
    profile.add_argument("path", help="JSON profile file; use - for stdin")
    profile.add_argument(
        "--no-schedule",
        action="store_true",
        help="write the profile without installing schedules",
    )

    capture = commands.add_parser(
        "capture", help="save owner-approved private memories"
    )
    capture_commands = capture.add_subparsers(dest="capture_command", required=True)
    capture_apply = capture_commands.add_parser(
        "apply", help="validate and save structured memory entries as private"
    )
    capture_apply.add_argument(
        "file", help="JSON array written by an agent; use - for stdin"
    )

    commands.add_parser("status", help="show source and review status")
    commands.add_parser("help", help="show the Lore workflow manual")
    price = commands.add_parser("price", help="show or set the per-publication price")
    price.add_argument(
        "amount", nargs="?", type=float, help="USD per publication; use 0 for free"
    )
    answer = commands.add_parser(
        "answer", help="configure the paid answer tier (persona, price, on/off)"
    )
    answer_commands = answer.add_subparsers(dest="answer_command")
    answer_price_parser = answer_commands.add_parser(
        "price", help="set the per-answer price (distinct from the publication price)"
    )
    answer_price_parser.add_argument(
        "amount", nargs="?", type=float, help="USD per answer; must be positive"
    )
    answer_persona_parser = answer_commands.add_parser(
        "persona", help="review and approve the public persona preamble from a file"
    )
    answer_persona_parser.add_argument("file", help="text file holding the persona")
    answer_commands.add_parser(
        "on", help="enable the answer tier (needs an approved persona and a price)"
    )
    answer_commands.add_parser("off", help="disable the answer tier")
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
        "--wallet",
        help="public payout address (0x + 40 hex) set as the node's LORE_WALLET",
    )

    publication = commands.add_parser(
        "publication", help="approve, list, and revoke external publications"
    )
    publication_commands = publication.add_subparsers(dest="publication_command")
    publication_review = publication_commands.add_parser(
        "review", help="review drafted candidates and approve each interactively"
    )
    publication_review.add_argument("file", help="JSON file of drafted candidates")
    publication_commands.add_parser("list", help="show active and revoked publications")
    publication_revoke = publication_commands.add_parser(
        "revoke", help="immediately remove a publication from MCP retrieval"
    )
    publication_revoke.add_argument("id", type=int)
    publication_reapprove = publication_commands.add_parser(
        "reapprove", help="keep a publication whose source memory changed"
    )
    publication_reapprove.add_argument("id", type=int)

    push = commands.add_parser(
        "push", help="replace the deployed node's publications with the active set"
    )
    push.add_argument(
        "--worker-dir",
        default=str(home() / "node"),
        help="the node source directory (default: the one `lore node deploy` stages)",
    )
    push.add_argument(
        "--local", action="store_true", help="push to the local dev database instead"
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
            return review(" ".join(args.query), args.status, args.limit, args.all)
        if args.command == "search":
            return search(" ".join(args.query), args.status, args.limit, args.json)
        if args.command == "profile":
            return profile(args.path, not args.no_schedule)
        if args.command == "capture":
            return capture_apply(args.file)
        if args.command == "status":
            return status()
        if args.command == "help":
            return manual()
        if args.command == "price":
            return price(args.amount)
        if args.command == "answer":
            if args.answer_command == "price":
                return answer_price(args.amount)
            if args.answer_command == "persona":
                return answer_persona(args.file)
            if args.answer_command == "on":
                return answer_toggle(True)
            if args.answer_command == "off":
                return answer_toggle(False)
            return answer_show()
        if args.command == "serve":
            from .mcp import main as serve

            serve_args = [
                "--transport",
                args.transport,
                "--host",
                args.host,
                "--port",
                str(args.port),
            ]
            if args.token:
                serve_args.extend(["--token", args.token])
            return serve(serve_args)
        if args.command == "node":
            if args.node_command == "deploy":
                return deploy_module.deploy(args.wallet)
        if args.command == "publication":
            if args.publication_command == "review":
                return publication_apply(args.file)
            if args.publication_command == "revoke":
                return publication_revoke(args.id)
            if args.publication_command == "reapprove":
                return publication_reapprove(args.id)
            return publication_list()
        if args.command == "push":
            return push(args.worker_dir, local=args.local)
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

  3. lore capture apply <file|->
     Validate and privately save memories approved in an attended agent session.

  4. lore review [words] [--status private|discarded] [--all private|discarded]
     Walk the private library and keep or discard; revisit any prior decision.
     --all applies one status to every match in one command, no prompting.
     Reviewing never discloses anything — only a publication does that.

  5. lore search [words] [--status STATUS]
     Inspect the local library without changing disclosure.

  6. lore price [USD]
     Show or set the advertised price per publication.

  6b. lore answer [price <USD> | persona <file> | on | off]
     Configure the paid answer tier: approve the public persona, set the
     per-answer price, and switch it on. Ships on the next `lore push`.

  7. lore status
     Check imports, the private library, active publications, and price.

  8. lore serve
     Start the MCP endpoint used by local agents or a protected gateway.

  9. lore node deploy
     Deploy your node to your own Cloudflare account (source ships with Lore;
     the URL lands in `lore status`).

  10. lore blueprint show
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
    muted(
        "Lore imports only agent-generated memory files. Session transcripts stay untouched."
    )
    native = [source for source in available_sources() if source.origin == "native"]
    enabled: list[str] = []
    heading("Detected agents")
    for source in native:
        count = len(source.files())
        state = (
            f"{count} memory file{'s' if count != 1 else ''}"
            if source.root.exists()
            else "not found"
        )
        print(f"  {source.label:<14} {state}")
        if source.root.exists() and (
            yes or confirm(f"Import {source.label} memories?")
        ):
            enabled.append(source.name)
    with Store() as store:
        store.set_setting("sources", enabled)
        report = scan(store, set(enabled))
    total = sum(item["added"] + item["updated"] for item in report.values())
    heading("Ready")
    success(f"Imported {total} candidate memories")
    print('Next, tell Claude or Codex: "Onboard me to Lore."')
    return 0


def _configured_sources(value: object) -> set[str]:
    """Validate source names recovered from the JSON settings boundary."""
    if not isinstance(value, list) or not all(isinstance(name, str) for name in value):
        raise ValueError("configured sources must be a list of names")
    return set(value)


def sync(names: set[str] | None = None) -> int:
    """Import new and changed memories from configured sources."""
    with Store() as store:
        if names is None:
            configured = _configured_sources(store.setting("sources", []))
            names = configured | {"automation"}
        report = scan(store, names)
    for name, item in report.items():
        print(
            f"{name:<20} {item['added']} added, {item['updated']} updated, {item['unchanged']} unchanged"
        )
    return 0


def capture_apply(file: str) -> int:
    """Validate and save memories the owner corrected in an attended agent session."""
    text = sys.stdin.read() if file == "-" else Path(file).read_text(encoding="utf-8")
    results = capture_module.save(json.loads(text))
    print(json.dumps(results, indent=2))
    return 0


def review(
    query: str = "",
    status_name: str = "private",
    limit: int = 0,
    all_status: str | None = None,
) -> int:
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
        if all_status:
            changed = store.set_status_many([m.id for m in memories], all_status)
            success(f"Marked {changed} memories as {all_status}")
            return 0
        for index, memory in enumerate(memories, 1):
            memory_card(memory, index, len(memories))
            print("\n  [k] keep private   [d] discard   [s] skip   [q] quit")
            print("  [K] keep all remaining private   [D] discard all remaining")
            while True:
                raw = ask("Choose", "k")
                if raw in ("K", "D"):
                    remaining_status = "private" if raw == "K" else "discarded"
                    remaining_ids = [m.id for m in memories[index - 1 :]]
                    changed = store.set_status_many(remaining_ids, remaining_status)
                    success(f"Marked {changed} memories as {remaining_status}")
                    return 0
                choice = raw.lower()
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
        configured = _configured_sources(store.setting("sources", []))
        database_path = store.path
        publication_price = store.setting("price_usd", None)
        answer_settings = store.answer_settings()
        node_url = store.setting("node_url", None)
        revocation_pending = store.setting("revocation_pending", False)
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
    print(
        f"Publication price: {'not set' if publication_price is None else f'${publication_price:.2f}'}"
    )
    print(
        "Answer tier: "
        + (
            f"enabled (${answer_settings.answer_price_usd:.2f} per answer)"
            if answer_settings.answer_enabled
            else "disabled"
        )
    )
    if node_url:
        # A cache of remote truth, not local truth like the price: another
        # machine or the Cloudflare dashboard can move the node after this.
        print(f"Node (last deploy): {node_url}")
    if revocation_pending:
        print(
            "A revocation has NOT reached the deployed node — it still serves "
            "the old set. Run: lore push"
        )
    return 0


def price(amount: float | None) -> int:
    """Show or update the configured per-publication price."""
    with Store() as store:
        if amount is None:
            current = store.setting("price_usd", None)
            print("not set" if current is None else f"${current:.2f} per publication")
            return 0
        if not math.isfinite(amount) or amount < 0:
            raise ValueError("price must be a finite, non-negative number")
        store.set_setting("price_usd", round(amount, 6))
        node_url = store.setting("node_url", None)
    success(
        "Publications are free"
        if amount == 0
        else f"Publication price set to ${amount:.2f}"
    )
    if node_url:
        # The deployed Worker charges the price baked in at deploy time; a
        # saved setting proves nothing about what the live node charges.
        muted(
            "Your deployed node still charges its old price until `lore node deploy` reruns."
        )
    return 0


def answer_show() -> int:
    with Store() as store:
        settings = store.answer_settings()
    print(f"Answer tier: {'enabled' if settings.answer_enabled else 'disabled'}")
    print(
        "Answer price: "
        + (
            "not set"
            if settings.answer_price_usd <= 0
            else f"${settings.answer_price_usd:.2f} per answer"
        )
    )
    print(
        f"Persona: {'approved' if settings.persona_preamble.strip() else 'not approved'}"
    )
    if settings.answer_enabled:
        muted("The deployed node picks up changes on the next `lore push`.")
    return 0


def answer_price(amount: float | None) -> int:
    with Store() as store:
        if amount is None:
            current = store.answer_settings().answer_price_usd
            print("not set" if current <= 0 else f"${current:.2f} per answer")
            return 0
        if not math.isfinite(amount) or amount <= 0:
            raise ValueError(
                "the answer price must be a positive number — an answer runs a "
                "model loop the node pays for, so free answers lose money"
            )
        store.set_setting("answer_price_usd", round(amount, 6))
    success(f"Answer price set to ${amount:.2f}")
    muted(
        "Each answer costs real model inference; check the node's per-answer "
        "cost telemetry stays below this price. Ship it with `lore push`."
    )
    return 0


def answer_persona(path: str) -> int:
    if not _interactive():
        raise ValueError(
            "persona approval needs an attended interactive terminal; "
            "piped and background approval is disabled"
        )
    text = Path(path).read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("the persona file is empty; nothing to approve")
    heading("Public persona preamble")
    print(text)
    muted(
        "\nThis text is public: it ships to your node and frames every paid "
        "answer. It is separate from your private blueprint."
    )
    if not confirm("Approve this persona for the deployed node?"):
        print("Not approved; nothing saved.")
        return 0
    with Store() as store:
        store.set_setting("persona_preamble", text)
    success("Persona approved")
    muted("Ship it with `lore push`.")
    return 0


def answer_toggle(enabled: bool) -> int:
    with Store() as store:
        if enabled:
            settings = store.answer_settings()
            if not settings.persona_preamble.strip():
                raise ValueError(
                    "no approved persona; run `lore answer persona <file>` first"
                )
            if settings.answer_price_usd <= 0:
                raise ValueError("no answer price; run `lore answer price <USD>` first")
        store.set_setting("answer_enabled", enabled)
    success(f"Answer tier {'enabled' if enabled else 'disabled'}")
    muted("The deployed node picks up the change on the next `lore push`.")
    return 0


def profile(path: str, schedule: bool = True) -> int:
    """Save a profile written by an onboarding agent and install its schedule."""
    from . import automation

    text = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    data = json.loads(text)
    data = automation.save_profile(data)
    success(f"Saved profile to {automation.profile_path()}")
    if not schedule:
        muted("Existing schedules still use their previously installed prompt.")
        return 0
    try:
        executor = automation.Agent(str(data.get("executor", "")))
        automation.install(data)
    except (OSError, ValueError) as error:
        # The profile is already on disk, so a bare traceback here would read as a
        # total failure and leave the owner with no way to finish the install. Widened
        # to ValueError too: windup raises it far more often than OSError (a bad
        # cadence, hour, or missing prompt file are all ValueErrors), and a bad
        # "executor" value raises before install() is ever called.
        warn(automation.schedule_failure(str(data.get("executor", "")), error))
        return 1
    success(f"Configured {str(executor).title()} local schedule")
    return 0


def _interactive() -> bool:
    """Whether approval is running in an attended interactive terminal."""
    return sys.stdin.isatty() and sys.stdout.isatty()


def _candidate(raw: object, missing_check: Store) -> Publication:
    """Validate one drafted candidate into a previewable Publication."""
    candidate = PublicationInput.model_validate(raw)
    if not candidate.teaser:
        # The teaser is the entire free surface for this publication, so approval
        # without one would advertise nothing — draft it question-shaped: what the
        # publication answers, never the lesson itself.
        raise ValueError("candidates need a non-empty teaser (the free advertisement)")
    missing = missing_check.missing_memories(candidate.provenance)
    if missing:
        raise ValueError(f"candidate provenance references unknown memories: {missing}")
    return Publication(
        id=0,
        title=candidate.title,
        content=candidate.content,
        kind=candidate.kind,
        topic=candidate.topic,
        teaser=candidate.teaser,
        provenance=candidate.provenance,
        active=1,
        created_at="",
        updated_at="",
    )


def publication_apply(path: str) -> int:
    """Review drafted candidates with the owner; save only what they approve."""
    if not _interactive():
        raise ValueError(
            "publication approval needs an attended interactive terminal; "
            "piped and background approval is disabled"
        )
    data = PUBLICATION_CANDIDATES.validate_json(Path(path).read_text(encoding="utf-8"))
    logo()
    with Store() as store:
        candidates = [_candidate(raw, store) for raw in data]
        approved = 0
        for index, candidate in enumerate(candidates, 1):
            while True:
                publication_card(candidate, index, len(candidates))
                print("\n  [a] approve   [e] edit   [r] reject   [q] quit")
                choice = ask("Choose", "r").lower()
                if choice == "a":
                    store.add_publication(
                        title=candidate.title,
                        content=candidate.content,
                        kind=candidate.kind,
                        topic=candidate.topic,
                        teaser=candidate.teaser,
                        provenance=candidate.provenance,
                    )
                    approved += 1
                    break
                if choice == "e":
                    title = ask("Title (enter keeps current)") or candidate.title
                    teaser = ask("Teaser (enter keeps current)") or candidate.teaser
                    content = ask("Content (enter keeps current)") or candidate.content
                    candidate = candidate.model_copy(
                        update={
                            "title": title.strip(),
                            "teaser": teaser.strip(),
                            "content": content.strip(),
                        }
                    )
                    continue
                if choice == "q":
                    success(
                        f"Approved {approved} publication{'s' if approved != 1 else ''}"
                    )
                    return 0
                break  # reject: save nothing, move on
    success(f"Approved {approved} publication{'s' if approved != 1 else ''}")
    if approved:
        muted(
            "These are now answerable over MCP. Revoke any time: lore publication revoke <id>"
        )
    return 0


def publication_list() -> int:
    """Show every publication and its disclosure state."""
    with Store() as store:
        publications = store.list_publications()
    if not publications:
        print("No publications. Draft some with the lore-publish skill.")
        return 0
    for publication in publications:
        publication_card(publication)
        print(f"  id {publication.id}")
    return 0


def publication_revoke(publication_id: int) -> int:
    """Immediately remove a publication from external retrieval.

    "Immediately" includes the deployed node (MON-004): revocation is a push,
    not a wait. A failed push is recorded so `lore status` keeps saying the
    edge is stale until a push lands — never silently dropped.
    """
    with Store() as store:
        store.revoke_publication(publication_id)
        node_url = store.setting("node_url", None)
    success(f"Revoked publication {publication_id}; it is no longer answerable")
    if not node_url:
        return 0
    try:
        return push(str(home() / "node"))
    except (OSError, ValueError) as error:
        with Store() as store:
            store.set_setting("revocation_pending", True)
        raise ValueError(
            "revoked locally, but the deployed node still serves the old set "
            f"({error}) — run `lore push` to finish; `lore status` will remind you"
        ) from error


def _push_sql(publications: list[Publication], answer: AnswerSettings) -> str:
    """Render the full-replace SQL for the edge database.

    Full replace, not diffing: the active set is small, the operation is
    idempotent, and a revoked publication is guaranteed gone because nothing
    that isn't in this script survives it. Owner-shipped state only: the
    Worker's own tables (answer tickets and answers) are buyer state and are
    never touched here.
    """

    def quote(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    statements = [
        # Full replace includes the schema: DROP+CREATE so a node deployed
        # before the current columns existed converges on the current shape.
        # The local integer id never leaves this machine — the edge is keyed
        # on the opaque public_id, so revocations leave no visible gap.
        "DROP TABLE IF EXISTS publications;",
        "CREATE TABLE publications ("
        "public_id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, "
        "kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', "
        "teaser TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');",
    ]
    statements.extend(
        f"INSERT INTO publications(public_id,title,content,kind,topic,teaser,updated_at) VALUES "
        f"({quote(p.public_id)},{quote(p.title)},{quote(p.content)},{quote(p.kind.value)},"
        f"{quote(p.topic)},{quote(p.teaser)},{quote(p.updated_at)});"
        for p in publications
    )
    settings = {
        "persona_preamble": answer.persona_preamble,
        "answer_price_usd": f"{answer.answer_price_usd:.6f}",
        "answer_enabled": "true" if answer.answer_enabled else "false",
    }
    statements.extend(
        [
            "DROP TABLE IF EXISTS node_settings;",
            "CREATE TABLE node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            *(
                f"INSERT INTO node_settings(key,value) VALUES ({quote(key)},{quote(value)});"
                for key, value in settings.items()
            ),
        ]
    )
    return "\n".join(statements) + "\n"


def push(worker_dir: str, local: bool = False) -> int:
    """Replace the deployed node's publications with the local active set."""
    import subprocess
    import tempfile

    worker = Path(worker_dir)
    if not (worker / "wrangler.jsonc").is_file():
        raise ValueError(
            f"no node source at {worker}/ — run `lore node deploy` first, "
            "or pass --worker-dir (contributors: --worker-dir lore/node)"
        )
    with Store() as store:
        active = store.list_publications(active_only=True)
        answer_settings = store.answer_settings()
    script = _push_sql(active, answer_settings)
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as handle:
        handle.write(script)
        script_path = handle.name
    target = ["--local"] if local else ["--remote"]
    result = subprocess.run(
        [
            "npx",
            "wrangler",
            "d1",
            "execute",
            "lore-publications",
            *target,
            "--file",
            script_path,
            "-y",
        ],
        cwd=worker,
    )
    os.unlink(script_path)
    if result.returncode != 0:
        raise ValueError(
            "wrangler could not write the edge database — check `npx wrangler login` "
            "and that `lore-publications` exists (npx wrangler d1 create lore-publications)"
        )
    if not local:
        # A remote push is a full replace, so whatever revocation was pending
        # is now guaranteed gone from the edge.
        with Store() as store:
            store.set_setting("revocation_pending", False)
    where = "local dev database" if local else "deployed node"
    success(
        f"Pushed {len(active)} active publication{'s' if len(active) != 1 else ''} to the {where}"
    )
    if not active:
        muted("The node now serves nothing. That is a valid state, not an error.")
    return 0


def publication_reapprove(publication_id: int) -> int:
    """Keep a publication as-is after its source memory changed."""
    with Store() as store:
        store.clear_publication_flag(publication_id)
    success(f"Re-approved publication {publication_id} as published")
    return 0


def blueprint_apply(file: str) -> int:
    """Validate and persist a blueprint file written by the onboarding skill."""
    blueprint_module.apply(Path(file))
    success("Lore blueprint captured")
    print(
        f"Run `lore blueprint show` to see your lore map, at {blueprint_module.lore_map_path()}"
    )
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
