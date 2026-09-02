"""A stand-in Lore node for the edge harness: answers MCP initialize and discover
with an empty catalog on the test network, so every approved publication reads
as not pushed yet. Prints its /mcp URL on the first line."""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MANIFEST = {"manifest_version": 1, "topics": {}, "network": "eip155:84532"}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        size = int(self.headers.get("Content-Length", "0"))
        message = json.loads(self.rfile.read(size))
        method = message["method"]
        if method == "notifications/initialized":
            self.send_response(202)
            self.end_headers()
            return
        result = (
            {"protocolVersion": "2025-06-18"}
            if method == "initialize"
            else {"content": [{"type": "text", "text": json.dumps(MANIFEST)}]}
        )
        body = json.dumps({"jsonrpc": "2.0", "id": message.get("id"), "result": result}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if method == "initialize":
            self.send_header("Mcp-Session-Id", "stub-session")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_: object) -> None:
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
print(f"http://127.0.0.1:{server.server_address[1]}/mcp", flush=True)
sys.stdout.close()
server.serve_forever()
