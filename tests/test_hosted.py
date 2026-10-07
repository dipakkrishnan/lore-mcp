"""Tests for the `mcp` source kind: apps Lore signs in to, like Granola.

Every server is a stub run in-process through the SDK, and every sign-in is kept in
a fake keyring: nothing here touches the network or the owner's Keychain.
"""

from __future__ import annotations

import json
import threading
import unittest
import urllib.request
from contextlib import asynccontextmanager
from typing import AsyncIterator
from unittest.mock import patch

import anyio
import keyring
from fixtures.granola import Granola
from helpers import LoreTestCase
from keyring.backend import KeyringBackend
from keyring.errors import PasswordDeleteError
from mcp import Client
from mcp.client.auth import OAuthFlowError
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.shared.auth import OAuthToken

from lore import sources as sources_module
from lore.signin import Keychain, Loopback
from lore.sources import HostedReader, Notion, Readwise, Registry, SourceError
from lore.store import Store


class FakeKeyring(KeyringBackend):
    priority = 1  # type: ignore[assignment]

    def __init__(self) -> None:
        self.saved: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.saved.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.saved[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        if self.saved.pop((service, username), None) is None:
            raise PasswordDeleteError(username)


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
        self.keyring = FakeKeyring()
        previous = keyring.get_keyring()
        keyring.set_keyring(self.keyring)
        self.addCleanup(keyring.set_keyring, previous)
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


class SignInTest(unittest.TestCase):
    def setUp(self) -> None:
        self.keyring = FakeKeyring()
        previous = keyring.get_keyring()
        keyring.set_keyring(self.keyring)
        self.addCleanup(keyring.set_keyring, previous)

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


if __name__ == "__main__":
    unittest.main()
