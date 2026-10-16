"""A stand-in for Lore's hosted inbox (XC-067), kept to `contracts/inbox.md`: the owner
API, and the agent MCP at `/mcp` as stateless JSON-RPC over HTTP, sealing every save to
the owner's key as the Worker does. Tests run it on a thread;
`uv run python -m tests.fixtures.inbox --port N` serves it for the desktop's edge scenario.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import itertools
import json
import os
import re
import secrets
import threading
from base64 import urlsafe_b64decode, urlsafe_b64encode
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable
from urllib.parse import parse_qs, urlsplit

from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

TOKEN = re.compile(r"^lore_(owner|agent)_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$")
APPS = ("grok", "muse", "chatgpt", "claude", "other")
KINDS = ("experience", "lesson", "preference", "fact", "reference")
INSTRUCTIONS = (
    "Lore keeps every save private until the owner reviews it in the Lore app. "
    "Nothing is ever published or sold without the owner's approval."
)


def encode(raw: bytes) -> str:
    return urlsafe_b64encode(raw).rstrip(b"=").decode()


def decode(text: str) -> bytes:
    return urlsafe_b64decode(text + "=" * (-len(text) % 4))


def digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def seal(
    public: bytes,
    item_id: str,
    plaintext: bytes,
    ephemeral: X25519PrivateKey | None = None,
    nonce: bytes | None = None,
) -> str:
    ephemeral = ephemeral or X25519PrivateKey.generate()
    nonce = nonce or os.urandom(12)
    mine = ephemeral.public_key().public_bytes_raw()
    shared = ephemeral.exchange(X25519PublicKey.from_public_bytes(public))
    key = HKDF(SHA256(), 32, salt=mine + public, info=b"lore-inbox-v1").derive(shared)
    return encode(
        mine + nonce + AESGCM(key).encrypt(nonce, plaintext, item_id.encode())
    )


class Rejected(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass
class AgentRow:
    id: str
    name: str
    app: str
    token_hash: str
    created_at: str
    revoked_at: str | None = None
    last_saved_at: str | None = None
    saved: int = 0
    writes: list[datetime] = field(default_factory=list)


@dataclass
class ItemRow:
    id: str
    agent: str
    key_hash: str
    state: str
    sealed: str | None
    saved_at: str
    order: int
    received_at: str | None = None


@dataclass
class OwnerRow:
    id: str
    secret_hash: str
    public_key: bytes
    salt: bytes = field(default_factory=lambda: os.urandom(32))
    agents: dict[str, AgentRow] = field(default_factory=dict)
    items: dict[str, ItemRow] = field(default_factory=dict)


class Inbox:
    """Every owner's tables, as the Worker keeps one Durable Object per owner."""

    hourly = 100
    daily = 1000
    most_waiting = 2000

    def __init__(self, clock: Callable[[], datetime] | None = None) -> None:
        self.owners: dict[str, OwnerRow] = {}
        self.lock = threading.Lock()
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.order = itertools.count()

    def now(self) -> str:
        return self.clock().isoformat(timespec="milliseconds").replace("+00:00", "Z")

    # Owner API

    def register(self, body: dict[str, object]) -> dict[str, object]:
        try:
            public = decode(str(body["public_key"]))
        except (KeyError, ValueError):
            public = b""
        if len(public) != 32:
            raise Rejected(400, "public_key must be 32 bytes, base64url")
        owner, secret = secrets.token_hex(16), secrets.token_urlsafe(32)
        self.owners[owner] = OwnerRow(owner, digest(secret), public)
        return {"owner": owner, "token": f"lore_owner_{owner}_{secret}"}

    def me(self, owner: OwnerRow) -> dict[str, object]:
        return {
            "owner": owner.id,
            "waiting": len(self._waiting(owner)),
            "agents": [self._agent(owner, agent) for agent in owner.agents.values()],
        }

    def mint(
        self, owner: OwnerRow, body: dict[str, object], base: str
    ) -> dict[str, object]:
        name = str(body.get("name", "")).strip()
        if not 1 <= len(name) <= 40:
            raise Rejected(400, "name must be 1-40 characters")
        if body.get("app") not in APPS:
            raise Rejected(400, f"app must be one of {', '.join(APPS)}")
        agent = AgentRow(secrets.token_hex(8), name, str(body["app"]), "", self.now())
        owner.agents[agent.id] = agent
        return {
            "agent": self._agent(owner, agent),
            "token": self._key(owner, agent),
            "mcp_url": f"{base}/mcp",
        }

    def rotate(self, owner: OwnerRow, agent_id: str) -> dict[str, object]:
        agent = self._named(owner, agent_id)
        if agent.revoked_at:
            raise Rejected(409, "that agent is disconnected")
        return {"token": self._key(owner, agent)}

    def revoke(self, owner: OwnerRow, agent_id: str) -> None:
        agent = self._named(owner, agent_id)
        agent.revoked_at = agent.revoked_at or self.now()

    def items(self, owner: OwnerRow, query: dict[str, list[str]]) -> dict[str, object]:
        try:
            limit = int(query.get("limit", ["100"])[0])
        except ValueError:
            limit = 0
        if not 1 <= limit <= 200:
            raise Rejected(400, "limit must be 1-200")
        agent = query.get("agent", [None])[0]
        return {
            "items": [
                {
                    "id": item.id,
                    "agent": item.agent,
                    "state": item.state,
                    "sealed": item.sealed,
                    "saved_at": item.saved_at,
                }
                for item in self._waiting(owner)
                if agent is None or item.agent == agent
            ][:limit]
        }

    def received(self, owner: OwnerRow, body: dict[str, object]) -> None:
        ids = body.get("ids")
        if not isinstance(ids, list) or len(ids) > 200:
            raise Rejected(400, "ids must be a list of at most 200")
        for item in (owner.items.get(str(i)) for i in ids):
            if item and item.state in ("waiting", "forgotten"):
                item.state, item.sealed, item.received_at = "received", None, self.now()

    def erase(self, owner: OwnerRow) -> None:
        del self.owners[owner.id]

    # Agent tools

    def store(
        self, owner: OwnerRow, agent: AgentRow, arguments: dict[str, object]
    ) -> dict[str, object]:
        items = arguments.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= 20:
            raise Rejected(400, "store takes 1-20 items")
        saves = [self._save(item) for item in items]
        self._allow(owner, agent, len(saves))
        saved = []
        for save in saves:
            row, replaced = self._put(owner, agent, save["key"], save)
            saved.append(
                {"id": row.id, "key": save["key"] or row.id, "replaced": replaced}
            )
        return {
            "saved": saved,
            "note": "Saved privately for the owner. " + INSTRUCTIONS,
        }

    def stored(
        self, owner: OwnerRow, agent: AgentRow, arguments: dict[str, object]
    ) -> dict[str, object]:
        keys = arguments.get("keys") or []
        if not isinstance(keys, list) or len(keys) > 50:
            raise Rejected(400, "stored takes at most 50 keys")
        mine = sorted(
            (i for i in owner.items.values() if i.agent == agent.id),
            key=lambda i: i.order,
        )
        found = []
        for key in keys:
            latest = [i for i in mine if i.key_hash == self._hash(owner, agent, key)]
            item = latest[-1] if latest else None
            found.append(
                {
                    "key": key,
                    "state": item.state if item else "unknown",
                    "saved_at": item.saved_at if item else None,
                }
            )
        return {
            "saved": agent.saved,
            "waiting": sum(i.state in ("waiting", "forgotten") for i in mine),
            "last_saved_at": agent.last_saved_at,
            "keys": found,
        }

    def forget(
        self, owner: OwnerRow, agent: AgentRow, arguments: dict[str, object]
    ) -> dict[str, object]:
        key = str(arguments.get("key", "")).strip()
        if not 1 <= len(key) <= 120:
            raise Rejected(400, "key must be 1-120 characters")
        self._allow(owner, agent, 1)
        found = self._pending(owner, agent, key)
        if found:
            del owner.items[found.id]
        else:
            item_id = secrets.token_hex(16)
            payload = json.dumps({"key": key, "forget": True}).encode()
            owner.items[item_id] = ItemRow(
                item_id,
                agent.id,
                self._hash(owner, agent, key),
                "forgotten",
                seal(owner.public_key, item_id, payload),
                self.now(),
                next(self.order),
            )
        return {"forgotten": True}

    # Tokens

    def owner(self, token: str) -> OwnerRow:
        role, owner, secret = self._parse(token)
        row = self.owners.get(owner)
        if (
            role != "owner"
            or not row
            or not hmac.compare_digest(row.secret_hash, digest(secret))
        ):
            raise Rejected(401, "unauthorized")
        return row

    def agent(self, token: str) -> tuple[OwnerRow, AgentRow]:
        role, owner, secret = self._parse(token)
        row = self.owners.get(owner)
        hashed = digest(secret)
        for agent in row.agents.values() if row and role == "agent" else []:
            if not agent.revoked_at and hmac.compare_digest(agent.token_hash, hashed):
                return row, agent
        raise Rejected(401, "unauthorized")

    @staticmethod
    def _parse(token: str) -> tuple[str, str, str]:
        found = TOKEN.match(token.removeprefix("Bearer ").strip())
        if not found:
            raise Rejected(401, "unauthorized")
        return found.group(1), found.group(2), found.group(3)

    def _key(self, owner: OwnerRow, agent: AgentRow) -> str:
        secret = secrets.token_urlsafe(32)
        agent.token_hash = digest(secret)
        return f"lore_agent_{owner.id}_{secret}"

    # Rows

    def _agent(self, owner: OwnerRow, agent: AgentRow) -> dict[str, object]:
        return {
            "id": agent.id,
            "name": agent.name,
            "app": agent.app,
            "created_at": agent.created_at,
            "last_saved_at": agent.last_saved_at,
            "saved": agent.saved,
            "waiting": sum(i.agent == agent.id for i in self._waiting(owner)),
            "revoked": agent.revoked_at is not None,
        }

    @staticmethod
    def _named(owner: OwnerRow, agent_id: str) -> AgentRow:
        if agent_id not in owner.agents:
            raise Rejected(404, "no such agent")
        return owner.agents[agent_id]

    @staticmethod
    def _waiting(owner: OwnerRow) -> list[ItemRow]:
        return sorted(
            (i for i in owner.items.values() if i.state in ("waiting", "forgotten")),
            key=lambda i: i.order,
        )

    @staticmethod
    def _hash(owner: OwnerRow, agent: AgentRow, key: str) -> str:
        return hmac.new(owner.salt, f"{agent.id}:{key}".encode(), "sha256").hexdigest()

    def _pending(self, owner: OwnerRow, agent: AgentRow, key: str) -> ItemRow | None:
        hashed = self._hash(owner, agent, key)
        return next(
            (
                i
                for i in owner.items.values()
                if i.agent == agent.id and i.state == "waiting" and i.key_hash == hashed
            ),
            None,
        )

    @staticmethod
    def _save(item: object) -> dict[str, str | None]:
        if not isinstance(item, dict):
            raise Rejected(400, "each item must be an object")
        title, content = str(item.get("title", "")), str(item.get("content", ""))
        topic, kind = item.get("topic"), item.get("kind")
        key = item.get("key")
        key = None if key is None else str(key).strip()
        if not 1 <= len(title) <= 200:
            raise Rejected(400, "title must be 1-200 characters")
        if not 1 <= len(content) <= 20_000:
            raise Rejected(400, "content must be 1-20,000 characters")
        if topic is not None and len(str(topic)) > 80:
            raise Rejected(400, "topic must be at most 80 characters")
        if kind is not None and kind not in KINDS:
            raise Rejected(400, f"kind must be one of {', '.join(KINDS)}")
        if key is not None and not 1 <= len(key) <= 120:
            raise Rejected(400, "key must be 1-120 characters")
        occurred = item.get("occurred_at")
        return {
            "title": title,
            "content": content,
            "topic": None if topic is None else str(topic),
            "kind": None if kind is None else str(kind),
            "key": key,
            "occurred_at": None if occurred is None else str(occurred),
        }

    def _allow(self, owner: OwnerRow, agent: AgentRow, writes: int) -> None:
        now = self.clock()
        agent.writes = [w for w in agent.writes if now - w < timedelta(days=1)]
        if (
            sum(now - w < timedelta(hours=1) for w in agent.writes) + writes
            > self.hourly
        ):
            raise Rejected(429, f"an agent can make {self.hourly} writes an hour")
        if len(agent.writes) + writes > self.daily:
            raise Rejected(429, f"an agent can make {self.daily} writes a day")
        if len(self._waiting(owner)) + writes > self.most_waiting:
            raise Rejected(429, f"an owner can have {self.most_waiting} items waiting")
        agent.writes += [now] * writes

    def _put(
        self,
        owner: OwnerRow,
        agent: AgentRow,
        key: str | None,
        save: dict[str, str | None],
    ) -> tuple[ItemRow, bool]:
        found = self._pending(owner, agent, key) if key else None
        item_id = found.id if found else secrets.token_hex(16)
        payload = json.dumps(save | {"key": key or item_id}).encode()
        now = self.now()
        item = ItemRow(
            item_id,
            agent.id,
            self._hash(owner, agent, key or item_id),
            "waiting",
            seal(owner.public_key, item_id, payload),
            now,
            next(self.order),
        )
        owner.items[item_id] = item
        agent.saved += 1
        agent.last_saved_at = now
        return item, found is not None


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int = 0, inbox: Inbox | None = None) -> None:
        super().__init__(("127.0.0.1", port), Handler)
        self.inbox = inbox or Inbox()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_port}"

    def __enter__(self) -> Server:
        threading.Thread(target=self.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *_: object) -> None:
        self.shutdown()
        self.server_close()


class Handler(BaseHTTPRequestHandler):
    server: Server
    tools = {
        "store": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 20,
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "content": {"type": "string"},
                            "topic": {"type": "string"},
                            "kind": {"type": "string", "enum": list(KINDS)},
                            "key": {"type": "string"},
                            "occurred_at": {"type": "string"},
                        },
                        "required": ["title", "content"],
                    },
                }
            },
            "required": ["items"],
        },
        "stored": {
            "type": "object",
            "properties": {"keys": {"type": "array", "items": {"type": "string"}}},
        },
        "forget": {
            "type": "object",
            "properties": {"key": {"type": "string"}},
            "required": ["key"],
        },
    }

    def do_GET(self) -> None:
        self._route("GET")

    def do_POST(self) -> None:
        self._route("POST")

    def do_DELETE(self) -> None:
        self._route("DELETE")

    def log_message(self, format: str, *args: object) -> None:
        pass

    def _route(self, method: str) -> None:
        url = urlsplit(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        inbox = self.server.inbox
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            self._send(400, {"error": "body must be JSON"})
            return
        token = self.headers.get("Authorization", "")
        try:
            with inbox.lock:
                if url.path == "/mcp":
                    self._mcp(method, token, body)
                    return
                if (method, url.path) == ("POST", "/owners"):
                    self._send(201, inbox.register(body))
                    return
                owner = inbox.owner(token)
                parts = url.path.strip("/").split("/")
                if parts[:2] != ["owners", "me"]:
                    raise Rejected(404, "not found")
                rest = parts[2:]
                if method == "GET" and not rest:
                    self._send(200, inbox.me(owner))
                elif method == "DELETE" and not rest:
                    inbox.erase(owner)
                    self._send(204)
                elif method == "POST" and rest == ["agents"]:
                    self._send(201, inbox.mint(owner, body, self.server.url))
                elif (
                    method == "POST"
                    and len(rest) == 3
                    and rest[0::2]
                    == [
                        "agents",
                        "key",
                    ]
                ):
                    self._send(200, inbox.rotate(owner, rest[1]))
                elif method == "DELETE" and len(rest) == 2 and rest[0] == "agents":
                    inbox.revoke(owner, rest[1])
                    self._send(204)
                elif method == "GET" and rest == ["items"]:
                    self._send(200, inbox.items(owner, parse_qs(url.query)))
                elif method == "POST" and rest == ["items", "received"]:
                    inbox.received(owner, body)
                    self._send(204)
                else:
                    raise Rejected(404, "not found")
        except Rejected as error:
            self._send(error.status, {"error": str(error)})

    def _mcp(self, method: str, token: str, message: object) -> None:
        if method != "POST":
            self._send(405, {"error": "POST JSON-RPC to /mcp"})
            return
        try:
            owner, agent = self.server.inbox.agent(token)
        except Rejected:
            metadata = f"{self.server.url}/.well-known/oauth-protected-resource"
            self._send(
                401,
                {"error": "unauthorized"},
                {"WWW-Authenticate": f'Bearer resource_metadata="{metadata}"'},
            )
            return
        if not isinstance(message, dict) or "id" not in message:
            self._send(202)
            return
        self._send(200, self._answer(owner, agent, message))

    def _answer(
        self, owner: OwnerRow, agent: AgentRow, message: dict[str, object]
    ) -> dict[str, object]:
        reply: dict[str, object] = {"jsonrpc": "2.0", "id": message["id"]}
        params = message.get("params")
        params = params if isinstance(params, dict) else {}
        kind = message.get("method")
        if kind == "initialize":
            reply["result"] = {
                "protocolVersion": params.get("protocolVersion", "2025-06-18"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "lore-inbox", "version": "0.1.0"},
                "instructions": INSTRUCTIONS,
            }
        elif kind == "ping":
            reply["result"] = {}
        elif kind == "tools/list":
            reply["result"] = {
                "tools": [
                    {"name": name, "inputSchema": schema}
                    for name, schema in self.tools.items()
                ]
            }
        elif kind == "tools/call" and params.get("name") in self.tools:
            work = getattr(self.server.inbox, str(params["name"]))
            arguments = params.get("arguments")
            try:
                result = work(
                    owner, agent, arguments if isinstance(arguments, dict) else {}
                )
                reply["result"] = {
                    "content": [{"type": "text", "text": json.dumps(result)}],
                    "structuredContent": result,
                    "isError": False,
                }
            except Rejected as error:
                reply["result"] = {
                    "content": [{"type": "text", "text": str(error)}],
                    "isError": True,
                }
        else:
            reply["error"] = {"code": -32601, "message": f"unknown method: {kind}"}
        return reply

    def _send(
        self,
        status: int,
        payload: object = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        body = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        if body:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    options = argparse.ArgumentParser(prog="python -m tests.fixtures.inbox")
    options.add_argument("--port", type=int, default=8788)
    server = Server(options.parse_args().port)
    print(f"Lore inbox fake at {server.url}", flush=True)
    server.serve_forever()
