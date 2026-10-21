"""Tests for `lore.inbox`, the owner's side of the agent write path, and for the
stand-in node it is tested against: both are held to `contracts/inbox.md`."""

from __future__ import annotations

import hashlib
import json
import subprocess
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx2
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from fixtures.inbox import D1, Endpoint, seal
from helpers import LoreTestCase, NodeCase

from lore.inbox import Inbox, InboxError, Sealed, SetupPrompt

ROOT = Path(__file__).resolve().parent.parent
VECTOR = json.loads((ROOT / "contracts/inbox_seal_vector.json").read_text())


def raw(text: str) -> bytes:
    return urlsafe_b64decode(text + "=" * (-len(text) % 4))


class SealTest(LoreTestCase):
    def test_the_mac_opens_the_contract_vector(self) -> None:
        opened = Inbox.unseal(
            VECTOR["owner_private"], VECTOR["item_id"], VECTOR["sealed"]
        )
        self.assertEqual(opened.decode(), VECTOR["plaintext"])

    def test_the_stand_in_node_seals_the_contract_vector(self) -> None:
        sealed = seal(
            raw(VECTOR["owner_public"]),
            VECTOR["item_id"],
            VECTOR["plaintext"].encode(),
            X25519PrivateKey.from_private_bytes(raw(VECTOR["ephemeral_private"])),
            raw(VECTOR["nonce"]),
        )
        self.assertEqual(sealed, VECTOR["sealed"])

    def test_a_seal_for_another_item_or_key_does_not_open(self) -> None:
        with self.assertRaisesRegex(InboxError, "doesn't open"):
            Inbox.unseal(VECTOR["owner_private"], "0" * 32, VECTOR["sealed"])
        stranger = urlsafe_b64encode(X25519PrivateKey.generate().private_bytes_raw())
        with self.assertRaisesRegex(InboxError, "doesn't open"):
            Inbox.unseal(stranger.decode(), VECTOR["item_id"], VECTOR["sealed"])
        with self.assertRaisesRegex(InboxError, "doesn't open"):
            Inbox.unseal(VECTOR["owner_private"], VECTOR["item_id"], "!!")


class OwnerSideTest(NodeCase):
    def test_the_first_mint_makes_keys_tables_and_settings_once(self) -> None:
        inbox = Inbox()
        self.assertEqual(inbox.settings(), {})
        first = inbox.mint(" Grok ", "grok")
        Inbox().mint("Claude", "claude")
        self.assertEqual(first.agent.name, "Grok")
        self.assertRegex(first.token, r"^lore_agent_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$")
        self.assertTrue(first.token.startswith(f"lore_agent_{first.agent.id}_"))
        self.assertEqual(list(self.keyring.saved), [("Lore", "inbox keys")])
        settings = dict(
            tuple(row)
            for row in self.d1.connect().execute("SELECT key, value FROM node_settings")
        )
        self.assertEqual(settings, Inbox().settings())
        self.assertEqual(len(raw(settings["inbox_salt"])), 32)
        hashes = [
            row[0] for row in self.d1.connect().execute("SELECT token_hash FROM agents")
        ]
        self.assertEqual(len(hashes), 2)
        self.assertNotIn(first.token.split("_", 3)[3], " ".join(self.d1.commands))

    def test_the_token_hash_is_the_nodes_sha256_of_the_secret_string(self) -> None:
        minted = Inbox().mint("Grok", "grok")
        secret = minted.token.split("_", 3)[3]
        self.assertEqual(len(secret), 43)
        (stored,) = (
            self.d1.connect().execute("SELECT token_hash FROM agents").fetchone()
        )
        # Node: createHash("sha256").update(secret).digest("hex"), a string's UTF-8.
        self.assertEqual(stored, hashlib.sha256(secret.encode("utf-8")).hexdigest())
        self.assertNotEqual(stored, hashlib.sha256(raw(secret)).hexdigest())

    def test_a_bad_name_or_app_is_refused_before_the_node_is_asked(self) -> None:
        for name, app in (("", "grok"), ("x" * 41, "grok"), ("Grok", "siri")):
            with self.subTest(name=name, app=app):
                with self.assertRaisesRegex(InboxError, "1-40 characters"):
                    Inbox().mint(name, app)
        self.assertEqual(self.d1.commands, [])

    def test_rotate_and_revoke_change_the_row_not_the_agent(self) -> None:
        inbox = Inbox()
        minted = inbox.mint("Grok", "grok")
        rotated = inbox.rotate(minted.agent.id)
        self.assertEqual(rotated.agent.id, minted.agent.id)
        self.assertNotEqual(rotated.token, minted.token)
        self.assertIsNone(self.endpoint.agent(f"Bearer {minted.token}"))
        self.assertEqual(
            self.endpoint.agent(f"Bearer {rotated.token}"), minted.agent.id
        )
        inbox.revoke(minted.agent.id)
        self.assertIsNone(self.endpoint.agent(f"Bearer {rotated.token}"))
        self.assertTrue(inbox.agents()[0].revoked)
        with self.assertRaisesRegex(InboxError, "no connected agent"):
            inbox.rotate(minted.agent.id)

    def test_collect_open_and_confirm_only_the_version_collected(self) -> None:
        inbox = Inbox()
        key = inbox.mint("Grok", "grok").token
        self.save(key, {"title": "Pricing", "content": "Quote the tier.", "key": "p"})
        self.save(key, {"title": "Hiring", "content": "Hire slow."})
        agent = inbox.agents()[0].id
        self.assertEqual(inbox.waiting()[0], {agent: 2})
        collected = [inbox.open(item) for item in inbox.items(agent)]
        self.assertEqual(
            [(o.key, o.payload.title) for o in collected],  # type: ignore[union-attr]
            [("p", "Pricing"), (collected[1].id, "Hiring")],
        )
        # A re-save between collecting and confirming survives the confirm.
        self.save(key, {"title": "Pricing", "content": "Quote the budget.", "key": "p"})
        inbox.received(collected)
        left = inbox.items(agent)
        self.assertEqual([item.id for item in left], [collected[0].id])
        self.assertIn("budget", inbox.open(left[0]).payload.content)  # type: ignore[union-attr]
        self.assertEqual(inbox.waiting()[0], {agent: 1})

    def test_a_received_forget_stays_forgotten_and_is_not_owed_again(self) -> None:
        inbox = Inbox()
        key = inbox.mint("Grok", "grok").token
        agent = inbox.agents()[0].id
        self.call(key, "forget", key="never-saved")
        forget = inbox.open(inbox.items(agent)[0])
        self.assertEqual(forget.key, "never-saved")
        inbox.received([forget])
        self.assertEqual(inbox.items(agent), [])
        state = self.call(key, "stored", keys=["never-saved"])["structuredContent"]
        self.assertEqual(state["keys"][0]["state"], "forgotten")

    def test_an_item_that_opens_to_nonsense_is_refused(self) -> None:
        inbox = Inbox()
        inbox.mint("Grok", "grok")
        assert inbox.keys
        item = Sealed(
            id="a" * 32,
            agent="b" * 16,
            state="waiting",
            sealed=seal(raw(inbox.keys.public_key), "a" * 32, b'{"nope": 1}'),
            saved_at="2026-10-16T00:00:00.000Z",
        )
        with self.assertRaisesRegex(InboxError, "isn't a save"):
            inbox.open(item)
        self.keyring.saved.clear()
        with self.assertRaisesRegex(InboxError, "no key"):
            Inbox().open(item)

    def test_a_wrangler_refusal_is_the_inboxs_error(self) -> None:
        self.wrangler.side_effect = lambda args, **_: subprocess.CompletedProcess(
            args, 1, "", "✘ [ERROR] You are not logged in."
        )
        with patch("lore.deploy.time.sleep"):
            with self.assertRaisesRegex(InboxError, "not logged in"):
                Inbox().agents()

    def test_no_staged_node_is_a_plain_error(self) -> None:
        (self.store / "node_modules/.bin/wrangler").unlink()
        with self.assertRaisesRegex(InboxError, "open your store first"):
            Inbox().waiting()


class StandInNodeTest(NodeCase):
    """The node's half of the contract, which the Worker implements the same way."""

    def setUp(self) -> None:
        super().setUp()
        self.inbox = Inbox()
        self.key = self.inbox.mint("Grok", "grok").token

    def test_a_wrong_or_missing_key_is_refused_with_where_to_sign_in(self) -> None:
        for header in ({}, {"Authorization": "Bearer lore_agent_nope"}):
            answer = httpx2.post(f"{self.node.url}/agent", json={}, headers=header)
            self.assertEqual(answer.status_code, 401)
            self.assertIn("resource_metadata=", answer.headers["WWW-Authenticate"])

    def test_the_same_key_twice_leaves_one_waiting_item_with_the_newer_content(
        self,
    ) -> None:
        first = self.save(self.key, {"title": "T", "content": "old", "key": " k "})
        again = self.save(self.key, {"title": "T", "content": "new", "key": "k"})
        self.assertEqual(first["saved"][0]["key"], "k")
        self.assertEqual(
            (again["saved"][0]["id"], again["saved"][0]["replaced"]),
            (first["saved"][0]["id"], True),
        )
        items = self.inbox.items(self.inbox.agents()[0].id)
        self.assertEqual(len(items), 1)
        self.assertEqual(self.inbox.open(items[0]).payload.content, "new")  # type: ignore[union-attr]
        self.assertIn("ever published or sold without", first["note"])

    def test_a_forget_of_a_save_never_received_withdraws_it(self) -> None:
        self.save(self.key, {"title": "T", "content": "c", "key": "k"})
        self.call(self.key, "forget", key="k")
        self.assertEqual(self.inbox.waiting()[0], {})
        self.assertEqual(self.inbox.items(self.inbox.agents()[0].id), [])
        rows = self.d1.connect().execute("SELECT state, sealed FROM inbox").fetchall()
        self.assertEqual([tuple(row) for row in rows], [("forgotten", None)])

    def test_a_forget_after_a_version_arrived_reaches_the_mac(self) -> None:
        self.save(self.key, {"title": "T", "content": "c", "key": "k"})
        agent = self.inbox.agents()[0].id
        self.inbox.received([self.inbox.open(i) for i in self.inbox.items(agent)])
        self.save(self.key, {"title": "T", "content": "c2", "key": "k"})
        self.call(self.key, "forget", key="k")
        items = self.inbox.items(agent)
        self.assertEqual([i.state for i in items], ["forgotten"])
        self.assertEqual(
            self.inbox.open(items[0]).payload.model_dump(), {"key": "k", "forget": True}
        )

    def test_limits_reject_with_a_tool_error_that_names_them(self) -> None:
        for item, limit in (
            ({"title": "", "content": "c"}, "title must be 1-200"),
            ({"title": "t", "content": "c" * 20_001}, "content must be 1-20,000"),
            ({"title": "t", "content": "c", "topic": "x" * 81}, "topic"),
            ({"title": "t", "content": "c", "kind": "rumour"}, "kind must be one of"),
            ({"title": "t", "content": "c", "key": " "}, "key must be 1-120"),
            ("just text", "must be an object"),
        ):
            with self.subTest(limit=limit):
                answer = self.call(self.key, "store", items=[item])
                self.assertTrue(answer["isError"])
                self.assertIn(limit, answer["content"][0]["text"])
        too_many = self.call(self.key, "store", items=[])
        self.assertIn("1-20 items", too_many["content"][0]["text"])
        self.assertIn(
            "at most 50",
            self.call(self.key, "stored", keys=["k"] * 51)["content"][0]["text"],
        )
        self.assertIn(
            "1-120", self.call(self.key, "forget", key="")["content"][0]["text"]
        )

    def test_an_agent_gets_a_hundred_writes_an_hour(self) -> None:
        item = {"title": "t", "content": "c"}
        for _ in range(5):
            self.save(self.key, *[item] * 20)
        answer = self.call(self.key, "store", items=[item])
        self.assertIn("100 writes a hour", answer["content"][0]["text"])
        self.endpoint.clock = lambda: datetime.now(timezone.utc) + timedelta(hours=2)
        self.assertFalse(self.call(self.key, "store", items=[item])["isError"])

    def test_a_payload_waiting_past_thirty_days_is_dropped_at_the_next_write(
        self,
    ) -> None:
        self.save(self.key, {"title": "t", "content": "old"})
        self.endpoint.clock = lambda: datetime.now(timezone.utc) + timedelta(days=31)
        self.save(self.key, {"title": "t", "content": "new"})
        self.assertEqual(self.inbox.waiting()[0], {self.inbox.agents()[0].id: 1})

    def test_no_public_key_means_the_store_is_not_ready(self) -> None:
        self.d1.execute("DELETE FROM node_settings;")
        answer = self.call(self.key, "store", items=[{"title": "t", "content": "c"}])
        self.assertIn("isn't ready for agents", answer["content"][0]["text"])

    def test_nothing_stored_is_plaintext(self) -> None:
        self.save(self.key, {"title": "Secret recipe", "content": "Brown the butter."})
        dump = "\n".join(self.d1.connect().iterdump())
        self.assertNotIn("butter", dump)
        self.assertNotIn("Secret recipe", dump)

    def test_the_protocol_answers_like_a_stateless_mcp_server(self) -> None:
        def rpc(method: str, **extra: object) -> httpx2.Response:
            return httpx2.post(
                f"{self.node.url}/agent",
                json={"jsonrpc": "2.0", "method": method, **extra},
                headers={"Authorization": f"Bearer {self.key}"},
            )

        hello = rpc("initialize", id=1).json()["result"]
        self.assertIn("approval", hello["instructions"])
        self.assertEqual(rpc("notifications/initialized").status_code, 202)
        self.assertEqual(rpc("ping", id=2).json()["result"], {})
        tools = rpc("tools/list", id=3).json()["result"]["tools"]
        self.assertEqual([t["name"] for t in tools], ["store", "stored", "forget"])
        self.assertIn("error", rpc("tools/call", id=4, params={"name": "sell"}).json())
        self.assertEqual(httpx2.get(f"{self.node.url}/agent").status_code, 405)
        self.assertEqual(httpx2.post(f"{self.node.url}/mcp").status_code, 404)


class PromptTest(LoreTestCase):
    def test_the_paste_block_is_the_skill_with_the_connection_filled_in(self) -> None:
        prompt = SetupPrompt("Grok", "https://x.workers.dev/agent", "lore_agent_k")
        text = prompt.render()
        self.assertTrue(text.startswith("# Save to Lore"))
        self.assertIn("You are Grok", text)
        self.assertIn("URL: https://x.workers.dev/agent", text)
        self.assertIn("Header: Authorization: Bearer lore_agent_k", text)
        self.assertNotRegex(text, r"\{(name|mcp_url|header)\}|^name:")
        self.assertEqual(prompt.header, "Authorization: Bearer lore_agent_k")


class FakeWranglerTest(LoreTestCase):
    def test_it_answers_files_and_refusals_in_wranglers_shape(self) -> None:
        d1 = D1(Path(self.tmp.name) / "d1.sqlite")
        script = Path(self.tmp.name) / "push.sql"
        script.write_text("CREATE TABLE t (v TEXT);\nINSERT INTO t VALUES ('a;b');\n")
        self.assertEqual(
            d1.wrangler(("w", "d1", "execute", "--file", str(script))).returncode, 0
        )
        answer = d1.wrangler(("w", "d1", "execute", "--command", "SELECT v FROM t"))
        self.assertEqual(json.loads(answer.stdout), [{"results": [{"v": "a;b"}]}])
        self.assertEqual(d1.wrangler(("w", "whoami")).stdout, "")
        refused = d1.wrangler(("w", "d1", "execute", "--command", "SELECT nope"))
        self.assertEqual(refused.returncode, 1)
        self.assertIn("nope", refused.stdout)
        self.assertIsNone(
            Endpoint(d1).agent("Bearer lore_agent_" + "0" * 16 + "_" + "a" * 43)
        )


class NoKeyringTest(LoreTestCase):
    def test_a_push_without_any_keyring_publishes_no_inbox_keys(self) -> None:
        from keyring.errors import NoKeyringError

        with patch("keyring.get_password", side_effect=NoKeyringError("none")):
            self.assertEqual(Inbox().settings(), {})
