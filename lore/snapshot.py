from __future__ import annotations

import json
import time
import urllib.request
from http.client import HTTPResponse
from itertools import islice
from pathlib import Path
from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict, TypeAdapter

from . import automation, blueprint
from .paths import claude_home, home
from .sources import available_sources
from .store import JOB_SUMMARIES, Store


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


def _remote_manifest(url: str) -> Manifest:
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
        manifest = _remote_manifest(node_url)
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


def _cached_live_state(
    node_url: str | None,
) -> tuple[dict[str, object], set[str] | None]:
    """The probe is three round trips at up to 5 s each and runs on every
    desktop refresh, so its answer is kept briefly; `forget_live` drops it
    when a push changes what the node holds."""
    if not node_url:
        return _live_state(node_url)
    with Store() as store:
        cached = store.setting("node_live", None)
    now = time.time()
    if (
        isinstance(cached, dict)
        and cached.get("url") == node_url
        and now - float(cached.get("checked_at", 0)) < LIVE_CACHE_SECONDS
    ):
        ids = cached.get("ids")
        live = dict(cached["live"])
        # A cache written before this field existed is still fresh enough to
        # trust for liveness; it just has nothing to say about the price.
        live.setdefault("price_usd", None)
        return live, set(ids) if isinstance(ids, list) else None
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
    for slug in projects.iterdir():
        for session in slug.glob("*.jsonl"):
            cwd = _session_cwd(session)
            if cwd:
                labels[slug.name] = Path(cwd).name
                break
    return labels


def build() -> dict[str, object]:
    missing = object()
    with Store() as store:
        configured = store.setting("sources", missing)
        source_counts = store.source_counts()
        memories = store.memory_inventory()
        publications = store.publication_inventory()
        publication_price = store.setting("price_usd", None)
        answer_price = store.setting("answer_price_usd", 0.0)
        answer_enabled = store.setting("answer_enabled", False) is True
        node_url = store.setting("node_url", None)
        # Reading concedes jobs whose liveness claim expired, so an interrupted
        # run turns visibly incomplete on the next refresh without a scheduler.
        jobs = store.recent_jobs(limit=20)

    live, live_ids = _cached_live_state(node_url if isinstance(node_url, str) else None)
    labels = _claude_project_labels()
    prefix = "-" + str(Path.home()).strip("/").replace("/", "-") + "-"
    for memory in memories:
        project = str(memory.pop("project"))
        memory["project_label"] = labels.get(project) or project.removeprefix(prefix)
    for publication in publications:
        active = bool(publication.pop("active"))
        public_id = publication["public_id"]
        publication["state"] = "approved" if active else "revoked"
        publication["live"] = None if live_ids is None else public_id in live_ids

    publication_counts = {
        "active": sum(p["state"] == "approved" for p in publications),
        "revoked": sum(p["state"] == "revoked" for p in publications),
    }

    sources = [
        {
            "name": source.name,
            "label": source.label,
            "enabled": isinstance(configured, list) and source.name in configured,
            "imported": source_counts.get(source.name, 0),
        }
        for source in available_sources()
        if source.origin != "automation"
    ]
    return {
        "version": 1,
        "home": str(home()),
        "setup": {
            "sources_configured": configured is not missing,
            "blueprint_configured": blueprint.blueprint_path().is_file(),
            "profile_configured": automation.profile_path().is_file(),
        },
        "library": {
            "counts": {
                "private": sum(m["status"] == "private" for m in memories),
            },
            "sources": sources,
            "items": memories,
        },
        "publications": {
            "counts": publication_counts,
            "items": publications,
        },
        "pricing": {
            "publication_usd": publication_price,
            "answer_usd": answer_price if answer_enabled else None,
            "answer_enabled": answer_enabled,
        },
        "node": {
            "url": node_url if isinstance(node_url, str) else None,
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
                    "summary": JOB_SUMMARIES[item.summary],
                    "count": item.count,
                    "cost_usd": item.cost_usd,
                    "started_at": item.started_at,
                    "finished_at": item.finished_at,
                }
                for item in jobs
            ]
        },
    }
