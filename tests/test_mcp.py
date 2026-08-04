"""Tests for `lore.mcp` — the only surface anything outside this machine can read.

Every test here is really one assertion in two parts: an active publication is
reachable, and nothing else is. The transport tests exist because the HTTP path
is where an unauthenticated caller would arrive.

The tool surface is `discover` (free manifest of teasers grouped by topic) and
`get` (fetch one publication by its opaque public id). There is no server-side
search: a buyer reads the whole catalog and chooses.
"""

from __future__ import annotations

import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager, redirect_stderr
from io import StringIO
from typing import Iterator
from unittest.mock import patch

from helpers import LoreTestCase, captured

from lore import mcp
from lore.store import Store, new_public_id


def _request(method: str, **params: object) -> dict:
    message = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params:
        message["params"] = params
    return message


@contextmanager
def _serving(token: str | None = None) -> Iterator[str]:
    """Run the real HTTP transport on an ephemeral port and yield its base URL."""
    started = threading.Event()
    servers: list[object] = []
    real_server = mcp.ThreadingHTTPServer

    def factory(address, handler):  # type: ignore[no-untyped-def]
        server = real_server(address, handler)
        servers.append(server)
        started.set()
        return server

    errors: list[BaseException] = []

    def run() -> None:
        try:
            with (
                redirect_stderr(StringIO()),
                patch.object(mcp, "ThreadingHTTPServer", factory),
            ):
                mcp.http("127.0.0.1", 0, token)
        except BaseException as error:  # surfaced after the join below
            errors.append(error)
            started.set()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    started.wait(timeout=5)
    if errors:
        raise errors[0]
    server = servers[0]
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"  # type: ignore[attr-defined]
    finally:
        server.shutdown()  # type: ignore[attr-defined]
        thread.join(timeout=5)


def _post(url: str, body: bytes, headers: dict[str, str] | None = None):
    request = urllib.request.Request(
        url, data=body, headers=headers or {}, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


class DispatchTest(LoreTestCase):
    def test_initialize_negotiates_a_protocol_version(self) -> None:
        supported = mcp.dispatch(_request("initialize", protocolVersion="2025-06-18"))
        self.assertEqual(supported["result"]["protocolVersion"], "2025-06-18")
        # An unknown version is answered with ours rather than refused.
        unknown = mcp.dispatch(_request("initialize", protocolVersion="1999-01-01"))
        self.assertEqual(unknown["result"]["protocolVersion"], mcp.PROTOCOL_VERSION)
        self.assertEqual(unknown["result"]["serverInfo"]["name"], "lore")
        self.assertIn("discover", unknown["result"]["instructions"])

    def test_ping_and_tools_list(self) -> None:
        self.assertEqual(mcp.dispatch(_request("ping"))["result"], {})
        tools = mcp.dispatch(_request("tools/list"))["result"]["tools"]
        self.assertEqual([tool["name"] for tool in tools], ["discover", "get"])
        for tool in tools:
            with self.subTest(tool=tool["name"]):
                self.assertFalse(tool["inputSchema"]["additionalProperties"])
                self.assertTrue(tool["annotations"]["readOnlyHint"])

    def test_a_notification_gets_no_response(self) -> None:
        self.assertIsNone(
            mcp.dispatch({"jsonrpc": "2.0", "method": "notifications/initialized"})
        )

    def test_malformed_requests_are_refused_before_any_store_access(self) -> None:
        for message in (
            [],
            "a string",
            {"jsonrpc": "1.0", "id": 1, "method": "ping"},
            {"jsonrpc": "2.0", "id": 1, "method": 7},
            {"jsonrpc": "2.0", "id": 1},
        ):
            with self.subTest(message=message):
                self.assertEqual(mcp.dispatch(message)["error"]["code"], -32600)

    def test_an_unknown_method_and_bad_params_report_their_own_codes(self) -> None:
        self.assertEqual(mcp.dispatch(_request("tools/kick"))["error"]["code"], -32601)
        bad_params = mcp.dispatch(
            {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": []}
        )
        self.assertEqual(bad_params["error"]["code"], -32602)
        invalid_tool = mcp.dispatch(
            _request("tools/call", name="publish", arguments={})
        )
        self.assertEqual(invalid_tool["error"]["code"], -32602)

    def test_an_unexpected_failure_becomes_an_opaque_internal_error(self) -> None:
        # Implementation detail in a remote response is an information leak; the
        # detail belongs on the owner's stderr instead.
        errors = StringIO()
        with (
            patch(
                "lore.mcp.call_tool",
                side_effect=RuntimeError("db path /home/ada/.lore"),
            ),
            redirect_stderr(errors),
        ):
            response = mcp.dispatch(
                _request("tools/call", name="discover", arguments={})
            )
        self.assertEqual(
            response["error"], {"code": -32603, "message": "internal error"}
        )
        self.assertIn("/home/ada/.lore", errors.getvalue())


class CallToolTest(LoreTestCase):
    def _text(self, name: str, **arguments: object) -> str:
        return mcp.call_tool(name, arguments)["content"][0]["text"]

    def _publish(self, **overrides: object) -> str:
        with Store() as store:
            defaults = dict(
                title="Deployment guide",
                content="secret guidance body",
                topic="ops",
                teaser="How this node deploys things",
                provenance=[self.seed_memory("Ops lesson")],
            )
            row_id = store.add_publication(**(defaults | overrides))
            return next(
                p.public_id for p in store.list_publications() if p.id == row_id
            )

    def test_discover_reports_teasers_grouped_by_topic_and_the_price(self) -> None:
        with Store() as store:
            store.set_setting("price_usd", 2.0)
        public_id = self._publish()
        payload = json.loads(self._text("discover"))
        self.assertEqual(payload["publication_count"], 1)
        self.assertEqual(payload["price_usd"], 2.0)
        entry = payload["topics"]["ops"][0]
        self.assertEqual(entry["id"], public_id)
        self.assertEqual(entry["teaser"], "How this node deploys things")
        # Discovery is free, so it must not give the answer away.
        self.assertNotIn("secret guidance body", self._text("discover"))
        self.assertNotIn("Deployment guide", self._text("discover"))

    def test_discover_reports_no_price_and_an_empty_catalog_when_unset(self) -> None:
        payload = json.loads(self._text("discover"))
        self.assertEqual(payload["publication_count"], 0)
        self.assertEqual(payload["topics"], {})
        self.assertIsNone(payload["price_usd"])

    def test_get_fetches_exactly_the_chosen_publication(self) -> None:
        public_id = self._publish()
        payload = json.loads(self._text("get", id=public_id))["publication"]
        self.assertEqual(payload["id"], public_id)
        self.assertEqual(payload["title"], "Deployment guide")
        self.assertEqual(payload["content"], "secret guidance body")
        self.assertEqual(payload["topic"], "ops")

    def test_a_damaged_or_unknown_id_is_rejected_before_any_content_reaches_the_caller(
        self,
    ) -> None:
        public_id = self._publish()
        damaged = ("0" if public_id[0] != "0" else "1") + public_id[1:]
        with self.assertRaisesRegex(ValueError, "run discover again"):
            mcp.call_tool("get", {"id": damaged})
        with self.assertRaisesRegex(ValueError, "not found"):
            mcp.call_tool("get", {"id": new_public_id()})  # well-formed, never minted

    def test_buyer_payloads_never_disclose_private_memory_ids(self) -> None:
        # Provenance is owner-visible; buyers must not learn the ids or the
        # number of private rows behind a publication — from either tool.
        memory_ids = [self.seed_memory(f"Private source {index}") for index in range(3)]
        public_id = self._publish(provenance=memory_ids)
        entry = json.loads(self._text("discover"))["topics"]["ops"][0]
        self.assertEqual(set(entry), {"id", "teaser", "kind", "updated_at"})
        publication = json.loads(self._text("get", id=public_id))["publication"]
        self.assertEqual(
            set(publication), {"id", "title", "content", "topic", "kind", "updated_at"}
        )

    def test_mcp_reads_only_active_publications_never_memories(self) -> None:
        # Memories of every disclosure status must be unreachable from MCP.
        self.seed_memory("Discarded memory", "discarded")
        self.seed_memory("Private memory", "private")
        active_id = self._publish()
        with Store() as store:
            revoked_row = store.add_publication(
                title="Old deployment note",
                content="stale deployment text",
                topic="deployment",
                teaser="An older deployment lesson",
                provenance=[self.seed_memory("Ops lesson 2")],
            )
            revoked_public_id = next(
                p.public_id for p in store.list_publications() if p.id == revoked_row
            )
            store.revoke_publication(revoked_row)
        manifest_text = self._text("discover")
        self.assertIn("How this node deploys things", manifest_text)
        self.assertNotIn("Discarded memory", manifest_text)
        self.assertNotIn("Private memory", manifest_text)
        self.assertNotIn(
            "An older deployment lesson", manifest_text
        )  # revoked excluded
        content_text = self._text("get", id=active_id)
        self.assertIn("Deployment guide", content_text)
        self.assertNotIn("Private memory", content_text)
        with self.assertRaisesRegex(ValueError, "not found"):
            mcp.call_tool(
                "get", {"id": revoked_public_id}
            )  # revoked content unreachable
        # Revoking the last active publication removes it from MCP immediately:
        # the manifest is a live view, never a stale artifact.
        with Store() as store:
            active_row = next(
                p.id for p in store.list_publications() if p.public_id == active_id
            )
            store.revoke_publication(active_row)
        self.assertEqual(json.loads(self._text("discover"))["publication_count"], 0)
        with self.assertRaisesRegex(ValueError, "not found"):
            mcp.call_tool("get", {"id": active_id})

    def test_tool_inputs_are_validated_before_the_store_is_opened(self) -> None:
        for name, arguments, error in (
            ("publish", {}, ValueError),  # no write tool exists
            ("get", "not a dict", ValueError),
            ("get", {}, ValueError),  # id is required
            ("get", {"id": 1}, ValueError),  # ids are opaque strings
            ("get", {"id": True}, ValueError),
            ("get", {"id": "  "}, ValueError),
            ("get", {"id": "x", "extra": 1}, ValueError),
            ("discover", {"extra": 1}, ValueError),
        ):
            with self.subTest(name=name, arguments=arguments):
                with self.assertRaises(error):
                    mcp.call_tool(name, arguments)


class StdioTest(LoreTestCase):
    def test_stdio_answers_line_by_line_and_survives_bad_json(self) -> None:
        lines = "\n".join(
            [
                json.dumps(_request("ping")),
                "{not json",
                json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
                json.dumps(_request("tools/list")),
            ]
        )
        with patch.object(sys, "stdin", StringIO(lines)), captured() as output:
            self.assertEqual(mcp.stdio(), 0)
        responses = [json.loads(line) for line in output.getvalue().splitlines()]
        # Three in, three out: the notification is silently skipped.
        self.assertEqual(len(responses), 3)
        self.assertEqual(responses[0]["result"], {})
        self.assertEqual(responses[1]["error"]["code"], -32700)
        self.assertIn("tools", responses[2]["result"])


class HttpTest(LoreTestCase):
    def test_remote_binding_requires_authentication(self) -> None:
        with self.assertRaisesRegex(ValueError, "requires --token"):
            mcp.http("0.0.0.0", 0)

    def test_health_and_the_refused_sse_listen(self) -> None:
        with _serving() as base:
            with urllib.request.urlopen(f"{base}/health", timeout=5) as response:
                self.assertEqual(json.loads(response.read())["status"], "ok")
                self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                self.assertEqual(response.headers["Cache-Control"], "no-store")
            try:
                urllib.request.urlopen(f"{base}/mcp", timeout=5)
                self.fail("GET /mcp should not be served")
            except urllib.error.HTTPError as error:
                self.assertEqual(error.code, 405)

    def test_posting_to_the_wrong_path_is_a_404(self) -> None:
        with _serving() as base:
            status, _ = _post(f"{base}/rpc", json.dumps(_request("ping")).encode())
        self.assertEqual(status, 404)

    def test_a_request_is_dispatched_and_a_notification_is_accepted(self) -> None:
        with _serving() as base:
            status, body = _post(f"{base}/mcp", json.dumps(_request("ping")).encode())
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["result"], {})
            status, _ = _post(
                f"{base}/mcp",
                json.dumps(
                    {"jsonrpc": "2.0", "method": "notifications/initialized"}
                ).encode(),
            )
            self.assertEqual(status, 202)

    def test_malformed_and_oversized_bodies_are_rejected(self) -> None:
        with _serving() as base:
            status, body = _post(f"{base}/mcp", b"{not json")
            self.assertEqual(status, 400)
            self.assertEqual(json.loads(body)["error"]["code"], -32700)
            # A zero-length body would otherwise read nothing and dispatch null.
            status, _ = _post(f"{base}/mcp", b"")
            self.assertEqual(status, 400)

    def test_ctrl_c_closes_the_listening_socket(self) -> None:
        # Leaving the port bound after Ctrl-C means the owner's next
        # `lore serve` fails with "address already in use".
        closed: list[bool] = []
        real_server = mcp.ThreadingHTTPServer

        def factory(address, handler):  # type: ignore[no-untyped-def]
            server = real_server(address, handler)
            server.serve_forever = lambda *_, **__: (_ for _ in ()).throw(
                KeyboardInterrupt
            )
            original_close = server.server_close
            server.server_close = lambda: (closed.append(True), original_close())[1]
            return server

        with (
            patch.object(mcp, "ThreadingHTTPServer", factory),
            redirect_stderr(StringIO()),
        ):
            self.assertEqual(mcp.http("127.0.0.1", 0), 0)
        self.assertEqual(closed, [True])

    def test_a_token_is_required_and_compared_in_full(self) -> None:
        with _serving("s3cret") as base:
            body = json.dumps(_request("ping")).encode()
            for headers, expected in (
                ({}, 401),
                ({"Authorization": "Bearer wrong"}, 401),
                ({"Authorization": "Bearer s3cre"}, 401),  # a prefix is not a match
                ({"Authorization": "s3cret"}, 401),  # the scheme is part of it
                ({"Authorization": "Bearer s3cret"}, 200),
            ):
                with self.subTest(headers=headers):
                    status, _ = _post(f"{base}/mcp", body, headers)
                    self.assertEqual(status, expected)


class MainTest(LoreTestCase):
    def test_main_selects_the_transport(self) -> None:
        with patch.object(sys, "stdin", StringIO("")), captured():
            self.assertEqual(mcp.main([]), 0)
        with patch("lore.mcp.http", return_value=0) as serve:
            self.assertEqual(
                mcp.main(
                    [
                        "--transport",
                        "http",
                        "--host",
                        "0.0.0.0",
                        "--port",
                        "9",
                        "--token",
                        "t",
                    ]
                ),
                0,
            )
        self.assertEqual(serve.call_args.args, ("0.0.0.0", 9, "t"))

    def test_the_token_falls_back_to_the_environment(self) -> None:
        with (
            patch.dict("os.environ", {"LORE_MCP_TOKEN": "from-env"}),
            patch("lore.mcp.http", return_value=0) as serve,
        ):
            mcp.main(["--transport", "http"])
        self.assertEqual(serve.call_args.args[2], "from-env")


if __name__ == "__main__":
    unittest.main()
