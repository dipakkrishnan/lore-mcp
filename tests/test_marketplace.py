"""Tests for lore/marketplace.py (APP-119): listing a store on the public
marketplace through the relay, from both `lore marketplace` and the Desktop
app's Settings card.

No test makes a real network call. `submit()` and `status()` run against a
local HTTP server so headers, encoding, and status handling are real.
"""

from __future__ import annotations

import json
import threading
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from pathlib import Path
from typing import Iterator
from unittest.mock import patch

from helpers import LoreTestCase

from lore import blueprint, cli, feedback, marketplace
from lore.store import Store

CONTRACT_PATH = (
    Path(__file__).resolve().parent.parent / "contracts" / "marketplace_listing.json"
)
NODE = "https://lore.example.workers.dev/mcp"
SECRET = "ab" * 32


@contextmanager
def stub_relay(
    status: int, body: object
) -> Iterator[tuple[str, list[tuple[str, str, dict[str, object]]]]]:
    """Serve one canned response; record (method, path, body) of each request."""
    received: list[tuple[str, str, dict[str, object]]] = []

    class Handler(BaseHTTPRequestHandler):
        def _answer(self) -> None:
            size = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(size)
            received.append((self.command, self.path, json.loads(raw) if raw else {}))
            payload = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        do_POST = _answer
        do_GET = _answer

        def log_message(self, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/listing", received
    finally:
        server.shutdown()
        server.server_close()


class ContractTest(unittest.TestCase):
    def test_matches_the_shared_contract(self) -> None:
        contract = json.loads(CONTRACT_PATH.read_text())
        self.assertEqual(contract["listing_version"], marketplace.LISTING_VERSION)
        self.assertEqual(contract["registry"], marketplace.REGISTRY)
        self.assertEqual(contract["limits"]["name"]["max"], marketplace.MAX_NAME)
        self.assertEqual(contract["limits"]["body_bytes"], marketplace.MAX_BODY_BYTES)
        self.assertEqual(contract["node_pattern"], marketplace.NODE_RE.pattern)
        self.assertEqual(contract["secret_pattern"], marketplace.SECRET_RE.pattern)
        self.assertEqual(contract["actions"], ["list", "delist"])
        self.assertEqual(contract["states"], ["none", "pending", "listed"])


class AvailabilityTest(LoreTestCase):
    def test_follows_the_feedback_relay_pin(self) -> None:
        with patch.dict("os.environ", {}, clear=False):
            for key in (feedback.RELAY_ENV, marketplace.LISTING_ENV):
                self.env_pop(key)
            with patch.object(feedback, "RELAY_URL", None):
                self.assertFalse(marketplace.available())
            with patch.object(feedback, "RELAY_URL", "https://relay.example/report"):
                self.assertTrue(marketplace.available())
                self.assertEqual(
                    marketplace.listing_url(), "https://relay.example/listing"
                )

    def test_the_override_wins(self) -> None:
        with patch.dict(
            "os.environ", {marketplace.LISTING_ENV: "http://127.0.0.1:1/listing"}
        ):
            self.assertEqual(marketplace.listing_url(), "http://127.0.0.1:1/listing")

    def env_pop(self, key: str) -> None:
        import os

        os.environ.pop(key, None)


class BuildTest(LoreTestCase):
    def _node(self) -> None:
        with Store() as store:
            store.set_setting("node_url", NODE)

    def test_refuses_without_a_store(self) -> None:
        with self.assertRaisesRegex(ValueError, "open your store"):
            marketplace.build("list", name="Me")

    def test_the_name_defaults_to_the_blueprint(self) -> None:
        self._node()
        blueprint.blueprint_path().parent.mkdir(parents=True, exist_ok=True)
        blueprint.blueprint_path().write_text(json.dumps({"name": "Ada"}))
        listing = marketplace.build("list")
        self.assertEqual(listing.name, "Ada")
        self.assertEqual(listing.node, NODE)
        self.assertIsNone(listing.secret)

    def test_a_missing_name_is_a_plain_error(self) -> None:
        self._node()
        with self.assertRaisesRegex(ValueError, "display name"):
            marketplace.build("list")

    def test_the_name_is_cleaned_and_capped(self) -> None:
        self._node()
        self.assertEqual(marketplace.build("list", name=" A\x00da ").name, "Ada")
        with self.assertRaisesRegex(ValueError, "over 80"):
            marketplace.build("list", name="x" * 81)

    def test_delisting_needs_the_secret_this_mac_was_given(self) -> None:
        self._node()
        with self.assertRaisesRegex(ValueError, "not listed from this Mac"):
            marketplace.build("delist")
        with Store() as store:
            store.set_setting("listing_secret", SECRET)
        listing = marketplace.build("delist")
        self.assertEqual(listing.secret, SECRET)
        self.assertIsNone(listing.name)

    def test_a_list_sends_the_saved_secret_so_a_rename_is_authorized(self) -> None:
        self._node()
        self.assertIsNone(marketplace.build("list", name="Ada").secret)
        with Store() as store:
            store.set_setting("listing_secret", SECRET)
        listing = marketplace.build("list", name="Ada")
        self.assertEqual(listing.secret, SECRET)
        self.assertEqual(listing.name, "Ada")


class SubmitTest(LoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        with Store() as store:
            store.set_setting("node_url", NODE)

    def test_listing_posts_only_the_request_and_keeps_the_secret(self) -> None:
        with stub_relay(
            201,
            {
                "ok": True,
                "state": "pending",
                "action": "list",
                "pull_url": "https://github.com/x/pull/1",
                "pull_number": 1,
                "secret": SECRET,
            },
        ) as (url, received):
            receipt = marketplace.submit(marketplace.build("list", name="Ada"), url=url)
        self.assertEqual(receipt.state, "pending")
        self.assertEqual(receipt.pull_number, 1)
        method, path, body = received[0]
        self.assertEqual((method, path), ("POST", "/listing"))
        # The client sends what it wants, never the entry: the relay builds
        # that from the node's own discover.
        self.assertEqual(
            body, {"listing_version": 1, "action": "list", "node": NODE, "name": "Ada"}
        )
        with Store() as store:
            self.assertEqual(store.setting("listing_secret"), SECRET)

    def test_a_refusal_carries_the_relays_words(self) -> None:
        with stub_relay(400, {"error": "your store did not answer"}) as (url, _):
            with self.assertRaisesRegex(ValueError, "your store did not answer"):
                marketplace.submit(marketplace.build("list", name="Ada"), url=url)

    def test_a_server_failure_is_an_oserror(self) -> None:
        with stub_relay(502, {"error": "could not open the pull request"}) as (
            url,
            _,
        ):
            with self.assertRaisesRegex(OSError, "could not open"):
                marketplace.submit(marketplace.build("list", name="Ada"), url=url)

    def test_status_is_a_get_with_the_node_in_the_query(self) -> None:
        with stub_relay(200, {"ok": True, "state": "listed"}) as (url, received):
            receipt = marketplace.status(url=url)
        self.assertEqual(receipt.state, "listed")
        method, path, _ = received[0]
        self.assertEqual(method, "GET")
        self.assertIn("node=https%3A%2F%2Flore.example.workers.dev%2Fmcp", path)

    def test_an_unknown_state_is_unreadable(self) -> None:
        with stub_relay(200, {"ok": True, "state": "weird"}) as (url, _):
            with self.assertRaisesRegex(ValueError, "unreadable"):
                marketplace.status(url=url)


class CliTest(LoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        with Store() as store:
            store.set_setting("node_url", NODE)

    def test_json_output_never_includes_the_secret(self) -> None:
        with stub_relay(
            201,
            {
                "ok": True,
                "state": "pending",
                "action": "list",
                "pull_url": "https://github.com/x/pull/2",
                "pull_number": 2,
                "secret": SECRET,
            },
        ) as (url, _):
            out = StringIO()
            with (
                patch.dict("os.environ", {marketplace.LISTING_ENV: url}),
                patch.object(cli, "_owner_action"),
                patch("sys.stdout", out),
            ):
                code = cli.main(["marketplace", "list", "--name", "Ada", "--json"])
        self.assertEqual(code, 0)
        printed = json.loads(out.getvalue())
        self.assertEqual(printed["state"], "pending")
        self.assertEqual(printed["pull_number"], 2)
        self.assertNotIn("secret", printed)
        self.assertNotIn(SECRET, out.getvalue())

    def test_status_needs_no_attended_surface(self) -> None:
        with stub_relay(200, {"ok": True, "state": "none"}) as (url, _):
            out = StringIO()
            with (
                patch.dict("os.environ", {marketplace.LISTING_ENV: url}),
                patch("sys.stdout", out),
            ):
                code = cli.main(["marketplace", "status", "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue()), {"ok": True, "state": "none"})

    def test_listing_is_an_owner_action(self) -> None:
        err = StringIO()
        with (
            patch.dict("os.environ", {marketplace.LISTING_ENV: "http://127.0.0.1:1/l"}),
            patch("sys.stderr", err),
            patch("sys.stdin") as stdin,
        ):
            stdin.isatty.return_value = False
            code = cli.main(["marketplace", "list", "--name", "Ada", "--json"])
        self.assertEqual(code, 1)
        self.assertIn("attended terminal", err.getvalue())


if __name__ == "__main__":
    unittest.main()
