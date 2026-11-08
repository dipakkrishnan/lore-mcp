from __future__ import annotations

import json
import time
import urllib.request
from dataclasses import dataclass
from http.client import HTTPResponse
from itertools import islice
from pathlib import Path
from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict, TypeAdapter

from . import automation, blueprint, deploy, feedback, hosted, sources
from .paths import claude_home, home
from .store import (
    FREE_COPIES,
    FREE_COPIES_SETTING,
    JOB_SUMMARIES,
    Collection,
    OwnerJob,
    Store,
)


class ManifestEntry(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    id: str


class Manifest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    manifest_version: Literal[1]
    topics: dict[str, list[ManifestEntry]]
    network: str | None = None
    # What the node actually charges, baked in at deploy time. Optional: a node
    # deployed before `discover` advertised it answers without one, and the app
    # must say nothing about the live price rather than guess.
    price_usd: float | None = None
    payout: str | None = None


OBJECT = TypeAdapter(dict[str, Any])


def _post(
    url: str, message: dict[str, object], session: str | None = None
) -> HTTPResponse:
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "User-Agent": "Lore/0.1",
    }
    if session:
        headers["Mcp-Session-Id"] = session
    request = urllib.request.Request(
        url, data=json.dumps(message).encode(), headers=headers, method="POST"
    )
    return cast(HTTPResponse, urllib.request.urlopen(request, timeout=5))


def _response(response: HTTPResponse) -> dict[str, Any]:
    text = response.read().decode()
    if response.headers.get_content_type() == "text/event-stream":
        data_line = next(
            (
                line.removeprefix("data: ")
                for line in text.splitlines()
                if line.startswith("data: ")
            ),
            None,
        )
        if data_line is None:
            raise ValueError("event-stream response had no data line")
        text = data_line
    return OBJECT.validate_json(text)


def remote_manifest(url: str) -> Manifest:
    initialize = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "lore-desktop", "version": "0.1"},
        },
    }
    with _post(url, initialize) as response:
        _response(response)
        session = response.headers.get("Mcp-Session-Id")
    if not session:
        raise ValueError("node returned no MCP session")
    with _post(
        url, {"jsonrpc": "2.0", "method": "notifications/initialized"}, session
    ) as response:
        response.read()
    call = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {"name": "discover", "arguments": {}},
    }
    with _post(url, call, session) as response:
        result = _response(response)
    text = result["result"]["content"][0]["text"]
    manifest = json.loads(text)
    return Manifest.model_validate(manifest)


def _live_state(node_url: str | None) -> tuple[dict[str, object], set[str] | None]:
    if not node_url:
        return {
            "state": "not_configured",
            "network": None,
            "price_usd": None,
            "payout": None,
        }, None
    try:
        manifest = remote_manifest(node_url)
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        return {
            "state": "unreachable",
            "network": None,
            "price_usd": None,
            "payout": None,
        }, None
    ids = {entry.id for entries in manifest.topics.values() for entry in entries}
    live: dict[str, object] = {
        "state": "online",
        "network": manifest.network,
        "price_usd": manifest.price_usd,
        "payout": manifest.payout,
    }
    return live, ids


LIVE_CACHE_SECONDS = 60


LiveState = tuple[dict[str, object], set[str] | None]


def fresh_live(cached: object, node_url: str, now: float) -> LiveState | None:
    """What a kept probe answer still says about `node_url` at `now`, or nothing
    when it is for another address, too old, or not a probe answer at all (XC-105)."""
    if not (
        isinstance(cached, dict)
        and cached.get("url") == node_url
        and now - float(cached.get("checked_at", 0)) < LIVE_CACHE_SECONDS
    ):
        return None
    ids = cached.get("ids")
    live = dict(cached["live"])
    # A cache written before this field existed is still fresh enough to
    # trust for liveness; it just has nothing to say about the price.
    live.setdefault("price_usd", None)
    return live, set(ids) if isinstance(ids, list) else None


def _cached_live_state(node_url: str | None) -> LiveState:
    """The probe is three round trips at up to 5 s each and runs on every
    desktop refresh, so its answer is kept briefly; `forget_live` drops it
    when a push changes what the node holds."""
    if not node_url:
        return _live_state(node_url)
    with Store() as store:
        cached = store.setting("node_live", None)
    now = time.time()
    kept = fresh_live(cached, node_url, now)
    if kept is not None:
        return kept
    live, ids = _live_state(node_url)
    with Store() as store:
        store.set_setting(
            "node_live",
            {
                "url": node_url,
                "checked_at": now,
                "live": live,
                "ids": sorted(ids) if ids is not None else None,
            },
        )
    return live, ids


def forget_live() -> None:
    """Drop the cached probe so the next snapshot asks the node again."""
    with Store() as store:
        store.set_setting("node_live", None)


def _session_cwd(path: Path) -> str | None:
    with path.open(encoding="utf-8", errors="replace") as lines:
        for line in islice(lines, 40):
            try:
                record = json.loads(line)
            except ValueError:
                continue
            cwd = record.get("cwd") if isinstance(record, dict) else None
            if isinstance(cwd, str) and cwd:
                return cwd
    return None


def _claude_project_labels() -> dict[str, str]:
    labels: dict[str, str] = {}
    projects = claude_home() / "projects"
    if not projects.is_dir():
        return labels
    # A folder Lore hasn't been let into yet labels nothing; it never stops the snapshot.
    try:
        for slug in projects.iterdir():
            for session in slug.glob("*.jsonl"):
                cwd = _session_cwd(session)
                if cwd:
                    labels[slug.name] = Path(cwd).name
                    break
    except OSError:
        pass
    return labels


@dataclass(frozen=True)
class Rows:
    """What one snapshot reads from the store, as plain data (XC-105)."""

    sources_configured: bool
    sources: list[dict[str, object]]
    # Memory inventory rows with their provenance applied, internal fields still on.
    memories: list[dict[str, object]]
    # Publication inventory rows, their `active` flag still on.
    publications: list[dict[str, object]]
    collections: list[Collection]
    # As stored: a number, or anything else an older store left there.
    publication_price: object
    answer_price: object
    answer_enabled: bool
    free_copies: object
    telemetry_enabled: bool
    telemetry_noticed: bool
    automations_noticed: bool
    node_url: str | None
    node_selling: bool
    agents_url: str | None
    jobs: list[OwnerJob]


@dataclass(frozen=True)
class Surroundings:
    """What one snapshot reads from the file system and this build, as plain data."""

    home: str
    # The Claude Code project slug of a folder under the owner's home starts
    # with this; it is dropped when no session labels the slug.
    slug_prefix: str
    project_labels: dict[str, str]
    blueprint_configured: bool
    profile_configured: bool
    schedule: object
    feedback_available: bool
    store_state: Literal["current", "outdated", "unknown"]


def _rows(store: Store) -> Rows:
    """Read the snapshot's rows from the store, deciding nothing."""
    missing = object()
    registry = sources.Registry(store)
    node_url = store.setting("node_url", None)
    return Rows(
        sources_configured=store.setting("sources", missing) is not missing,
        sources=registry.entries(),
        memories=registry.provenance(store.memory_inventory()),
        publications=store.publication_inventory(),
        collections=store.collections(),
        publication_price=store.setting("price_usd", None),
        answer_price=store.setting("answer_price_usd", 0.0),
        answer_enabled=store.setting("answer_enabled", False) is True,
        free_copies=store.setting(FREE_COPIES_SETTING, FREE_COPIES),
        telemetry_enabled=store.setting("telemetry_enabled", True) is not False,
        telemetry_noticed=store.setting("telemetry_noticed", False) is True,
        automations_noticed=store.setting(automation.NOTICED, False) is True,
        node_url=node_url if isinstance(node_url, str) else None,
        node_selling=deploy.selling(store),
        agents_url=hosted.agent_address(store),
        # Reading concedes jobs whose liveness claim expired, so an interrupted
        # run turns visibly incomplete on the next refresh without a scheduler.
        jobs=store.recent_jobs(limit=20),
    )


def _surroundings(node_url: str | None) -> Surroundings:
    """Read what the snapshot says about this Mac and this build."""
    return Surroundings(
        home=str(home()),
        slug_prefix="-" + str(Path.home()).strip("/").replace("/", "-") + "-",
        project_labels=_claude_project_labels(),
        blueprint_configured=blueprint.blueprint_path().is_file(),
        profile_configured=automation.profile_path().is_file(),
        schedule=automation.schedule_state(),
        # Whether this build can send feedback at all. The Desktop app hides
        # its Report Feedback button when it cannot, so a release with no
        # relay pinned shows no Send it could not honor (XC-028).
        feedback_available=feedback.available(),
        # Whether the store online is the one this Lore ships (APP-231).
        store_state=deploy.store_state(node_url),
    )


def build() -> dict[str, object]:
    """Fetch, then assemble: the store, the node probe (cached), the file system."""
    with Store() as store:
        rows = _rows(store)
    live_state = _cached_live_state(rows.node_url)
    return assemble(rows, live_state, _surroundings(rows.node_url))


def assemble(
    rows: Rows, live_state: LiveState, surroundings: Surroundings
) -> dict[str, object]:
    """The desktop snapshot from plain data: no store, no network, no file system
    (XC-105). The inputs are left as they were."""
    live, live_ids = live_state
    piece_price = (
        float(rows.publication_price)
        if isinstance(rows.publication_price, (int, float))
        else 0.0
    )
    memories = []
    for row in rows.memories:
        memory = {
            key: value
            for key, value in row.items()
            if key not in ("source", "origin", "source_path", "project")
        }
        project = str(row["project"])
        memory["project_label"] = surroundings.project_labels.get(
            project
        ) or project.removeprefix(surroundings.slug_prefix)
        memories.append(memory)
    publications = []
    for row in rows.publications:
        publication = {key: value for key, value in row.items() if key != "active"}
        public_id = row["public_id"]
        publication["state"] = "approved" if bool(row["active"]) else "revoked"
        publication["live"] = None if live_ids is None else public_id in live_ids
        publications.append(publication)

    publication_counts = {
        "active": sum(p["state"] == "approved" for p in publications),
        "revoked": sum(p["state"] == "revoked" for p in publications),
    }

    return {
        "version": 1,
        "home": surroundings.home,
        "setup": {
            "sources_configured": rows.sources_configured,
            "blueprint_configured": surroundings.blueprint_configured,
            "profile_configured": surroundings.profile_configured,
            "schedule": surroundings.schedule,
            "telemetry_enabled": rows.telemetry_enabled,
            "telemetry_noticed": rows.telemetry_noticed,
            "automations_noticed": rows.automations_noticed,
        },
        "feedback": {"available": surroundings.feedback_available},
        "library": {
            "counts": {
                "private": sum(m["status"] == "private" for m in memories),
            },
            "sources": rows.sources,
            "items": memories,
        },
        "publications": {
            "counts": publication_counts,
            "items": publications,
        },
        "collections": {
            "items": [
                {
                    "id": c.id,
                    "public_id": c.public_id,
                    "title": c.title,
                    "price_usd": c.price_usd,
                    "on_sale": c.on_sale,
                    "pieces": [
                        {"id": p.id, "public_id": p.public_id, "title": p.title}
                        for p in c.pieces
                        if p.active
                    ],
                    "value_usd": round(
                        sum(p.active for p in c.pieces) * piece_price, 2
                    ),
                }
                for c in rows.collections
            ]
        },
        "pricing": {
            "publication_usd": rows.publication_price,
            "answer_usd": rows.answer_price if rows.answer_enabled else None,
            "answer_enabled": rows.answer_enabled,
            "free_copies": rows.free_copies,
        },
        "node": {
            "url": rows.node_url,
            # Where the owner's agents save: their own store's, or the one Lore hosts (XC-088).
            "agents": rows.agents_url,
            # False while the store is online only for the owner's agents (XC-069).
            "selling": rows.node_selling,
            "store": surroundings.store_state,
            "live": live,
        },
        # Owner-run history. The stored summary is a code; the prose is applied
        # here, so wording can change without touching the database and the
        # database never holds a sentence anyone could smuggle content into.
        "jobs": {
            "items": [
                {
                    "id": item.id,
                    "kind": item.kind.value,
                    "status": item.status.value,
                    "title": item.title,
                    "summary": JOB_SUMMARIES[item.summary],
                    "count": item.count,
                    "cost_usd": item.cost_usd,
                    "started_at": item.started_at,
                    "finished_at": item.finished_at,
                }
                for item in rows.jobs
            ]
        },
    }
