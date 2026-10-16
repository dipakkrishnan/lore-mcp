"""A stand-in for the owner's node on the agent write path (XC-067), kept to
`contracts/inbox.md`: a local SQLite file plays the node's D1, a `wrangler` that runs
`d1 execute` against it plays the owner's Cloudflare login, and a small server plays
`<node_url>/agent`, sealing every save to the owner's key as the Worker does.

Tests patch `lore.deploy.subprocess.run` with `D1.wrangler`. The desktop's edge harness
runs the same pieces as processes, from the repository root:

    LORE_EDGE_D1=$root/d1.sqlite uv run python -m tests.fixtures.inbox serve --port N
    LORE_EDGE_D1=$root/d1.sqlite uv run python -m tests.fixtures.inbox wrangler d1 execute ...

with `$LORE_HOME/node/node_modules/.bin/wrangler` a shim that `cd`s to the repository
and execs the second line with `"$@"`, and `node_url` set to `http://127.0.0.1:N/mcp`.
The CLI keeps the owner's inbox keys in a file rather than the Keychain with
`PYTHONPATH=<repo> PYTHON_KEYRING_BACKEND=tests.fixtures.inbox.Keyring` and
`LORE_EDGE_KEYRING=$root/keyring.json`.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import subprocess
import sys
import threading
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Iterator

from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from keyring.backend import KeyringBackend
from keyring.errors import PasswordDeleteError

TOKEN = re.compile(r"^lore_agent_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$")
KINDS = ("experience", "lesson", "preference", "fact", "reference")
WINDOWS = {"hour": (timedelta(hours=1), 100), "day": (timedelta(days=1), 1000)}
MOST_WAITING = 2000
KEPT = timedelta(days=30)
OWED = "state IN ('waiting','forgotten') AND sealed IS NOT NULL"
INSTRUCTIONS = (
    "Lore keeps every save private on the owner's Mac until the owner reviews it in "
    "the Lore app. Nothing is ever published or sold without the owner's approval."
)


def encode(raw: bytes) -> str:
    return urlsafe_b64encode(raw).rstrip(b"=").decode()


def decode(text: str) -> bytes:
    return urlsafe_b64decode(text + "=" * (-len(text) % 4))


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


class Keyring(KeyringBackend):
    """A Keychain kept in one JSON file, so processes the harness starts share what
    the first one saved and the owner's own Keychain is never touched."""

    priority = 1  # type: ignore[assignment]

    @property
    def path(self) -> Path:
        return Path(os.environ["LORE_EDGE_KEYRING"])

    def get_password(self, service: str, username: str) -> str | None:
        return self._saved().get(f"{service} {username}")

    def set_password(self, service: str, username: str, password: str) -> None:
        self.path.write_text(
            json.dumps(self._saved() | {f"{service} {username}": password})
        )

    def delete_password(self, service: str, username: str) -> None:
        saved = self._saved()
        if saved.pop(f"{service} {username}", None) is None:
            raise PasswordDeleteError(username)
        self.path.write_text(json.dumps(saved))

    def _saved(self) -> dict[str, str]:
        return json.loads(self.path.read_text()) if self.path.exists() else {}


class Rejected(Exception):
    pass


class D1:
    """The node's database, as a SQLite file, answering in wrangler's `--json` shape."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.commands: list[str] = []

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        return db

    def execute(self, sql: str) -> list[dict[str, object]]:
        self.commands.append(sql)
        db = self.connect()
        try:
            with db:
                return [
                    {"results": [dict(row) for row in db.execute(statement)]}
                    for statement in self.statements(sql)
                ]
        finally:
            db.close()

    def wrangler(
        self, args: tuple[str, ...], **_: object
    ) -> subprocess.CompletedProcess[str]:
        """`wrangler d1 execute`, for `subprocess.run`; anything else succeeds quietly."""
        command = list(args)
        if "execute" not in command:
            return subprocess.CompletedProcess(args, 0, "", "")
        sql = (
            command[command.index("--command") + 1]
            if "--command" in command
            else Path(command[command.index("--file") + 1]).read_text(encoding="utf-8")
        )
        try:
            answer = json.dumps(self.execute(sql))
        except sqlite3.Error as error:
            refusal = json.dumps({"error": {"text": str(error)}})
            return subprocess.CompletedProcess(args, 1, refusal, "")
        return subprocess.CompletedProcess(args, 0, answer, "")

    @staticmethod
    def statements(sql: str) -> Iterator[str]:
        buffer = ""
        for part in sql.split(";"):
            buffer += part + ";"
            if sqlite3.complete_statement(buffer):
                if buffer.strip(" \n;"):
                    yield buffer
                buffer = ""


class Endpoint:
    """The three tools at `/agent`, over the node's tables."""

    def __init__(self, d1: D1, clock: Callable[[], datetime] | None = None) -> None:
        self.d1 = d1
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def agent(self, authorization: str) -> str | None:
        found = TOKEN.match(authorization.removeprefix("Bearer ").strip())
        if not found:
            return None
        db = self.d1.connect()
        try:
            row = db.execute(
                "SELECT token_hash FROM agents WHERE id=? AND revoked_at IS NULL",
                (found.group(1),),
            ).fetchone()
        except sqlite3.Error:
            row = None
        finally:
            db.close()
        hashed = hashlib.sha256(found.group(2).encode()).hexdigest()
        if row and hmac.compare_digest(row["token_hash"], hashed):
            return found.group(1)
        return None

    def call(self, agent: str, tool: str, arguments: dict[str, object]) -> object:
        db = self.d1.connect()
        try:
            with db:
                settings = dict(
                    tuple(row)
                    for row in db.execute("SELECT key, value FROM node_settings")
                )
                if "inbox_public_key" not in settings:
                    raise Rejected("Lore isn't ready for agents on this store yet")
                public = decode(settings["inbox_public_key"])
                salt = decode(settings["inbox_salt"])
                db.execute(
                    "DELETE FROM inbox WHERE sealed IS NOT NULL AND saved_at <= ?",
                    (self._at(self.clock() - KEPT),),
                )
                work = getattr(self, f"_{tool}")
                return work(db, agent, public, salt, arguments)
        finally:
            db.close()

    def _store(
        self,
        db: sqlite3.Connection,
        agent: str,
        public: bytes,
        salt: bytes,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        items = arguments.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= 20:
            raise Rejected("store takes 1-20 items")
        saves = [self._save(item) for item in items]
        self._allow(db, agent, len(saves))
        saved = []
        for save in saves:
            sent = save["key"]
            pending = (
                self._pending(db, agent, self._hash(salt, agent, sent))
                if sent
                else None
            )
            item = pending or secrets.token_hex(16)
            key = sent or item
            payload = json.dumps(save | {"key": key}).encode()
            sealed, now = seal(public, item, payload), self._at(self.clock())
            if pending:
                db.execute(
                    "UPDATE inbox SET state='waiting', sealed=?, saved_at=? WHERE id=?",
                    (sealed, now, item),
                )
            else:
                self._room(db)
                db.execute(
                    "INSERT INTO inbox(id,agent,key_hash,state,sealed,saved_at) "
                    "VALUES (?,?,?,'waiting',?,?)",
                    (item, agent, self._hash(salt, agent, key), sealed, now),
                )
            db.execute(
                "UPDATE agents SET saved=saved+1, last_saved_at=? WHERE id=?",
                (now, agent),
            )
            saved.append({"id": item, "key": key, "replaced": pending is not None})
        return {"saved": saved, "note": f"Saved privately. {INSTRUCTIONS}"}

    def _stored(
        self,
        db: sqlite3.Connection,
        agent: str,
        public: bytes,
        salt: bytes,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        keys = arguments.get("keys") or []
        if not isinstance(keys, list) or len(keys) > 50:
            raise Rejected("stored takes at most 50 keys")
        row = db.execute(
            f"SELECT saved, last_saved_at, (SELECT count(*) FROM inbox WHERE agent=? "
            f"AND {OWED}) waiting FROM agents WHERE id=?",
            (agent, agent),
        ).fetchone()
        found = []
        for key in keys:
            latest = db.execute(
                "SELECT state, saved_at FROM inbox WHERE agent=? AND key_hash=? "
                "ORDER BY saved_at DESC, rowid DESC LIMIT 1",
                (agent, self._hash(salt, agent, str(key))),
            ).fetchone()
            found.append(
                {
                    "key": key,
                    "state": latest["state"] if latest else "unknown",
                    "saved_at": latest["saved_at"] if latest else None,
                }
            )
        return {
            "saved": row["saved"],
            "waiting": row["waiting"],
            "last_saved_at": row["last_saved_at"],
            "keys": found,
        }

    def _forget(
        self,
        db: sqlite3.Connection,
        agent: str,
        public: bytes,
        salt: bytes,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        key = str(arguments.get("key", "")).strip()
        if not 1 <= len(key) <= 120:
            raise Rejected("key must be 1-120 characters")
        self._allow(db, agent, 1)
        hashed = self._hash(salt, agent, key)
        pending = self._pending(db, agent, hashed)
        arrived = db.execute(
            "SELECT 1 FROM inbox WHERE agent=? AND key_hash=? AND state='received'",
            (agent, hashed),
        ).fetchone()
        if pending and not arrived:
            # Nothing under this key reached the Mac: the row stays, with no payload.
            db.execute(
                "UPDATE inbox SET state='forgotten', sealed=NULL, saved_at=? WHERE id=?",
                (self._at(self.clock()), pending),
            )
            return {"forgotten": True}
        item = pending or secrets.token_hex(16)
        payload = json.dumps({"key": key, "forget": True}).encode()
        sealed, now = seal(public, item, payload), self._at(self.clock())
        if pending:
            db.execute(
                "UPDATE inbox SET state='forgotten', sealed=?, saved_at=? WHERE id=?",
                (sealed, now, item),
            )
        else:
            self._room(db)
            db.execute(
                "INSERT INTO inbox(id,agent,key_hash,state,sealed,saved_at) "
                "VALUES (?,?,?,'forgotten',?,?)",
                (item, agent, hashed, sealed, now),
            )
        return {"forgotten": True}

    @staticmethod
    def _hash(salt: bytes, agent: str, key: str) -> str:
        return hmac.new(salt, f"{agent}:{key}".encode(), "sha256").hexdigest()

    @staticmethod
    def _pending(db: sqlite3.Connection, agent: str, hashed: str) -> str | None:
        row = db.execute(
            "SELECT id FROM inbox WHERE agent=? AND key_hash=? AND sealed IS NOT NULL",
            (agent, hashed),
        ).fetchone()
        return row["id"] if row else None

    @staticmethod
    def _room(db: sqlite3.Connection) -> None:
        waiting = db.execute(f"SELECT count(*) FROM inbox WHERE {OWED}").fetchone()[0]
        if waiting >= MOST_WAITING:
            raise Rejected(f"a store can have {MOST_WAITING} items waiting")

    def _allow(self, db: sqlite3.Connection, agent: str, writes: int) -> None:
        now = self.clock()
        for span, (length, limit) in WINDOWS.items():
            row = db.execute(
                "SELECT started, used FROM inbox_windows WHERE agent=? AND span=?",
                (agent, span),
            ).fetchone()
            fresh = row is None or now - self._parse(row["started"]) >= length
            used = 0 if fresh else row["used"]
            if used + writes > limit:
                raise Rejected(f"an agent can make {limit} writes a {span}")
            db.execute(
                "INSERT OR REPLACE INTO inbox_windows(agent,span,started,used) "
                "VALUES (?,?,?,?)",
                (
                    agent,
                    span,
                    self._at(now) if fresh else row["started"],
                    used + writes,
                ),
            )

    @staticmethod
    def _save(item: object) -> dict[str, str | None]:
        if not isinstance(item, dict):
            raise Rejected("each item must be an object")
        title, content = str(item.get("title", "")), str(item.get("content", ""))
        topic, kind, key = item.get("topic"), item.get("kind"), item.get("key")
        key = None if key is None else str(key).strip()
        if not 1 <= len(title) <= 200:
            raise Rejected("title must be 1-200 characters")
        if not 1 <= len(content) <= 20_000:
            raise Rejected("content must be 1-20,000 characters")
        if topic is not None and len(str(topic)) > 80:
            raise Rejected("topic must be at most 80 characters")
        if kind is not None and kind not in KINDS:
            raise Rejected(f"kind must be one of {', '.join(KINDS)}")
        if key is not None and not 1 <= len(key) <= 120:
            raise Rejected("key must be 1-120 characters")
        occurred = item.get("occurred_at")
        return {
            "title": title,
            "content": content,
            "topic": None if topic is None else str(topic),
            "kind": None if kind is None else str(kind),
            "key": key,
            "occurred_at": None if occurred is None else str(occurred),
        }

    @staticmethod
    def _at(moment: datetime) -> str:
        return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @staticmethod
    def _parse(text: str) -> datetime:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))


class Node(ThreadingHTTPServer):
    """`<node_url>/agent`, on a loopback port."""

    daemon_threads = True

    def __init__(self, endpoint: Endpoint, port: int = 0) -> None:
        super().__init__(("127.0.0.1", port), Handler)
        self.endpoint = endpoint
        self.lock = threading.Lock()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_port}"

    def __enter__(self) -> Node:
        threading.Thread(target=self.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *_: object) -> None:
        self.shutdown()
        self.server_close()


class Handler(BaseHTTPRequestHandler):
    server: Node
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
        self._send(405 if self.path == "/agent" else 404, {"error": "POST to /agent"})

    def do_POST(self) -> None:
        route, _, key = self.path.removeprefix("/").partition("/")
        if route != "agent" or "/" in key:
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        try:
            message = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            self._send(400, {"error": "body must be JSON"})
            return
        agent = self.server.endpoint.agent(
            f"Bearer {key}" if key else self.headers.get("Authorization", "")
        )
        if agent is None:
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
        with self.server.lock:
            self._send(200, self._answer(agent, message))

    def log_message(self, format: str, *args: object) -> None:
        pass

    def _answer(self, agent: str, message: dict[str, object]) -> dict[str, object]:
        reply: dict[str, object] = {"jsonrpc": "2.0", "id": message["id"]}
        params = message.get("params")
        params = params if isinstance(params, dict) else {}
        method = message.get("method")
        if method == "initialize":
            reply["result"] = {
                "protocolVersion": params.get("protocolVersion", "2025-06-18"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "lore-agent", "version": "0.1.0"},
                "instructions": INSTRUCTIONS,
            }
        elif method == "ping":
            reply["result"] = {}
        elif method == "tools/list":
            reply["result"] = {
                "tools": [
                    {"name": name, "inputSchema": schema}
                    for name, schema in self.tools.items()
                ]
            }
        elif method == "tools/call" and params.get("name") in self.tools:
            arguments = params.get("arguments")
            try:
                result = self.server.endpoint.call(
                    agent,
                    str(params["name"]),
                    arguments if isinstance(arguments, dict) else {},
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
            reply["error"] = {"code": -32601, "message": f"unknown method: {method}"}
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
    options.add_argument("mode", choices=("serve", "wrangler"))
    options.add_argument("--port", type=int, default=8788)
    options.add_argument("--db", default=os.environ.get("LORE_EDGE_D1", "d1.sqlite"))
    known, rest = options.parse_known_args()
    d1 = D1(Path(known.db))
    if known.mode == "wrangler":
        answered = d1.wrangler(tuple(rest))
        print(answered.stdout, end="")
        sys.exit(answered.returncode)
    node = Node(Endpoint(d1), known.port)
    print(f"Lore agent endpoint at {node.url}/agent", flush=True)
    node.serve_forever()
