"""A stand-in for Lore's hosted stores (XC-088), held to `contracts/hosted-inbox.md`:
each store is claimed by one key and runs only the statements that key signed."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
import urllib.request
from base64 import urlsafe_b64decode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fixtures.inbox import D1

SKEW_MS = 300_000


def _decode(text: str) -> bytes:
    return urlsafe_b64decode(text + "=" * (-len(text) % 4))


class Hosted(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, folder: Path, domain: str) -> None:
        super().__init__(("127.0.0.1", 0), Handler)
        self.folder = folder
        self.domain = domain
        self.owners: dict[str, str] = {}
        self.nonces: set[str] = set()
        self.lock = threading.Lock()

    def d1(self, store: str) -> D1:
        return D1(self.folder / f"{store}.sqlite")

    def __enter__(self) -> Hosted:
        threading.Thread(target=self.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *_: object) -> None:
        self.shutdown()
        self.server_close()

    def urlopen(self) -> Callable[..., object]:
        """`urllib.request.urlopen` for lore.hosted: each store's address, served here."""
        real = urllib.request.urlopen

        def opened(request: urllib.request.Request, timeout: float) -> object:
            host = request.host
            local = urllib.request.Request(
                f"http://127.0.0.1:{self.server_port}{request.selector}",
                data=request.data,
                method=request.get_method(),
                headers={**dict(request.header_items()), "Host": host},
            )
            return real(local, timeout=timeout)

        return opened


class Handler(BaseHTTPRequestHandler):
    server: Hosted

    def log_message(self, *_: object) -> None:
        pass

    def do_POST(self) -> None:
        host = self.headers.get("Host", "")
        store = host.removesuffix(f".{self.server.domain}")
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        with self.server.lock:
            if self.path == "/claim":
                key = json.loads(body).get("key", "")
                known = self.server.owners.get(store)
                if known not in (None, key):
                    return self._send(
                        409, {"error": "this store belongs to someone else"}
                    )
                if not self._signed(host, body, key):
                    return self._send(401, {"error": "unsigned"})
                self.server.owners[store] = key
                return self._send(200, {"claimed": True})
            if self.path != "/owner/sql" or store not in self.server.owners:
                return self._send(404, {"error": "no store here"})
            if not self._signed(host, body, self.server.owners[store]):
                return self._send(
                    401, {"error": "this request isn't signed by the store's owner"}
                )
            try:
                answer = self.server.d1(store).execute(json.loads(body)["sql"])
            except sqlite3.Error as error:
                return self._send(400, {"error": str(error)})
            self._send(200, {"results": [statement["results"] for statement in answer]})

    def _signed(self, host: str, body: bytes, key: str) -> bool:
        moment = self.headers.get("Lore-Time", "")
        nonce = self.headers.get("Lore-Nonce", "")
        if not moment.isdigit() or abs(time.time() * 1000 - int(moment)) > SKEW_MS:
            return False
        if nonce in self.server.nonces:
            return False
        message = "\n".join(
            (
                "lore-owner-v1",
                "POST",
                host,
                self.path,
                moment,
                nonce,
                hashlib.sha256(body).hexdigest(),
            )
        )
        try:
            Ed25519PublicKey.from_public_bytes(_decode(key)).verify(
                _decode(self.headers.get("Lore-Signature", "")), message.encode()
            )
        except (InvalidSignature, ValueError):
            return False
        self.server.nonces.add(nonce)
        return True

    def _send(self, status: int, body: dict[str, object]) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
