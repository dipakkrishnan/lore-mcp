"""Small MCP server over stdio or stateless Streamable HTTP.

This module is responsible for exactly one thing: deciding what is disclosable.
The surface returns only active rows from the ``publications`` table and never a
private memory of any kind. Payment and access control are separate concerns —
wherever they end up living, they gate *whether* a caller gets an answer, never
*what* is answerable.

Keep the HTTP origin bound to loopback unless a token is set.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from . import __version__
from .store import Store

PROTOCOL_VERSION = "2025-11-25"

TOOLS = [
    {
        "name": "discover",
        "title": "Discover Lore",
        "description": (
            "Return this node's full catalog of owner-approved publications: "
            "teasers grouped by topic, with ids, freshness, and price. Free. "
            "Read it and decide what is worth fetching — there is no server-side search."
        ),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "get",
        "title": "Get a publication",
        "description": (
            "Fetch one owner-approved publication by its id from the discover "
            "catalog. Use only ids read from a current discover call: where this "
            "surface is paid, payment settles before the lookup, so an unknown or "
            "revoked id is billed and returns an error."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "string", "minLength": 1}},
            "required": ["id"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
]


def dispatch(message: object) -> dict[str, Any] | None:
    """Dispatch one JSON-RPC request, ignoring notifications."""
    if not isinstance(message, dict):
        return _error(None, -32600, "invalid request")
    request_id = message.get("id")
    method = message.get("method")
    if message.get("jsonrpc") != "2.0" or not isinstance(method, str):
        return _error(request_id, -32600, "invalid request")
    if "id" not in message:
        return None
    try:
        params = message.get("params", {})
        if not isinstance(params, dict):
            raise TypeError("params must be an object")
        if method == "initialize":
            requested = params.get("protocolVersion")
            version = (
                requested
                if requested in {"2025-11-25", "2025-06-18", "2025-03-26"}
                else PROTOCOL_VERSION
            )
            result: dict[str, Any] = {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "lore", "version": __version__},
                "instructions": (
                    "discover returns the full catalog (free); get fetches one "
                    "publication by id. Only owner-approved publications exist here."
                ),
            }
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": TOOLS}
        elif method == "tools/call":
            result = call_tool(params.get("name", ""), params.get("arguments", {}))
        else:
            return _error(request_id, -32601, f"method not found: {method}")
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    except (TypeError, ValueError) as error:
        return _error(request_id, -32602, str(error))
    except Exception as error:  # Keep implementation details out of remote responses.
        print(f"lore mcp internal error: {error!r}", file=sys.stderr)
        return _error(request_id, -32603, "internal error")


def call_tool(name: object, arguments: object) -> dict[str, Any]:
    """Run a Lore MCP tool against owner-approved publications only."""
    if name not in {"discover", "get"}:
        raise ValueError(f"unknown tool: {name}")
    if not isinstance(arguments, dict):
        raise TypeError("arguments must be an object")
    allowed = {"id"} if name == "get" else set()
    unexpected = arguments.keys() - allowed
    if unexpected:
        raise ValueError(f"unexpected argument: {sorted(unexpected)[0]}")
    with Store() as store:
        if name == "discover":
            # The free surface is the manifest: what exists, never what it says.
            payload = store.manifest() | {
                "price_usd": store.setting("price_usd", None),
                "disclosure": "Teasers describe what exists. Fetch content with get, one publication per call.",
            }
        elif name == "get":
            public_id = arguments.get("id")
            if not isinstance(public_id, str) or not public_id.strip():
                raise ValueError("id must be a publication id from the discover catalog")
            publication = store.get_publication(public_id.strip())
            payload = {
                "publication": {
                    "id": publication.public_id,
                    "title": publication.title,
                    "content": publication.content,
                    "topic": publication.topic,
                    # The private memory ids behind a publication are never sent
                    # to a buyer: they leak the size and shape of the library.
                    "kind": publication.kind,
                    "updated_at": publication.updated_at,
                },
                "disclosure": "Content is owner-approved; preserve attribution when synthesizing.",
            }
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}]}


def _error(request_id: object, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def stdio() -> int:
    """Serve newline-delimited JSON-RPC over standard input and output."""
    for line in sys.stdin:
        try:
            message = json.loads(line)
            response = dispatch(message)
            if response is not None:
                print(json.dumps(response, separators=(",", ":")), flush=True)
        except (json.JSONDecodeError, UnicodeError) as error:
            print(json.dumps(_error(None, -32700, str(error))), flush=True)
    return 0


def http(host: str, port: int, token: str | None = None) -> int:
    """Serve MCP over HTTP, requiring authentication off loopback."""
    if host not in {"127.0.0.1", "localhost"} and not token:
        raise ValueError("non-loopback MCP requires --token or LORE_MCP_TOKEN")

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path == "/health":
                self._send(200, {"status": "ok", "service": "lore"})
            else:
                self._send(405, {"error": "SSE listening is not offered; use POST /mcp"})

        def do_POST(self) -> None:
            if self.path != "/mcp":
                self._send(404, {"error": "not found"})
                return
            authorization = self.headers.get("Authorization", "").encode()
            expected = f"Bearer {token}".encode() if token else b""
            if token and not secrets.compare_digest(authorization, expected):
                self._send(401, {"error": "unauthorized"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1_000_000:
                    raise ValueError("request size must be between 1 and 1000000 bytes")
                message = json.loads(self.rfile.read(length))
                response = dispatch(message)
                if response is None:
                    self.send_response(202)
                    self.end_headers()
                else:
                    self._send(200, response)
            except (json.JSONDecodeError, UnicodeError, ValueError) as error:
                self._send(400, _error(None, -32700, str(error)))

        def _send(self, status: int, payload: object) -> None:
            data = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: object) -> None:
            print(f"lore mcp: {format % args!a}", file=sys.stderr)

    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Lore MCP listening on http://{host}:{port}/mcp", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


def main(argv: list[str] | None = None) -> int:
    """Run the selected MCP transport."""
    parser = argparse.ArgumentParser(prog="lore serve")
    parser.add_argument("--transport", choices=["stdio", "http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--token", default=os.environ.get("LORE_MCP_TOKEN"))
    args = parser.parse_args(argv)
    return http(args.host, args.port, args.token) if args.transport == "http" else stdio()
