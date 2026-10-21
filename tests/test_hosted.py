"""Tests for the `mcp` source kind: apps Lore signs in to, like Granola.

Every server is a stub run in-process through the SDK, and every sign-in is kept in
a fake keyring: nothing here touches the network or the owner's Keychain.
"""

from __future__ import annotations

import io
import json
import threading
import unittest
import urllib.request
from contextlib import asynccontextmanager, redirect_stderr
from http.client import HTTPConnection
from typing import AsyncIterator
from unittest.mock import patch

import anyio
from fixtures.granola import Granola
from helpers import LoreTestCase
from mcp import Client
from mcp.client.auth import OAuthFlowError
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from lore import sources as sources_module
from lore.signin import Keychain, Loopback
from lore.sources import HostedReader, Notion, Readwise, Registry, SourceError
from lore.store import Store


def serving(stub: MCPServer):  # type: ignore[no-untyped-def]
    """Answer every hosted read from `stub`, in-process, whatever server it names."""

    @asynccontextmanager
    async def connect(self: HostedReader, auth: object) -> AsyncIterator[Client]:
        async with Client(stub) as client:
            yield client

    return patch.object(HostedReader, "connect", connect)


def failing(error: Exception):  # type: ignore[no-untyped-def]
    """Fail every hosted read the way the SDK does: from inside a task group."""

    async def fail() -> None:
        raise error

    @asynccontextmanager
    async def connect(self: HostedReader, auth: object) -> AsyncIterator[Client]:
        async with anyio.create_task_group() as group:
            group.start_soon(fail)
        yield Client(MCPServer("unreached"))

    return patch.object(HostedReader, "connect", connect)


class HostedTest(LoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.granola = Granola()

    def connect(self, **options: object) -> dict[str, object]:
        with Store() as store:
            return Registry(store).connect("granola", **options)  # type: ignore[arg-type]

    def test_meetings_import_as_private_memories_with_their_titles_and_days(
        self,
    ) -> None:
        with serving(self.granola.server):
            added = self.connect()
        self.assertEqual(
            (added["label"], added["kind"], added["state"], added["imported"]),
            ("Granola", "mcp", "connected", 2),
        )
        self.assertEqual(added["locator"], "https://mcp.granola.ai/mcp")
        with Store() as store:
            kept = {m.title: m for m in store.search("", status="private")}
        self.assertEqual(set(kept), {"Pricing review", "Hiring <> Ops sync"})
        pricing = kept["Pricing review"].content
        self.assertTrue(pricing.startswith("Raise the first tier"), pricing)
        self.assertIn("Agreed next steps.", pricing)
        self.assertNotIn("owner@example.com", pricing)

    def test_a_sync_reads_only_what_it_has_not_kept(self) -> None:
        with serving(self.granola.server):
            added = self.connect()
            with Store() as store:
                read = Registry(store).read([str(added["name"])])
        self.assertEqual(sorted(self.granola.read), ["m-1", "m-2"])
        self.assertEqual((read[0]["added"], read[0]["state"]), (0, "connected"))

    def test_a_renamed_tool_is_the_apps_failure_not_a_silent_empty_read(self) -> None:
        stub = MCPServer("granola")

        @stub.tool()
        def list_meetings() -> str:
            return '<meeting id="m-1" title="Kept" date=""></meeting>'

        with serving(stub):
            added = self.connect()
        self.assertEqual((added["state"], added["imported"]), ("unreachable", 0))

    def test_signing_in_without_a_granola_account_says_so(self) -> None:
        stub = MCPServer("granola")

        @stub.tool()
        def list_meetings(time_range: str = "last_30_days") -> str:
            raise ToolError("Unauthorized: user has not created a Granola account yet")

        @stub.tool()
        def get_meetings(meeting_ids: list[str]) -> str:
            return ""

        with (
            serving(stub),
            self.assertRaisesRegex(SourceError, "don't have a Granola account yet"),
        ):
            self.connect(show=print)

    def test_a_sign_in_that_ran_out_asks_for_another(self) -> None:
        with serving(self.granola.server):
            added = self.connect()
        with failing(OAuthFlowError("no redirect handler")), Store() as store:
            read = Registry(store).read([str(added["name"])])
        self.assertEqual(read[0]["state"], "needs_permission")
        with failing(OSError("offline")), Store() as store:
            read = Registry(store).read([str(added["name"])])
        self.assertEqual(read[0]["state"], "unreachable")

    def test_signing_in_starts_clean_and_then_reads(self) -> None:
        server = "https://mcp.granola.ai/mcp"
        self.keyring.set_password("Lore", f"{server} tokens", "stale")
        with serving(self.granola.server):
            added = self.connect(show=print)
        self.assertEqual(added["imported"], 2)
        self.assertNotIn(("Lore", f"{server} tokens"), self.keyring.saved)

    def test_disconnecting_forgets_the_sign_in(self) -> None:
        with serving(self.granola.server):
            added = self.connect()
        self.keyring.set_password("Lore", f"{added['locator']} tokens", "live")
        with Store() as store:
            Registry(store).remove(str(added["name"]), delete=False)
        self.assertEqual(self.keyring.saved, {})

    def test_signing_in_again_to_the_same_account_reads_it_again(self) -> None:
        with serving(self.granola.server):
            self.connect()
        with failing(OSError("offline")), Store() as store:
            registry = Registry(store)
            registry.read()
        with serving(self.granola.server):
            again = self.connect(show=print)
        self.assertEqual(again["state"], "connected")

    def test_signing_in_refuses_an_app_that_changed_its_tools(self) -> None:
        stub = MCPServer("granola")

        @stub.tool()
        def list_meetings() -> str:
            return ""

        with (
            serving(stub),
            self.assertRaisesRegex(SourceError, "changed how it shares"),
        ):
            self.connect(show=print)
        with (
            failing(OAuthFlowError("access_denied")),
            self.assertRaisesRegex(SourceError, "didn't let Lore in"),
        ):
            self.connect(show=print)
        with Store() as store:
            self.assertEqual(Registry(store).owned, [])

    def test_the_catalog_offers_each_hosted_app_as_a_sign_in(self) -> None:
        apps = {app.id: app for app in sources_module.Connector.catalog()}
        for app in ("granola", "notion", "readwise"):
            self.assertEqual((apps[app].kind, apps[app].refresh), ("mcp", True))


class HostedAppsTest(unittest.TestCase):
    def test_notion_pages_through_search_slowly_and_reads_page_text(self) -> None:
        stub = MCPServer("notion")
        asked: list[dict[str, object]] = []

        @stub.tool(name="notion-search")
        def search(
            query: str, filters: dict[str, object], page_size: int, cursor: str = ""
        ) -> str:
            asked.append({"query": query, "cursor": cursor})
            found = {
                "id": f"p{len(asked)}",
                "title": "Plan",
                "timestamp": "2026-03-01T10:00:00Z",
            }
            return json.dumps(
                {"results": [found], "next_cursor": None if cursor else "c2"}
            )

        @stub.tool(name="notion-fetch")
        def fetch(id: str) -> str:
            return json.dumps(
                {
                    "text": "<page><content>Ship the smallest thing first.</content></page>"
                }
            )

        reader = sources_module.Source.owner(
            Notion().address(""), kind="mcp", connector="notion"
        ).reader()
        with serving(stub), patch("anyio.sleep") as pause:
            items = list(reader.items())
        self.assertEqual([a["cursor"] for a in asked], ["", "c2"])
        pause.assert_called_once_with(Notion.pause)
        self.assertEqual(
            [(i.key, i.dated, i.content) for i in items],
            [
                ("p1", "2026-03-01", "Ship the smallest thing first."),
                ("p2", "2026-03-01", "Ship the smallest thing first."),
            ],
        )

    def test_notion_keeps_a_pages_writing_and_skips_databases(self) -> None:
        fetched = (
            'Here is the result of "fetch" for the Page with URL https://x as of now:\n'
            '<page url="https://x"><properties>{"title":"Plan"}</properties>\n'
            '<iconMetadata>{"type":"emoji","emoji":"🔐"}</iconMetadata>\n'
            "<content>Ship the smallest thing first.<empty-block/></content></page>"
        )
        notion = Notion()
        self.assertEqual(
            notion.text(json.dumps({"text": fetched})), "Ship the smallest thing first."
        )
        database = "The title of this Database is: Tasks\nYou can use the fetch tool"
        self.assertEqual(notion.text(json.dumps({"text": database})), "")
        # A page read before this fix kept the preamble and metadata once its tags were gone.
        stored = (
            'Here is the result of "fetch" for the Page with URL https://x as of now:\n\n'
            '{"title":"Plan"}\n\n{"type":"emoji","emoji":"🔐"}\n\n> **Core:** keep it private.'
        )
        self.assertEqual(
            sources_module.notion_writing(stored), "> **Core:** keep it private."
        )

    def test_a_page_notion_will_not_share_is_skipped_not_the_whole_read(self) -> None:
        stub = MCPServer("notion")

        @stub.tool(name="notion-search")
        def search(query: str, filters: dict[str, object], page_size: int) -> str:
            pages = [{"id": key, "title": key} for key in ("p1", "locked", "p3")]
            return json.dumps({"results": pages})

        @stub.tool(name="notion-fetch")
        def fetch(id: str) -> str:
            if id == "locked":
                raise PermissionError("restricted_resource")
            return json.dumps({"text": id})

        reader = sources_module.Source.owner(
            Notion().address(""), kind="mcp", connector="notion"
        ).reader()
        with serving(stub):
            items = list(reader.items())
        self.assertEqual([i.key for i in items], ["p1", "p3"])
        self.assertEqual((reader.errors, reader.failure), (1, None))

    def test_readwise_keeps_highlights_with_their_notes(self) -> None:
        app = Readwise()
        entries, cursor = app.entries(
            json.dumps(
                {
                    "results": [
                        {
                            "id": "d1",
                            "title": "Deep Work",
                            "saved_at": "2026-01-05T00:00:00Z",
                        }
                    ],
                    "nextPageCursor": "n2",
                }
            )
        )
        self.assertEqual(
            (entries[0].key, entries[0].dated, cursor), ("d1", "2026-01-05", "n2")
        )
        self.assertEqual(app.listing("n2")["page_cursor"], "n2")
        text = app.text(
            json.dumps(
                {
                    "results": [
                        {"content": "Depth is rare.", "note": "So protect mornings."},
                        {"content": ""},
                    ]
                }
            )
        )
        self.assertEqual(text, "> Depth is rare.\nSo protect mornings.")


class SignInTest(LoreTestCase):
    def test_the_keychain_keeps_and_forgets_a_sign_in(self) -> None:
        keychain = Keychain("https://mcp.example/mcp")
        token = OAuthToken(access_token="a", token_type="Bearer", refresh_token="r")

        async def round_trip() -> OAuthToken | None:
            await keychain.set_tokens(token)
            return await keychain.get_tokens()

        self.assertEqual(anyio.run(round_trip), token)
        keychain.forget()
        keychain.forget()
        self.assertEqual(anyio.run(keychain.get_tokens), None)
        self.assertEqual(self.keyring.saved, {})

    def answer(self, query: str) -> object:
        with Loopback() as landing:
            opened = threading.Thread(
                target=lambda: urllib.request.urlopen(
                    f"{landing.redirect}?{query}"
                ).read()
            )
            opened.start()
            try:
                return anyio.run(landing.callback)
            except OAuthFlowError as error:
                return error
            finally:
                opened.join()

    def test_the_browser_lands_on_loopback_with_the_code(self) -> None:
        answer = self.answer("code=abc&state=xyz")
        self.assertEqual((answer.code, answer.state), ("abc", "xyz"))  # type: ignore[attr-defined]

    def test_a_declined_approval_is_a_failed_sign_in(self) -> None:
        answer = self.answer("error=access_denied&state=xyz")
        self.assertIsInstance(answer, OAuthFlowError)
        self.assertIn("access_denied", str(answer))

    def test_the_keychain_keeps_the_apps_registration_apart_from_its_tokens(
        self,
    ) -> None:
        server = "https://mcp.example/mcp"
        keychain = Keychain(server)
        registered = OAuthClientInformationFull(client_id="lore-1", client_name="Lore")
        self.assertIsNone(anyio.run(keychain.get_client_info))

        anyio.run(keychain.set_client_info, registered)
        self.assertEqual(list(self.keyring.saved), [("Lore", f"{server} client")])
        self.assertEqual(anyio.run(keychain.get_client_info), registered)
        self.assertIsNone(anyio.run(keychain.get_tokens))

        # Signing in again starts from a registration made for a port long gone.
        keychain.forget()
        self.assertEqual(self.keyring.saved, {})

    def test_one_apps_sign_in_is_not_anothers(self) -> None:
        granola = Keychain("https://mcp.granola.ai/mcp")
        notion = Keychain("https://mcp.notion.com/mcp")
        token = OAuthToken(access_token="a", token_type="Bearer")
        anyio.run(granola.set_tokens, token)
        self.assertIsNone(anyio.run(notion.get_tokens))
        notion.forget()
        self.assertEqual(anyio.run(granola.get_tokens), token)

    def land(
        self, *paths: str, wait: float = 5.0
    ) -> tuple[object, list[tuple[int, str, str]]]:
        """Ask the loopback for each path in turn, as one browser would, and say how
        the sign-in ended and what each request got back. A landing that never ends
        fails the test instead of hanging it."""
        ended: list[object] = []
        pages: list[tuple[int, str, str]] = []
        with patch.object(Loopback, "wait", wait), Loopback() as landing:

            def listen() -> None:
                try:
                    ended.append(anyio.run(landing.callback))
                except OAuthFlowError as error:
                    ended.append(error)

            def browse() -> None:
                for path in paths:
                    # Not urlopen: a proxy in the environment must not carry this off the machine.
                    link = HTTPConnection("127.0.0.1", landing.server_port, timeout=5)
                    try:
                        link.request("GET", path)
                        got = link.getresponse()
                        kind = got.getheader("Content-Type", "")
                        pages.append((got.status, kind, got.read().decode()))
                    finally:
                        link.close()

            threads = [
                threading.Thread(target=work, daemon=True) for work in (listen, browse)
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(10)
            self.assertFalse(
                any(thread.is_alive() for thread in threads),
                "the landing never finished",
            )
        self.assertEqual(len(pages), len(paths), "a request went unanswered")
        return ended[0], pages

    def test_a_browser_asking_for_something_else_first_does_not_end_the_wait(
        self,
    ) -> None:
        answer, pages = self.land(
            "/favicon.ico", "/?code=wrong&state=xyz", "/callback?code=abc&state=xyz"
        )
        self.assertEqual((answer.code, answer.state), ("abc", "xyz"))  # type: ignore[attr-defined]
        for status, _, page in pages[:2]:
            self.assertNotEqual(status, 200)
            self.assertNotIn("Lore is connected", page)
        self.assertEqual(pages[2][0], 200)

    def test_the_landing_page_tells_the_owner_whether_lore_got_in(self) -> None:
        _, [(status, kind, let_in)] = self.land("/callback?code=abc&state=xyz")
        self.assertEqual((status, kind), (200, "text/html; charset=utf-8"))
        self.assertIn("Lore is connected. You can close this tab.", let_in)
        self.assertNotIn("not let in", let_in)

        _, [(status, kind, kept_out)] = self.land("/callback?error=access_denied")
        self.assertEqual((status, kind), (200, "text/html; charset=utf-8"))
        self.assertIn("Lore was not let in. You can close this tab.", kept_out)
        self.assertNotIn("is connected", kept_out)

    def test_the_landing_hands_back_what_the_app_sent_decoded(self) -> None:
        answer, _ = self.land(
            "/callback?code=a%2Fb%3D&state=xyz&iss=https%3A%2F%2Fauth.example"
        )
        self.assertEqual(
            (answer.code, answer.state, answer.iss),  # type: ignore[attr-defined]
            ("a/b=", "xyz", "https://auth.example"),
        )

    def test_nobody_landing_is_a_failed_sign_in_not_an_endless_wait(self) -> None:
        answer, _ = self.land(wait=0.05)
        self.assertIsInstance(answer, OAuthFlowError)

    def test_the_landing_listens_only_on_this_machine(self) -> None:
        with Loopback() as landing:
            host, port = landing.server_address[:2]
            self.assertEqual(host, "127.0.0.1")
            self.assertGreater(port, 0)
            self.assertEqual(landing.redirect, f"http://127.0.0.1:{port}/callback")

    def test_the_code_in_the_callback_address_is_never_printed(self) -> None:
        # The stock handler logs every request line, and this one carries the code.
        printed = io.StringIO()
        with redirect_stderr(printed):
            answer, _ = self.land(
                "/elsewhere?code=s3cret-code", "/callback?code=s3cret-code&state=xyz"
            )
        self.assertEqual(answer.code, "s3cret-code")  # type: ignore[attr-defined]
        self.assertNotIn("s3cret-code", printed.getvalue())
        self.assertNotIn("GET /", printed.getvalue())


if __name__ == "__main__":
    unittest.main()
