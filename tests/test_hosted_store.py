"""Tests for `lore.hosted`, the owner's side of the store Lore hosts (XC-088), against a
stand-in held to `contracts/hosted-inbox.md`: the Mac claims a store with its key, and
its agents' saves reach it with no Cloudflare account."""

from __future__ import annotations

import json
import urllib.error
from pathlib import Path
from unittest.mock import patch

import httpx2
from fixtures.hosted import Hosted as StandIn
from fixtures.inbox import Endpoint, Node
from helpers import LoreTestCase, captured

from lore import hosted
from lore.agents import Agents
from lore.cli import main
from lore.hosted import Hosted, HostedError, OwnerKey
from lore.inbox import Inbox, InboxError
from lore.sources import SourceError
from lore.store import Store

ROOT = Path(__file__).resolve().parent.parent
VECTOR = json.loads((ROOT / "contracts/hosted_owner_vector.json").read_text())
DOMAIN = "yourlore.test"


class SignatureTest(LoreTestCase):
    def test_the_mac_signs_the_contract_vector(self) -> None:
        key = OwnerKey(private_key=VECTOR["private_key"])
        self.assertEqual(key.public_key, VECTOR["public_key"])
        message = hosted.signed(
            VECTOR["host"],
            VECTOR["path"],
            VECTOR["time"],
            VECTOR["nonce"],
            VECTOR["body"].encode(),
        )
        self.assertEqual(message.decode(), VECTOR["message"])
        self.assertEqual(hosted._encode(key.signer.sign(message)), VECTOR["signature"])


class HostedCase(LoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.stand_in = StandIn(Path(self.tmp.name), DOMAIN).__enter__()
        self.addCleanup(self.stand_in.__exit__)
        for patcher in (
            patch.object(hosted, "DOMAIN", DOMAIN),
            patch("lore.hosted.urllib.request.urlopen", self.stand_in.urlopen()),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def claim(self) -> Hosted:
        with Store() as store:
            return Hosted.claim(store)

    def online(self) -> tuple[Hosted, Node]:
        """A claimed store, and its `/agent` on a loopback port."""
        claimed = self.claim()
        node = Node(Endpoint(self.stand_in.d1(claimed.store_id))).__enter__()
        self.addCleanup(node.__exit__)
        return claimed, node

    def save(self, node: Node, token: str, item: dict[str, object]) -> None:
        httpx2.post(
            f"{node.url}/agent",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "store", "arguments": {"items": [item]}},
            },
            headers={"Authorization": f"Bearer {token}"},
        ).raise_for_status()


class ClaimTest(HostedCase):
    def test_claiming_keeps_one_key_in_the_keychain_and_the_store_in_settings(
        self,
    ) -> None:
        claimed = self.claim()
        self.assertRegex(claimed.store_id, r"^[a-z2-7]{12}$")
        self.assertEqual(claimed.origin, f"https://{claimed.store_id}.{DOMAIN}")
        self.assertEqual(list(self.keyring.saved), [("Lore", "hosted owner")])
        with Store() as store:
            self.assertEqual(store.setting(hosted.SETTING, None), claimed.store_id)
        key = hosted.Credentials().load()
        assert key is not None
        self.assertEqual(self.stand_in.owners[claimed.store_id], key.public_key)

    def test_claiming_again_gets_the_same_store(self) -> None:
        first = self.claim()
        self.assertEqual(self.claim().store_id, first.store_id)
        self.assertEqual(len(self.stand_in.owners), 1)

    def test_a_mac_that_lost_its_key_starts_a_new_store(self) -> None:
        first = self.claim()
        hosted.Credentials().forget()
        second = self.claim()
        self.assertNotEqual(second.store_id, first.store_id)
        with Store() as store:
            self.assertEqual(store.setting(hosted.SETTING, None), second.store_id)

    def test_lore_node_host_puts_the_store_online_in_one_step(self) -> None:
        with captured() as out:
            self.assertEqual(main(["node", "host"]), 0)
        with Store() as store:
            store_id = store.setting(hosted.SETTING, None)
        self.assertIn(f"https://{store_id}.{DOMAIN}", out.getvalue())
        self.assertIn("ready for your agents, nothing for sale", out.getvalue())

    def test_an_owner_with_their_own_cloudflare_store_keeps_it(self) -> None:
        with Store() as store:
            store.set_setting("node_url", "https://lore.example.workers.dev/mcp")
        with captured() as out:
            self.assertEqual(main(["node", "host"]), 0)
        self.assertIn("on your own Cloudflare", out.getvalue())
        self.assertEqual(self.stand_in.owners, {})
        with Store() as store:
            self.assertIsNone(Hosted.of(store))

    def test_a_store_lore_cant_reach_says_so(self) -> None:
        refused = urllib.error.URLError("nodename nor servname provided")
        with patch("lore.hosted.urllib.request.urlopen", side_effect=refused):
            with self.assertRaisesRegex(
                HostedError, "put your store online: yourlore.test didn't answer"
            ):
                self.claim()


class InboxTest(HostedCase):
    def test_agents_save_to_the_hosted_store_and_the_mac_collects_them(self) -> None:
        claimed, node = self.online()
        inbox = Inbox()
        minted = inbox.mint("Claude", "claude")
        self.save(
            node, minted.token, {"title": "Pricing", "content": "Quote the tier."}
        )
        agent = minted.agent.id
        self.assertEqual(inbox.waiting()[0], {agent: 1})
        (item,) = inbox.items(agent)
        opened = inbox.open(item)
        self.assertEqual(opened.payload.title, "Pricing")  # type: ignore[union-attr]
        inbox.received([opened])
        self.assertEqual(inbox.items(agent), [])
        rows = (
            self.stand_in.d1(claimed.store_id).connect().execute("SELECT * FROM inbox")
        )
        self.assertNotIn("Quote the tier", json.dumps([dict(row) for row in rows]))

    def test_the_agent_address_is_the_hosted_stores(self) -> None:
        with Store() as store:
            with self.assertRaisesRegex(SourceError, "put your store online first"):
                _ = Agents(store).mcp_url
        claimed = self.claim()
        with Store() as store:
            self.assertEqual(Agents(store).mcp_url, f"{claimed.origin}/agent")
            store.set_setting("node_url", "https://lore.example.workers.dev/mcp")
            self.assertEqual(
                Agents(store).mcp_url, "https://lore.example.workers.dev/agent"
            )

    def test_a_refused_statement_is_the_inboxs_error(self) -> None:
        self.claim()
        with self.assertRaisesRegex(InboxError, "reading your agents failed: no such"):
            Inbox().agents()
