"""Tests for lore/cards.py (XC-039): what this machine sends to Lore's card
checkout Worker, and what the owner is told when the Worker can't answer.

No test in this file can reach the real checkout, where `POST /accounts` opens
a real Stripe account. `setUp` points both the `LORE_CHECKOUT_URL` override and
the built-in address at a local port nothing listens on; a test that needs an
answer serves one from a local HTTP server (as tests/test_feedback.py does), so
the method, path, headers and body on the wire are all real. Only the
network-level failures (refused, timed out) and the timeout argument itself are
checked through a patched `urlopen`.
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import subprocess
import threading
import unittest
import urllib.error
import urllib.parse
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from typing import Callable
from unittest.mock import patch

from helpers import LoreTestCase

from lore import cards, cli, feedback
from lore import deploy as deploy_module
from lore.store import JobStatus, Store

# Read before any test replaces it, so the shipped address is still checked.
SHIPPED_CHECKOUT_URL = cards.CHECKOUT_URL

ACCOUNT = "acct_1Seller"
TOKEN = "a" * 64
ORIGIN = "https://ada.workers.dev"
# What a careless query or form builder would mangle or split on.
AWKWARD_ACCOUNT = "acct 1&token=stolen"
AWKWARD_TOKEN = "t/k+n=&account=other#frag"

REFUSED = "Lore's card checkout refused that ({status}); try again later"
UNREACHABLE = "could not reach Lore's card checkout; check your connection"
UNREADABLE = "Lore's card checkout sent an answer Lore can't read; try again later"

# A 200 Lore can't use (XC-063), by name. Bytes are sent as they are; anything
# else as JSON. The cut-short body declares more than it sends.
UNREADABLE_ANSWERS: tuple[tuple[str, object, int | None], ...] = (
    ("html", b"<html><body>Just a moment...</body></html>", None),
    ("empty", b"", None),
    ("not utf-8", b"\xff\xfe\xfd", None),
    ("a list", [], None),
    ("null", None, None),
    ("a string", "ok", None),
    ("cut short", b'{"account": "acct_1', 100),
)
# Readable JSON objects that still don't name a new account and its token.
INCOMPLETE_ACCOUNTS: tuple[dict[str, object], ...] = (
    {},
    {"account": None, "token": None},
    {"account": ACCOUNT},
    {"token": TOKEN},
    {"account": "", "token": TOKEN},
    {"account": ACCOUNT, "token": ""},
    {"account": 1, "token": 2},
)

# Every call that reaches the checkout, by the name a failure should be read under.
CALLS: tuple[tuple[str, Callable[[], object]], ...] = (
    ("open_account", cards.open_account),
    ("status", lambda: cards.status(ACCOUNT, TOKEN)),
    ("bind", lambda: cards.bind(ACCOUNT, TOKEN, ORIGIN)),
)


@dataclass
class Seen:
    """One request as the checkout received it."""

    method: str
    target: str
    headers: dict[str, str]
    body: bytes

    @property
    def path(self) -> str:
        return urllib.parse.urlsplit(self.target).path

    @property
    def query(self) -> dict[str, list[str]]:
        return urllib.parse.parse_qs(
            urllib.parse.urlsplit(self.target).query, keep_blank_values=True
        )

    @property
    def form(self) -> dict[str, list[str]]:
        return urllib.parse.parse_qs(self.body.decode(), keep_blank_values=True)


class CheckoutStubCase(LoreTestCase):
    """A checkout nobody can reach, until a test serves one."""

    def setUp(self) -> None:
        super().setUp()
        # Bound but never listening: nothing answers there, and nothing else can
        # take the port while the test holds it.
        refusing = socket.socket()
        refusing.bind(("127.0.0.1", 0))
        self.addCleanup(refusing.close)
        self.nowhere = f"http://127.0.0.1:{refusing.getsockname()[1]}"
        for patcher in (
            patch.object(cards, "CHECKOUT_URL", self.nowhere),
            patch.dict(os.environ, {"LORE_CHECKOUT_URL": self.nowhere}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def serve(
        self, body: object, status: int = 200, length: int | None = None
    ) -> list[Seen]:
        """Stand in for the checkout: answer every request with `body` (bytes as
        they are, anything else as JSON), declaring `length` if given, and
        return the list each request is recorded into."""
        seen: list[Seen] = []

        class Handler(BaseHTTPRequestHandler):
            def reply(self) -> None:
                # Read the body before answering: an error reply sent over
                # unread data can reset the connection instead of arriving.
                size = int(self.headers.get("Content-Length", "0"))
                seen.append(
                    Seen(
                        self.command,
                        self.path,
                        {name.lower(): value for name, value in self.headers.items()},
                        self.rfile.read(size),
                    )
                )
                payload = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                # HTTP/1.0 (the default) closes after this, so a declared length
                # longer than the payload reaches the client as a cut-short body.
                declared = len(payload) if length is None else length
                self.send_header("Content-Length", str(declared))
                self.end_headers()
                self.wfile.write(payload)

            do_GET = reply
            do_POST = reply

            def log_message(self, *_: object) -> None:
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        # Polled often, so stopping each of these does not cost half a second.
        thread = threading.Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
        )
        thread.start()

        def stop() -> None:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

        self.addCleanup(stop)
        self.served = f"http://127.0.0.1:{server.server_address[1]}"
        here = patch.dict(os.environ, {"LORE_CHECKOUT_URL": self.served})
        here.start()
        self.addCleanup(here.stop)
        return seen


class CardCheckoutTest(CheckoutStubCase):
    def test_opening_an_account_posts_nothing_and_returns_it_with_its_token(
        self,
    ) -> None:
        seen = self.serve({"account": ACCOUNT, "token": TOKEN})
        self.assertEqual(cards.open_account(), (ACCOUNT, TOKEN))
        [request] = seen
        self.assertEqual((request.method, request.target), ("POST", "/accounts"))
        self.assertEqual(request.body, b"")

    def test_status_asks_about_one_account_and_says_ready_or_still_checking(
        self,
    ) -> None:
        answers: tuple[tuple[dict[str, bool], tuple[bool, bool]], ...] = (
            ({"ready": True, "checking": False}, (True, False)),
            ({"ready": False, "checking": True}, (False, True)),
            ({"ready": False, "checking": False}, (False, False)),
            # The checkout always sends both; an answer missing them is not ready.
            ({}, (False, False)),
        )
        for answer, expected in answers:
            with self.subTest(answer=answer):
                seen = self.serve(answer)
                self.assertEqual(cards.status(ACCOUNT, TOKEN), expected)
                [request] = seen
                self.assertEqual(
                    (request.method, request.path), ("GET", "/accounts/status")
                )
                self.assertEqual(
                    request.query, {"account": [ACCOUNT], "token": [TOKEN]}
                )
                self.assertEqual(request.body, b"")

    def test_status_sends_an_awkward_account_and_token_as_two_whole_values(
        self,
    ) -> None:
        seen = self.serve({"ready": False, "checking": False})
        cards.status(AWKWARD_ACCOUNT, AWKWARD_TOKEN)
        self.assertEqual(
            seen[0].query, {"account": [AWKWARD_ACCOUNT], "token": [AWKWARD_TOKEN]}
        )

    def test_bind_posts_the_account_its_token_and_the_store_as_a_form(self) -> None:
        seen = self.serve({"account": ACCOUNT, "origin": ORIGIN})
        self.assertIsNone(cards.bind(ACCOUNT, TOKEN, ORIGIN))
        [request] = seen
        # The whole target: the token travels in the body, never in the address.
        self.assertEqual((request.method, request.target), ("POST", "/accounts/bind"))
        # The checkout reads the body as a form, and gets nothing without this.
        self.assertEqual(
            request.headers["content-type"], "application/x-www-form-urlencoded"
        )
        self.assertEqual(
            request.form,
            {"account": [ACCOUNT], "token": [TOKEN], "origin": [ORIGIN]},
        )

    def test_bind_sends_awkward_values_as_three_whole_fields(self) -> None:
        seen = self.serve({})
        cards.bind(AWKWARD_ACCOUNT, AWKWARD_TOKEN, ORIGIN)
        self.assertEqual(
            seen[0].form,
            {
                "account": [AWKWARD_ACCOUNT],
                "token": [AWKWARD_TOKEN],
                "origin": [ORIGIN],
            },
        )

    def test_the_onboarding_link_goes_through_the_checkout_and_asks_it_nothing(
        self,
    ) -> None:
        seen = self.serve({})
        link = urllib.parse.urlsplit(
            cards.onboarding_url(AWKWARD_ACCOUNT, AWKWARD_TOKEN)
        )
        self.assertEqual(f"{link.scheme}://{link.netloc}", self.served)
        self.assertEqual(link.path, "/onboard")
        self.assertEqual(
            urllib.parse.parse_qs(link.query),
            {"account": [AWKWARD_ACCOUNT], "token": [AWKWARD_TOKEN]},
        )
        self.assertEqual(link.fragment, "")
        self.assertEqual(seen, [])

    def test_a_checkout_address_ending_in_a_slash_does_not_double_it(self) -> None:
        seen = self.serve({"account": ACCOUNT, "token": TOKEN})
        with patch.dict(os.environ, {"LORE_CHECKOUT_URL": f"{self.served}/"}):
            self.assertEqual(cards.checkout_url(), self.served)
            cards.open_account()
            link = cards.onboarding_url(ACCOUNT, TOKEN)
        self.assertEqual(seen[0].target, "/accounts")
        self.assertTrue(link.startswith(f"{self.served}/onboard?"), link)

    def test_without_an_override_calls_go_to_the_shipped_checkout(self) -> None:
        self.assertEqual(SHIPPED_CHECKOUT_URL, "https://checkout.yourlore.dev")
        with patch.dict(os.environ):
            del os.environ["LORE_CHECKOUT_URL"]
            # setUp swapped the built-in address for one that refuses, so this
            # shows the fallback is used without ever calling the real one.
            self.assertEqual(cards.checkout_url(), self.nowhere)

    def test_every_call_asks_for_json_and_names_lore(self) -> None:
        # Cloudflare refuses Python's default user agent with a 403 (error 1010).
        for name, call in CALLS:
            with self.subTest(call=name):
                seen = self.serve({"account": ACCOUNT, "token": TOKEN})
                call()
                [request] = seen
                self.assertEqual(request.headers["accept"], "application/json")
                self.assertEqual(request.headers["user-agent"], feedback.USER_AGENT)

    def test_a_refusal_from_the_checkout_is_reported_with_its_status(self) -> None:
        # The statuses the checkout's account routes really answer with.
        for status in (400, 403, 404, 502):
            for name, call in CALLS:
                with self.subTest(status=status, call=name):
                    self.serve({"error": "no"}, status)
                    with self.assertRaises(OSError) as raised:
                        call()
                    error = raised.exception
                    # HTTPError is already an OSError; callers are promised this one.
                    self.assertIs(type(error), OSError)
                    self.assertEqual(str(error), REFUSED.format(status=status))
                    cause = error.__cause__
                    self.assertIsInstance(cause, urllib.error.HTTPError)
                    self.addCleanup(cause.close)
                    self.assertEqual(cause.code, status)

    def test_an_unreachable_checkout_is_reported_as_a_connection_problem(self) -> None:
        refused = urllib.error.URLError(
            ConnectionRefusedError(61, "Connection refused")
        )
        for name, call in CALLS:
            with (
                self.subTest(call=name),
                patch("lore.cards.urllib.request.urlopen", side_effect=refused),
            ):
                with self.assertRaises(OSError) as raised:
                    call()
                error = raised.exception
                # URLError is already an OSError; callers are promised this one.
                self.assertIs(type(error), OSError)
                self.assertEqual(str(error), UNREACHABLE)
                self.assertIs(error.__cause__, refused)

    def test_a_checkout_that_stops_answering_is_reported_the_same_way(self) -> None:
        stalled = TimeoutError("timed out")
        for name, call in CALLS:
            with (
                self.subTest(call=name),
                patch("lore.cards.urllib.request.urlopen", side_effect=stalled),
            ):
                with self.assertRaises(OSError) as raised:
                    call()
                error = raised.exception
                self.assertIs(type(error), OSError)
                self.assertEqual(str(error), UNREACHABLE)
                self.assertIs(error.__cause__, stalled)

    def test_no_call_waits_on_the_checkout_for_more_than_a_minute(self) -> None:
        for name, call in CALLS:
            with (
                self.subTest(call=name),
                patch("lore.cards.urllib.request.urlopen") as urlopen,
            ):
                response = urlopen.return_value.__enter__.return_value
                response.read.return_value = json.dumps(
                    {"account": ACCOUNT, "token": TOKEN}
                ).encode()
                call()
                waited = urlopen.call_args.kwargs["timeout"]
                self.assertEqual(waited, cards.TIMEOUT_SECONDS)
                self.assertGreater(waited, 0)
                self.assertLessEqual(waited, 60)

    def test_an_unreadable_answer_is_reported_as_one_checkout_failure(self) -> None:
        for answer, body, length in UNREADABLE_ANSWERS:
            for name, call in CALLS:
                with self.subTest(answer=answer, call=name):
                    seen = self.serve(body, length=length)
                    with self.assertRaises(OSError) as raised:
                        call()
                    self.assertIs(type(raised.exception), OSError)
                    self.assertEqual(str(raised.exception), UNREADABLE)
                    self.assertEqual(len(seen), 1)

    def test_a_body_cut_short_in_transit_is_reported_as_unreadable(self) -> None:
        cut = http.client.IncompleteRead(b'{"acc', 40)
        for name, call in CALLS:
            with (
                self.subTest(call=name),
                patch("lore.cards.urllib.request.urlopen") as urlopen,
            ):
                urlopen.return_value.__enter__.return_value.read.side_effect = cut
                with self.assertRaises(OSError) as raised:
                    call()
                self.assertIs(type(raised.exception), OSError)
                self.assertEqual(str(raised.exception), UNREADABLE)
                self.assertIs(raised.exception.__cause__, cut)

    def test_a_checkout_that_hangs_up_without_answering_is_unreachable(self) -> None:
        # RemoteDisconnected is an HTTPException too, but no answer came at all.
        for hung_up in (
            http.client.RemoteDisconnected("closed without response"),
            ConnectionResetError(54, "Connection reset by peer"),
        ):
            for name, call in CALLS:
                with (
                    self.subTest(error=type(hung_up).__name__, call=name),
                    patch("lore.cards.urllib.request.urlopen", side_effect=hung_up),
                ):
                    with self.assertRaises(OSError) as raised:
                        call()
                    self.assertIs(type(raised.exception), OSError)
                    self.assertEqual(str(raised.exception), UNREACHABLE)
                    self.assertIs(raised.exception.__cause__, hung_up)

    def test_a_new_account_needs_both_an_account_and_its_token(self) -> None:
        for answer in INCOMPLETE_ACCOUNTS:
            with self.subTest(answer=answer):
                self.serve(answer)
                with self.assertRaises(OSError) as raised:
                    cards.open_account()
                self.assertIs(type(raised.exception), OSError)
                self.assertEqual(str(raised.exception), UNREADABLE)


class UnreadableCheckoutCommandTest(CheckoutStubCase):
    """What `lore cards`, `lore push` and `lore marketplace list` do with an
    unreadable checkout answer (XC-063). These drive cli.py and marketplace.py
    from here, not from test_cli.py or test_marketplace.py, which open PRs were
    changing when this was written; nothing in those modules changed for it."""

    def run_cli(self, *argv: str) -> tuple[int, str, str]:
        out, err = StringIO(), StringIO()
        with (
            patch.object(cli, "_owner_action"),
            redirect_stdout(out),
            redirect_stderr(err),
        ):
            code = cli.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def settings(self, *names: str) -> list[object]:
        with Store() as store:
            return [store.setting(name, None) for name in names]

    def test_connect_says_one_line_and_keeps_no_account(self) -> None:
        answers = [
            (answer, body, length) for answer, body, length in UNREADABLE_ANSWERS
        ]
        answers += [(json.dumps(body), body, None) for body in INCOMPLETE_ACCOUNTS]
        for answer, body, length in answers:
            for as_json in (False, True):
                with self.subTest(answer=answer, json=as_json):
                    seen = self.serve(body, length=length)
                    argv = ["cards", "connect"] + (["--json"] if as_json else [])
                    code, out, err = self.run_cli(*argv)
                    self.assertEqual(code, 1)
                    self.assertEqual(out, "")
                    self.assertEqual(err.splitlines(), [f"lore: {UNREADABLE}"])
                    self.assertEqual(
                        self.settings(
                            cli.STRIPE_PENDING_SETTING, cli.STRIPE_TOKEN_SETTING
                        ),
                        [None, None],
                    )
                    self.assertEqual(len(seen), 1)

    def test_the_card_state_the_app_polls_says_ready_unknown(self) -> None:
        with Store() as store:
            store.set_setting(cli.STRIPE_PENDING_SETTING, ACCOUNT)
            store.set_setting(cli.STRIPE_TOKEN_SETTING, TOKEN)
        for answer, body, length in UNREADABLE_ANSWERS:
            with self.subTest(answer=answer):
                seen = self.serve(body, length=length)
                code, out, err = self.run_cli("cards", "--json")
                self.assertEqual(code, 0)
                self.assertEqual(err, "")
                self.assertEqual(
                    json.loads(out),
                    {
                        "account": "",
                        "pending": ACCOUNT,
                        "ready": None,
                        "checking": False,
                        "minimum_usd": cli.CARD_MINIMUM_USD,
                    },
                )
                self.assertEqual(seen[0].path, "/accounts/status")

    def a_store_taking_cards(self) -> None:
        # store_folder() is the worker folder `lore marketplace list` pushes from.
        self.store.mkdir(parents=True, exist_ok=True)
        (self.store / "wrangler.jsonc").write_text("{}")
        with Store() as store:
            store.set_setting(deploy_module.SELLING_SETTING, True)
            store.set_setting(cli.STRIPE_ACCOUNT_SETTING, ACCOUNT)
            store.set_setting(cli.STRIPE_TOKEN_SETTING, TOKEN)
            store.set_setting("node_url", "https://ada.workers.dev/mcp")
            store.set_setting("revocation_pending", True)
            store.set_setting("publish_pending", True)

    def test_a_push_whose_bind_is_unreadable_still_succeeds(self) -> None:
        self.a_store_taking_cards()
        wrote = subprocess.CompletedProcess(("wrangler",), 0)
        for answer, body, length in UNREADABLE_ANSWERS:
            with self.subTest(answer=answer):
                with Store() as store:
                    store.set_setting("revocation_pending", True)
                    store.set_setting("publish_pending", True)
                seen = self.serve(body, length=length)
                out, err = StringIO(), StringIO()
                with (
                    patch.object(cli, "_owner_action"),
                    patch("subprocess.run", return_value=wrote),
                    redirect_stdout(out),
                    redirect_stderr(err),
                ):
                    code = cli.push(str(self.store))
                self.assertEqual(code, 0)
                self.assertEqual(
                    [(r.method, r.path) for r in seen], [("POST", "/accounts/bind")]
                )
                self.assertIn(
                    "Buyers can't pay by card until the next push", err.getvalue()
                )
                self.assertIn(UNREADABLE, err.getvalue())
                with Store() as store:
                    self.assertIs(store.recent_jobs()[0].status, JobStatus.SUCCEEDED)
                self.assertEqual(
                    self.settings("revocation_pending", "publish_pending"),
                    [False, False],
                )

    def test_listing_keeps_its_name_when_the_bind_is_unreadable(self) -> None:
        self.a_store_taking_cards()
        wrote = subprocess.CompletedProcess(("wrangler",), 0)
        for answer, body, length in UNREADABLE_ANSWERS:
            with self.subTest(answer=answer):
                seen = self.serve(body, length=length)
                name = f"Ada {answer}"
                with patch("subprocess.run", return_value=wrote):
                    code, _out, err = self.run_cli(
                        "marketplace", "list", "--name", name
                    )
                self.assertEqual(code, 0, err)
                self.assertEqual(
                    [(r.method, r.path) for r in seen], [("POST", "/accounts/bind")]
                )
                self.assertEqual(self.settings("listed_name"), [name])


if __name__ == "__main__":
    unittest.main()
