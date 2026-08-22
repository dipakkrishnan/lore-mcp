from __future__ import annotations

import json
import urllib.request
from http.client import HTTPResponse
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from . import automation, blueprint
from .paths import home
from .sources import available_sources
from .store import Store


class ManifestEntry(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    id: str


class Manifest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    manifest_version: Literal[1]
    publication_count: int = Field(ge=0)
    topics: dict[str, list[ManifestEntry]]
    price_usd: float | None = None
    answer_price_usd: float | None = None
    network: str | None = None


class ToolText(BaseModel):
    type: Literal["text"]
    text: str


class ToolResult(BaseModel):
    content: list[ToolText] = Field(min_length=1)


class ToolResponse(BaseModel):
    result: ToolResult


OBJECT = TypeAdapter(dict[str, object])


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


def _response(response: HTTPResponse) -> dict[str, object]:
    text = response.read().decode()
    if response.headers.get_content_type() == "text/event-stream":
        text = next(
            line.removeprefix("data: ")
            for line in text.splitlines()
            if line.startswith("data: ")
        )
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
    text = ToolResponse.model_validate(result).result.content[0].text
    manifest = json.loads(text)
    return Manifest.model_validate(manifest)


def _live_state(node_url: str | None) -> tuple[dict[str, object], set[str] | None]:
    empty: dict[str, object] = {
        "publication_count": None,
        "publication_price_usd": None,
        "answer_price_usd": None,
        "network": None,
    }
    if not node_url:
        return {"state": "not_configured", **empty}, None
    try:
        manifest = _remote_manifest(node_url)
    except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
        return {"state": "unreachable", "error": str(error)[:300], **empty}, None
    ids = {entry.id for entries in manifest.topics.values() for entry in entries}
    return (
        {
            "state": "online",
            "publication_count": manifest.publication_count,
            "publication_price_usd": manifest.price_usd,
            "answer_price_usd": manifest.answer_price_usd,
            "network": manifest.network,
        },
        ids,
    )


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
        revocation_pending = bool(store.setting("revocation_pending", False))

    live, live_ids = _live_state(node_url if isinstance(node_url, str) else None)
    for publication in publications:
        active = bool(publication.pop("active"))
        needs_review = active and publication["source_changed_at"] is not None
        is_live = None if live_ids is None else publication["public_id"] in live_ids
        publication["state"] = "approved" if active else "revoked"
        publication["needs_review"] = needs_review
        publication["live"] = is_live

    publication_counts = {
        "active": sum(p["state"] == "approved" for p in publications),
        "needs_review": sum(bool(p["needs_review"]) for p in publications),
        "revoked": sum(p["state"] == "revoked" for p in publications),
        "live": None
        if live_ids is None
        else sum(p["state"] == "approved" and p["live"] is True for p in publications),
        "approved_not_live": None
        if live_ids is None
        else sum(p["state"] == "approved" and p["live"] is False for p in publications),
        "drafts": None,
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
        "setup": {
            "sources_configured": configured is not missing,
            "blueprint_configured": blueprint.blueprint_path().is_file(),
            "profile_configured": automation.profile_path().is_file(),
        },
        "library": {
            "counts": {
                "private": sum(m["status"] == "private" for m in memories),
                "discarded": sum(m["status"] == "discarded" for m in memories),
            },
            "sources": sources,
            "items": memories,
        },
        "publications": {
            "counts": publication_counts,
            "drafts_available": False,
            "items": publications,
        },
        "pricing": {
            "publication_usd": publication_price,
            "answer_usd": answer_price if answer_enabled else None,
            "answer_enabled": answer_enabled,
        },
        "node": {
            "url": node_url if isinstance(node_url, str) else None,
            "staged": (home() / "node/wrangler.jsonc").is_file(),
            "revocation_pending": revocation_pending,
            "live": live,
        },
        "answer_jobs": {
            "available": False,
            "reason": "The deployed node has no owner-authenticated job totals endpoint.",
        },
    }
