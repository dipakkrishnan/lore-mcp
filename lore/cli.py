from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from . import blueprint as blueprint_module
from . import capture as capture_module
from . import deploy as deploy_module
from .paths import home
from .sources import available_sources, scan
from .store import (
    JOB_FINAL_STATUSES,
    JOB_KINDS,
    JOB_SUMMARIES,
    STATUSES,
    AnswerSettings,
    JobKind,
    Publication,
    PublicationInput,
    Store,
)
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


class PublicationDecision(BaseModel):
    """One approval card answered in the Lore desktop app."""

    model_config = ConfigDict(extra="forbid")

    candidate: PublicationInput
    original: PublicationInput | None = None
    approve: bool


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
    # Set by the synthesis schedule's pre-run hook, which is the only place a
    # scheduled run can be observed starting. See `sync()`.
    sync.add_argument(
        "--record-job",
        action="store_true",
        help="open a synthesis job row for the scheduled run about to start",
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

    memory = commands.add_parser("memory", help="read one memory")
    memory_commands = memory.add_subparsers(dest="memory_command", required=True)
    memory_show = memory_commands.add_parser("show", help="print one memory in full")
    memory_show.add_argument("id", type=int)
    memory_show.add_argument("--json", action="store_true")
    memory_rename = memory_commands.add_parser("rename", help="rename a memory")
    memory_rename.add_argument("id", type=int)
    memory_rename.add_argument("title")
    memory_rename.add_argument("--json", action="store_true")
    memory_edit = memory_commands.add_parser("edit", help="edit a memory's content")
    memory_edit.add_argument("id", type=int)
    memory_edit.add_argument(
        "content",
        nargs="?",
        default=None,
        help="new content; omit and pass --stdin to read from stdin",
    )
    memory_edit.add_argument(
        "--stdin",
        action="store_true",
        help="read content from stdin instead of the positional argument",
    )
    memory_edit.add_argument("--json", action="store_true")

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

    # Owner-run history. Machine-first: these are called by the desktop app and
    # by the synthesis LaunchAgent's pre-run hook, never read by a human, so
    # they print compact JSON or nothing at all.
    job = commands.add_parser("job", help="record owner-run history")
    job_commands = job.add_subparsers(dest="job_command", required=True)
    job_start = job_commands.add_parser("start", help="open a running job row")
    job_start.add_argument("kind", choices=JOB_KINDS)
    job_start.add_argument(
        "--pid", type=int, help="the process that owes this row a close"
    )
    job_start.add_argument(
        "--timeout-minutes", type=int, help="concede the row as incomplete after this"
    )
    job_finish = job_commands.add_parser("finish", help="close a job row")
    job_finish.add_argument("id", type=int)
    job_finish.add_argument("status", choices=JOB_FINAL_STATUSES)
    # `choices` is the outermost of three guards on the summary vocabulary: it
    # rejects free text at the process boundary, before any Python runs, so an
    # error message can never be interpolated into owner history from a shell.
    job_finish.add_argument("--summary", choices=tuple(JOB_SUMMARIES), default="")
    job_finish.add_argument("--count", type=int)
    job_finish.add_argument("--cost-usd", type=float)
    job_commands.add_parser("reap", help="concede jobs whose liveness claim expired")
    job_commands.add_parser("list", help="print recent owner jobs as JSON")

    commands.add_parser("status", help="show source and review status")
    commands.add_parser("desktop-state", help="print the desktop app state as JSON")
    commands.add_parser("help", help="show the Lore workflow manual")
    price = commands.add_parser("price", help="show or set the per-publication price")
    price.add_argument(
        "amount", nargs="?", type=float, help="USD per publication; use 0 for free"
    )
    answer = commands.add_parser(
        "answer", help="enable or disable the paid answer tier"
    )
    answer_commands = answer.add_subparsers(dest="answer_command", required=True)
    answer_on = answer_commands.add_parser(
        "on", help="approve a proxy charter, set a price, and enable"
    )
    answer_on.add_argument("file", help="text file holding the public proxy charter")
    answer_on.add_argument("price", type=float, help="USD per answer; must be positive")
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
    node_deploy.add_argument(
        "--network",
        choices=tuple(deploy_module.NETWORKS),
        help="switch the node to real money or back to the test network",
    )
    node_commands.add_parser("login", help="sign in to Cloudflare through your browser")
    node_sales = node_commands.add_parser("sales", help="what your node has sold")
    node_sales.add_argument(
        "--json", action="store_true", help="print the sales as JSON"
    )
    node_secret = node_commands.add_parser(
        "secret",
        help="vault a Coinbase credential on the node; the value is read from stdin",
    )
    node_secret.add_argument("name", choices=deploy_module.SECRETS)

    publication = commands.add_parser(
        "publication", help="approve, list, and revoke external publications"
    )
    publication_commands = publication.add_subparsers(dest="publication_command")
    publication_review = publication_commands.add_parser(
        "review", help="review drafted candidates and approve each interactively"
    )
    publication_review.add_argument("file", help="JSON file of drafted candidates")
    publication_draft = publication_commands.add_parser(
        "draft", help="validate drafted candidates and stage them for approval"
    )
    publication_draft.add_argument(
        "file", help="JSON array of candidates; use - for stdin"
    )
    publication_commands.add_parser(
        "candidates", help="print the staged candidates as JSON"
    )
    publication_commands.add_parser(
        "decide", help="apply one approval card from the Lore desktop app (stdin)"
    )
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
    blueprint_apply.add_argument(
        "file", help="path to a blueprint JSON file; use - for stdin"
    )
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
            return sync(
                set(args.source) if args.source else None,
                record_job=args.record_job,
            )
        if args.command == "job":
            return job(args)
        if args.command == "review":
            return review(" ".join(args.query), args.status, args.limit, args.all)
        if args.command == "search":
            return search(" ".join(args.query), args.status, args.limit, args.json)
        if args.command == "memory":
            if args.memory_command == "rename":
                return rename_memory(args.id, args.title, args.json)
            if args.memory_command == "edit":
                return edit_memory(args.id, args.content, args.json, args.stdin)
            return show_memory(args.id, args.json)
        if args.command == "profile":
            return profile(args.path, not args.no_schedule)
        if args.command == "capture":
            return capture_apply(args.file)
        if args.command == "status":
            return status()
        if args.command == "desktop-state":
            from .snapshot import build

            print(json.dumps(build(), separators=(",", ":"), allow_nan=False))
            return 0
        if args.command == "help":
            return manual()
        if args.command == "price":
            return price(args.amount)
        if args.command == "answer":
            if args.answer_command == "on":
                return answer_enable(args.file, args.price)
            return answer_disable()
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
                return deploy_module.deploy(args.wallet, args.network)
            if args.node_command == "secret":
                _owner_action("storing a node secret")
                return deploy_module.secret(args.name, sys.stdin.read().strip())
            if args.node_command == "login":
                return deploy_module.login()
            if args.node_command == "sales":
                return sales(args.json)
        if args.command == "publication":
            if args.publication_command == "review":
                return publication_apply(args.file)
            if args.publication_command == "draft":
                return publication_draft(args.file)
            if args.publication_command == "candidates":
                return publication_candidates()
            if args.publication_command == "decide":
                return publication_decide()
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

  6b. lore answer on <proxy-file> <price> | off
     Enable the paid answer tier or switch it off. Ships on the next `lore push`.

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


def sync(names: set[str] | None = None, *, record_job: bool = False) -> int:
    """Import new and changed memories from configured sources.

    This also carries both ends of the scheduled-synthesis record, because they
    are the only two moments of that run Lore is present for. `--record-job`
    marks the pre-run hook the scheduler itself executes, so the *start* is
    observed rather than inferred. A later `--source automation` — the tail the
    synthesis prompt instructs — closes that row. Nothing reports a failure, so
    a run that dies is conceded as `incomplete` by its deadline; it is never
    quietly recorded as a success.
    """
    with Store() as store:
        if record_job:
            # No pid can own this row: the runner script execs away into the
            # agent, so the process that will finish the work is unknowable
            # here. The deadline is the only liveness claim available.
            store.start_job(JobKind.SYNTHESIS.value, timeout_minutes=60)
        if names is None:
            configured = _configured_sources(store.setting("sources", []))
            names = configured | {"automation"}
        report = scan(store, names)
        if names == {"automation"} and not record_job:
            imported = sum(item["added"] + item["updated"] for item in report.values())
            # A no-op when nothing is open, so a hand-run `lore sync --source
            # automation` cannot invent a scheduled run that never happened.
            store.close_open_job(
                JobKind.SYNTHESIS.value,
                "succeeded",
                summary="synthesized",
                count=imported,
            )
    for name, item in report.items():
        print(
            f"{name:<20} {item['added']} added, {item['updated']} updated, {item['unchanged']} unchanged"
        )
    return 0


def job(args: argparse.Namespace) -> int:
    """Record owner-run history.

    Deliberately not behind `_owner_action`: this writes nothing disclosable
    and reads no memory content, and its two most important callers — the
    synthesis LaunchAgent's pre-run hook and the desktop app — are both
    structurally unattended. Its whole input surface is a closed vocabulary of
    kinds, statuses, and summary codes plus two numbers, so an unattended
    caller's worst case is a wrong row in the owner's own local history.
    """
    with Store() as store:
        if args.job_command == "start":
            job_id = store.start_job(
                args.kind, owner_pid=args.pid, timeout_minutes=args.timeout_minutes
            )
            print(json.dumps({"id": job_id}, separators=(",", ":")))
            return 0
        if args.job_command == "finish":
            store.finish_job(
                args.id,
                args.status,
                summary=args.summary,
                count=args.count,
                cost_usd=args.cost_usd,
            )
            return 0
        if args.job_command == "reap":
            print(json.dumps({"reaped": store.reap_jobs()}, separators=(",", ":")))
            return 0
        print(
            json.dumps(
                [item.model_dump(mode="json") for item in store.recent_jobs()],
                separators=(",", ":"),
                allow_nan=False,
            )
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


def show_memory(memory_id: int, as_json: bool) -> int:
    """Print one memory as a card or JSON."""
    with Store() as store:
        memory = store.get(memory_id)
    if memory is None:
        raise ValueError(f"memory not found: {memory_id}")
    if as_json:
        print(json.dumps(memory.__dict__, indent=2))
    else:
        memory_card(memory)
    return 0


def rename_memory(memory_id: int, title: str, as_json: bool) -> int:
    """Rename a memory and print the result as a card or JSON."""
    with Store() as store:
        store.set_title(memory_id, title)
        memory = store.get(memory_id)
    if memory is None:
        raise ValueError(f"memory not found: {memory_id}")
    if as_json:
        print(json.dumps(memory.__dict__, indent=2))
    else:
        memory_card(memory)
    return 0


def edit_memory(
    memory_id: int, content: str | None, as_json: bool, from_stdin: bool = False
) -> int:
    """Edit a memory's content and print the result as a card or JSON.

    `content` is the new content directly. Pass `--stdin` instead of a
    positional `content` to read multi-line content from a terminal pipe —
    content is never treated as a stdin sentinel itself, so a memory whose
    content is literally `-` round-trips correctly. That distinction matters
    because the desktop app always forwards content as a direct argument, and
    a magic value would silently misfire for that one piece of content.
    """
    if from_stdin:
        text = sys.stdin.read()
    elif content is not None:
        text = content
    else:
        raise ValueError("content is required unless --stdin is given")
    with Store() as store:
        store.set_content(memory_id, text)
        memory = store.get(memory_id)
    if memory is None:
        raise ValueError(f"memory not found: {memory_id}")
    if as_json:
        print(json.dumps(memory.__dict__, indent=2))
    else:
        memory_card(memory)
    return 0


def sales(as_json: bool) -> int:
    rows = deploy_module.sales()
    if as_json:
        print(deploy_module.SALES.dump_json(rows).decode())
        return 0
    if not rows:
        muted("No sales yet.")
        return 0
    total = sum(row.price_usd for row in rows)
    heading(f"{len(rows)} sale{'s' if len(rows) != 1 else ''} · ${total:.2f}")
    for row in rows:
        print(f"  {row.sold_at[:10]}  ${row.price_usd:.2f}  {row.title}")
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


def answer_enable(path: str, price: float) -> int:
    if not _interactive():
        raise ValueError(
            "proxy approval needs an attended interactive terminal; "
            "piped and background approval is disabled"
        )
    if not math.isfinite(price) or price <= 0:
        raise ValueError("the answer price must be a positive number")
    text = Path(path).read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("the proxy file is empty; nothing to approve")
    heading("Public proxy charter")
    print(text)
    muted(
        "\nThis text is public: it ships to your node and frames every paid "
        "answer. It is separate from your private blueprint."
    )
    if not confirm("Approve this proxy charter for the deployed node?"):
        print("Not approved; nothing saved.")
        return 0
    with Store() as store:
        store.set_answer_settings(
            AnswerSettings(
                proxy_preamble=text,
                answer_price_usd=round(price, 6),
                answer_enabled=True,
            )
        )
    success(f"Answer tier enabled at ${price:.2f} per answer")
    muted("Ship it with `lore push`.")
    return 0


def answer_disable() -> int:
    with Store() as store:
        store.set_setting("answer_enabled", False)
    success("Answer tier disabled")
    muted("The deployed node picks up the change on the next `lore push`.")
    return 0


def profile(path: str, schedule: bool = True) -> int:
    """Save a profile written by an onboarding agent and install its schedule."""
    from . import automation

    schedule = schedule and os.environ.get("LORE_SKIP_SCHEDULE") != "1"
    text = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    data = json.loads(text)
    data = automation.save_profile(data)
    success(f"Saved profile to {automation.profile_path()}")
    if not schedule:
        muted("Existing schedules were not changed.")
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


def _attended() -> bool:
    """Whether the Lore desktop app, the other attended surface, is piping a decision."""
    return (
        os.environ.get("LORE_ATTENDED_SURFACE") == "desktop" and not sys.stdin.isatty()
    )


def _desktop_decision(what: str) -> str:
    """Read one owner decision from the desktop app; refuse every other pipe."""
    if not _attended():
        raise ValueError(
            f"{what} on stdin is accepted only from the Lore desktop app; "
            "piped and background approval is disabled"
        )
    return sys.stdin.read()


def _owner_action(what: str) -> None:
    """Owner actions run from a terminal or the desktop app, never a pipe."""
    if not (_interactive() or _attended()):
        raise ValueError(
            f"{what} needs an attended terminal or the Lore desktop app; "
            "piped and background use is disabled"
        )


def _candidates_path() -> Path:
    return home() / "publish-candidates.json"


def _validated_candidates(text: str) -> list[PublicationInput]:
    """Validate a drafted batch the way review does, provenance included."""
    candidates = PUBLICATION_CANDIDATES.validate_json(text)
    with Store() as store:
        for candidate in candidates:
            _candidate(candidate, store)
    return candidates


def _staged() -> list[PublicationInput]:
    path = _candidates_path()
    if not path.is_file():
        return []
    return _validated_candidates(path.read_text(encoding="utf-8"))


def _stage(candidates: list[PublicationInput]) -> None:
    path = _candidates_path()
    if candidates:
        path.write_bytes(PUBLICATION_CANDIDATES.dump_json(candidates, indent=2))
        path.chmod(0o600)
    else:
        path.unlink(missing_ok=True)


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


def publication_draft(file: str) -> int:
    """Validate agent-drafted candidates and stage them for the owner's approval."""
    text = sys.stdin.read() if file == "-" else Path(file).read_text(encoding="utf-8")
    candidates = _validated_candidates(text)
    _stage(candidates)
    success(
        f"Drafted {len(candidates)} candidate{'s' if len(candidates) != 1 else ''} "
        "for the owner to approve"
    )
    return 0


def publication_candidates() -> int:
    """Print the staged candidates, exactly as the approval cards will show them."""
    print(json.dumps([candidate.model_dump(mode="json") for candidate in _staged()]))
    return 0


def publication_decide() -> int:
    """Apply one approval card the owner answered in the Lore desktop app."""
    decision = PublicationDecision.model_validate_json(
        _desktop_decision("publication approval")
    )
    staged = _staged()
    original = decision.original or decision.candidate
    dumped = original.model_dump()
    for _index, candidate in enumerate(staged):
        if candidate.model_dump() == dumped:
            break
    else:
        raise ValueError("that candidate is not drafted; nothing saved")
    for field in ("kind", "topic", "provenance"):
        if getattr(decision.candidate, field) != getattr(original, field):
            raise ValueError("only a draft's title, teaser, and content can be edited")
    if decision.approve:
        with Store() as store:
            approved = _candidate(decision.candidate, store)
            store.add_publication(
                title=approved.title,
                teaser=approved.teaser,
                content=approved.content,
                kind=approved.kind,
                topic=approved.topic,
                provenance=approved.provenance,
            )
    del staged[_index]
    _stage(staged)
    print(json.dumps({"approved": decision.approve, "remaining": len(staged)}))
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
    _owner_action("revoking a publication")
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
        "proxy_preamble": answer.proxy_preamble,
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
    _owner_action("pushing publications")
    worker = Path(worker_dir)
    if not (worker / "wrangler.jsonc").is_file():
        raise ValueError(
            f"no node source at {worker}/ — run `lore node deploy` first, "
            "or pass --worker-dir (contributors: --worker-dir lore/node)"
        )
    # Recorded past the preconditions, so a missing node source stays a message
    # rather than a run. One seam covers every caller: the desktop button, a
    # terminal, and the deploy sequence's own push.
    with Store() as store:
        job_id = store.start_job(
            JobKind.PUSH.value, owner_pid=os.getpid(), timeout_minutes=60
        )
    try:
        return _push(worker, local, job_id)
    except BaseException:
        with Store() as store:
            store.finish_job(job_id, "failed", summary="failed")
        raise


def _push(worker: Path, local: bool, job_id: int) -> int:
    """Write the active publication set to the node's edge database."""
    import subprocess
    import tempfile

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
        # The cause names commands and a database, which owner history must not
        # carry — it goes to the terminal, while the row keeps only the code.
        with Store() as store:
            store.finish_job(job_id, "failed", summary="edge_write_failed")
        raise ValueError(
            "wrangler could not write the edge database — check `npx wrangler login` "
            "and that `lore-publications` exists (npx wrangler d1 create lore-publications)"
        )
    if not local:
        # A remote push is a full replace, so whatever revocation was pending
        # is now guaranteed gone from the edge.
        with Store() as store:
            store.set_setting("revocation_pending", False)
        from .snapshot import forget_live  # local import, as desktop-state does

        forget_live()
    with Store() as store:
        store.finish_job(job_id, "succeeded", summary="pushed", count=len(active))
    where = "local dev database" if local else "deployed node"
    success(
        f"Pushed {len(active)} active publication{'s' if len(active) != 1 else ''} to the {where}"
    )
    if not active:
        muted("The node now serves nothing. That is a valid state, not an error.")
    return 0


def publication_reapprove(publication_id: int) -> int:
    """Keep a publication as-is after its source memory changed."""
    _owner_action("re-approving a publication")
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
