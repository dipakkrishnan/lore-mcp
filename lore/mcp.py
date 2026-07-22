"""Small MCP server over stdio or stateless Streamable HTTP.

The HTTP origin deliberately contains no payment implementation. In production the
intended request path is:

    buyer -> Cloudflare Tunnel -> Monetization Gateway/x402 -> Lore /mcp

Cloudflare owns the 402 offer, verification, metering, and settlement at the edge.
Lore remains responsible for deciding which memories have status ``external`` and
for returning only those records. Keep the origin bound to loopback and route only
the gateway/tunnel to it; direct public exposure bypasses the future payment policy.
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
        "description": "Check whether this Lore node has owner-approved context relevant to a query. Free and content-safe.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string", "minLength": 1}},
            "required": ["query"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "answer",
        "title": "Answer from Lore",
        "description": "Return owner-approved evidence relevant to a query. Put the HTTP /mcp route behind Cloudflare Monetization Gateway to make this paid.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1},
                "max_results": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5},
            },
            "required": ["query"],
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
                "instructions": "Use discover before answer. Only owner-approved external memories are returned.",
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
    """Run a Lore MCP tool against owner-approved external memories."""
    if name not in {"discover", "answer"}:
        raise ValueError(f"unknown tool: {name}")
    if not isinstance(arguments, dict):
        raise TypeError("arguments must be an object")
    allowed = {"query", "max_results"} if name == "answer" else {"query"}
    unexpected = arguments.keys() - allowed
    if unexpected:
        raise ValueError(f"unexpected argument: {sorted(unexpected)[0]}")
    query = arguments.get("query", "")
    if not isinstance(query, str):
        raise TypeError("query must be a string")
    query = query.strip()
    if not query:
        raise ValueError("query is required")
    with Store() as store:
        if name == "discover":
            matches = store.search(query, status="external", limit=5)
            payload = {
                "can_help": bool(matches),
                "match_count": len(matches),
                "topics": [memory.title for memory in matches],
                "price_usd": store.setting("price_usd", None),
                "disclosure": "Only owner-approved derived context is available.",
            }
        elif name == "answer":
            limit = arguments.get("max_results", 5)
            if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 10:
                raise ValueError("max_results must be an integer from 1 to 10")
            matches = store.search(query, status="external", limit=limit)
            payload = {
                "answer_context": [
                    {
                        "title": memory.title,
                        "content": memory.content,
                        "provenance": {
                            "agent": memory.source,
                            "origin": memory.origin,
                            "project": memory.project,
                            "updated_at": memory.updated_at,
                        },
                    }
                    for memory in matches
                ],
                "disclosure": "Context is owner-approved; the caller should preserve provenance when synthesizing an answer.",
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
