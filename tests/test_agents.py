"""Tests for the personal-agent source (CAP-036): `lore agents`, `lore.agents`, and the
`agent` reader, against a stand-in node. Nothing here runs wrangler or touches the
owner's Keychain."""

from __future__ import annotations

import json
import sqlite3
import subprocess
from datetime import datetime
from unittest.mock import patch

import httpx2
from helpers import NodeCase, captured

from lore import automation, cli
from lore.inbox import Inbox, InboxError
from lore.snapshot import build
from lore.sources import Connector, Registry
from lore.store import Store

AGENT_KEYS = {
    "id",
    "name",
    "app",
    "created_at",
    "last_saved_at",
    "saved",
    "waiting",
    "revoked",
}


class AgentCase(NodeCase):
    def setUp(self) -> None:
        super().setUp()
        # The owner, at the desktop app: connecting, re-keying and disconnecting are theirs.
        patcher = patch.object(cli, "_attended", return_value=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def lore(self, *argv: str) -> tuple[int, str]:
        with captured() as out:
            code = cli.main(list(argv))
        return code, out.getvalue()

    def json(self, *argv: str) -> dict:
        code, out = self.lore(*argv, "--json")
        self.assertEqual(code, 0, out)
        return json.loads(out)

    def connect(self, name: str = "Grok", app: str = "grok") -> dict:
        return self.json("agents", "connect", name, "--app", app)

    def memories(self, source: str) -> dict[str, str]:
        with Store() as store:
            return {
                m.title: m.content
                for m in store.search("", status="private")
                if m.source == source
            }


class ConnectTest(AgentCase):
    def test_connect_hands_over_a_working_key_and_the_paste_block(self) -> None:
        handed = self.connect()
        agent = handed["agent"]
        self.assertEqual(
            set(handed),
            {"source", "agent", "mcp_url", "connector_url", "key", "header", "prompt"},
        )
        self.assertEqual(set(agent), AGENT_KEYS)
        self.assertEqual(handed["source"], f"agent-{agent['id']}")
        self.assertEqual(
            (agent["name"], agent["app"], agent["revoked"]), ("Grok", "grok", False)
        )
        self.assertEqual(handed["mcp_url"], f"{self.node.url}/agent")
        self.assertEqual(handed["header"], f"Authorization: Bearer {handed['key']}")
        self.assertEqual(
            handed["connector_url"], f"{self.node.url}/agent/{handed['key']}"
        )
        self.assertIn(f"URL: {self.node.url}/agent", handed["prompt"])
        self.assertIn(handed["header"], handed["prompt"])
        self.assertIn("You are Grok", handed["prompt"])
        self.assertIn("without my approval in the Lore app", handed["prompt"])
        saved = self.save(handed["key"], {"title": "t", "content": "c"})
        self.assertEqual(len(saved["saved"]), 1)

    def test_the_owners_keys_are_made_once_and_never_land_on_disk(self) -> None:
        first, second = self.connect(), self.connect("Claude", "claude")
        self.assertEqual(list(self.keyring.saved), [("Lore", "inbox keys")])
        keys = json.loads(self.keyring.saved[("Lore", "inbox keys")])
        secrets = [keys["private_key"], keys["salt"], first["key"], second["key"]]
        secrets += [k.split("_", 3)[3] for k in (first["key"], second["key"])]
        for path in self.lore_home.rglob("*"):
            if path.is_file():
                data = path.read_bytes()
                for secret in secrets:
                    with self.subTest(path=path.name):
                        self.assertNotIn(secret.encode(), data)
        node = "\n".join(sqlite3.connect(self.d1.path).iterdump())
        self.assertNotIn(keys["private_key"], node)
        for key in (first["key"], second["key"]):
            self.assertNotIn(key.split("_", 3)[3], node)

    def test_muse_cannot_connect_yet_but_one_already_connected_still_works(
        self,
    ) -> None:
        with captured(), patch("sys.stderr") as err:
            with self.assertRaises(SystemExit) as refused:
                cli.main(["agents", "connect", "Muse", "--app", "muse", "--json"])
        self.assertEqual(refused.exception.code, 2)
        said = "".join(call.args[0] for call in err.write.call_args_list)
        self.assertIn("Muse can't connect yet.", said)
        with self.assertRaisesRegex(InboxError, "Muse can't connect yet."):
            Inbox().mint("Muse", "muse")
        self.assertEqual(self.d1.commands, [], "no key minted, the node never asked")
        with captured() as out, self.assertRaises(SystemExit):
            cli.main(["agents", "connect", "--help"])
        self.assertIn("{grok,chatgpt,claude,other}", out.getvalue())
        self.assertNotIn("muse", out.getvalue())
        self.assertEqual(self.json("agents", "list")["agents"], [])
        # One connected as Muse before APP-217 lists, re-keys and disconnects as before.
        source = self.connect("Muse", "claude")["source"]
        with sqlite3.connect(self.d1.path) as d1:
            d1.execute("UPDATE agents SET app = 'muse'")
        (listed,) = self.json("agents", "list")["agents"]
        self.assertEqual((listed["source"], listed["app"]), (source, "muse"))
        rekeyed = self.json("agents", "key", source)
        self.assertEqual(rekeyed["agent"]["app"], "muse")
        self.assertEqual(
            len(self.save(rekeyed["key"], {"title": "t", "content": "c"})["saved"]), 1
        )
        self.json("agents", "revoke", source, "--keep")
        self.assertEqual(self.json("agents", "list")["agents"], [])

    def test_without_a_store_online_connect_says_so_and_mints_nothing(self) -> None:
        with Store() as store:
            store.set_setting("node_url", None)
        with captured(), patch("sys.stderr") as err:
            self.assertEqual(
                cli.main(["agents", "connect", "Grok", "--app", "grok"]), 2
            )
        said = "".join(call.args[0] for call in err.write.call_args_list)
        self.assertIn("put your store online first", said)
        self.assertEqual(self.d1.commands, [])

    def test_a_connect_that_cannot_be_read_takes_its_key_back(self) -> None:
        with patch.object(Inbox, "items", side_effect=InboxError("down")):
            code, _ = self.lore("agents", "connect", "Grok", "--app", "grok")
        self.assertEqual(code, 2)
        rows = (
            sqlite3.connect(self.d1.path)
            .execute("SELECT revoked_at FROM agents")
            .fetchall()
        )
        self.assertEqual(len(rows), 1)
        self.assertIsNotNone(rows[0][0])
        with Store() as store:
            self.assertEqual([s.name for s in Registry(store).owned], [])

    def test_human_output_is_short_and_plain(self) -> None:
        code, out = self.lore("agents", "list")
        self.assertEqual((code, out), (0, "No personal agents connected.\n"))
        code, out = self.lore("agents", "connect", "Grok", "--app", "grok")
        self.assertTrue(
            out.startswith("Connected Grok. Paste this into it:\n\n# Save to Lore")
        )
        with Store() as store:
            source = Registry(store).owned[0].name
        self.assertRegex(
            self.lore("agents", "list")[1],
            r"Grok\s+grok\s+0 saved · 0 waiting · 0 memories",
        )
        self.assertEqual(
            self.lore("agents", "waiting")[1], "0 waiting to be brought in.\n"
        )
        self.assertIn("old key no longer works", self.lore("agents", "key", source)[1])
        self.assertEqual(
            self.lore("agents", "revoke", source, "--delete")[1],
            f"Disconnected {source}; memories deleted.\n",
        )

    def test_sources_connect_points_at_agents_connect(self) -> None:
        code, _ = self.lore("sources", "connect", "agent")
        self.assertEqual(code, 2)


class ReadTest(AgentCase):
    def setUp(self) -> None:
        super().setUp()
        self.handed = self.connect()
        self.source = self.handed["source"]
        self.key = self.handed["key"]

    def read(self) -> dict:
        return json.loads(self.lore("sources", "read", self.source, "--json")[1])[0]

    def test_a_read_brings_saves_in_privately_and_only_then_confirms(self) -> None:
        self.save(
            self.key,
            {
                "title": "Pricing",
                "content": "I quote off the budget tier.",
                "key": "pricing",
                "occurred_at": "2026-10-01",
            },
            {"title": "Seats", "content": "Window seat."},
        )
        read = self.read()
        self.assertEqual(
            (read["added"], read["state"], read["connector"]), (2, "connected", "agent")
        )
        self.assertEqual(
            self.memories(self.source),
            {"Pricing": "I quote off the budget tier.", "Seats": "Window seat."},
        )
        with Store() as store:
            memory = next(m for m in store.search("Pricing") if m.source == self.source)
            self.assertEqual(memory.status, "private")
            self.assertTrue(memory.updated_at.startswith("2026-10-01"))
            self.assertEqual(
                memory.project, "Grok", "by the agent's name, not the app's"
            )
        states = [
            r[0]
            for r in sqlite3.connect(self.d1.path).execute("SELECT state FROM inbox")
        ]
        self.assertEqual(states, ["received", "received"])
        self.assertEqual(self.json("agents", "waiting"), {"waiting": 0, "sources": []})
        self.assertEqual(self.read()["added"], 0)

    def test_a_failed_import_confirms_nothing_and_the_next_read_finishes(self) -> None:
        self.save(
            self.key, {"title": "A", "content": "a"}, {"title": "B", "content": "b"}
        )
        real = Store.put
        calls = []

        def flaky(store: Store, **fields: object) -> str:
            calls.append(fields["title"])
            if len(calls) == 2:
                raise sqlite3.OperationalError("disk I/O error")
            return real(store, **fields)  # type: ignore[arg-type]

        with (
            patch.object(Store, "put", flaky),
            self.assertRaises(sqlite3.OperationalError),
        ):
            self.lore("sources", "read", self.source)
        waiting = self.json("agents", "waiting")
        self.assertEqual(waiting, {"waiting": 2, "sources": [self.source]})
        read = self.read()
        self.assertEqual((read["added"], read["unchanged"]), (1, 1))
        self.assertEqual(set(self.memories(self.source)), {"A", "B"})

    def test_a_resave_updates_the_memory_and_flags_what_cites_it(self) -> None:
        self.save(
            self.key, {"title": "Pricing", "content": "Quote the tier.", "key": "p"}
        )
        self.read()
        with Store() as store:
            memory = next(m for m in store.search("Pricing") if m.source == self.source)
            store.add_publication(
                title="Pricing claim",
                content="a bounded claim about pricing",
                topic="pricing",
                provenance=[memory.id],
            )
        self.save(
            self.key,
            {
                "title": "Pricing",
                "content": "Quote the budget, not the song.",
                "key": "p",
            },
        )
        self.assertEqual(self.read()["updated"], 1)
        self.assertEqual(
            self.memories(self.source), {"Pricing": "Quote the budget, not the song."}
        )
        with Store() as store:
            self.assertEqual(
                [p.title for p in store.stale_publications()], ["Pricing claim"]
            )

    def test_a_forget_removes_the_memory_unless_a_publication_cites_it(self) -> None:
        self.save(
            self.key,
            {"title": "Gone", "content": "g", "key": "gone"},
            {"title": "Cited", "content": "c", "key": "cited"},
        )
        self.read()
        with Store() as store:
            cited = next(m for m in store.search("Cited") if m.source == self.source)
            store.add_publication(
                title="Claim",
                content="a bounded claim",
                topic="pricing",
                provenance=[cited.id],
            )
        self.call(self.key, "forget", key="gone")
        self.call(self.key, "forget", key="cited")
        self.assertEqual(self.read()["removed"], 1)
        self.assertEqual(set(self.memories(self.source)), {"Cited"})
        state = self.call(self.key, "stored", keys=["gone"])["structuredContent"][
            "keys"
        ][0]["state"]
        self.assertEqual(state, "forgotten")

    def test_a_save_that_will_not_open_is_an_error_left_waiting(self) -> None:
        self.save(self.key, {"title": "A", "content": "a"})
        sqlite3.connect(self.d1.path).execute(
            "UPDATE inbox SET sealed='AAAA'"
        ).connection.commit()
        read = self.read()
        self.assertEqual((read["errors"], read["added"]), (1, 0))
        self.assertEqual(self.json("agents", "waiting")["waiting"], 1)

    def test_a_new_key_hands_over_the_count_that_only_its_own_saves_raise(
        self,
    ) -> None:
        # APP-217: the app shows a new link works once the agent's count rises past
        # the one its key came with. Saves the old key left waiting were counted
        # already; a save with the new key counts even when it changes nothing.
        item = {
            "title": "Pricing",
            "content": "I quote off the budget tier.",
            "key": "p",
        }
        self.save(self.key, item)
        self.assertEqual(self.read()["added"], 1)
        self.save(self.key, {"title": "Late", "content": "Saved with the old key."})
        rekeyed = self.json("agents", "key", self.source)
        baseline = rekeyed["agent"]["saved"]
        self.assertEqual(baseline, 2)
        self.assertEqual(self.read()["added"], 1, "the old key's save, brought in late")
        (entry,) = self.json("agents", "list")["agents"]
        self.assertEqual(entry["saved"], baseline, "an old-key save never confirms")
        self.save(rekeyed["key"], item)
        self.assertEqual(self.read()["unchanged"], 1)
        (entry,) = self.json("agents", "list")["agents"]
        self.assertGreater(entry["saved"], baseline, "an unchanged new-key save does")

    def test_a_confirm_that_fails_is_harmless(self) -> None:
        self.save(self.key, {"title": "A", "content": "a"})
        with patch.object(Inbox, "received", side_effect=InboxError("down")):
            self.assertEqual(self.read()["added"], 1)
        self.assertEqual(self.read()["unchanged"], 1)

    def test_an_unreachable_store_reads_as_unreachable(self) -> None:
        self.wrangler.side_effect = lambda args, **_: subprocess.CompletedProcess(
            args, 1, "", "offline"
        )
        with patch("lore.deploy.time.sleep"):
            self.assertEqual(self.read()["state"], "unreachable")

    def test_rotate_keeps_the_agent_and_stops_the_old_key(self) -> None:
        rotated = self.json("agents", "key", self.source)
        self.assertEqual(
            set(rotated),
            {"source", "agent", "mcp_url", "connector_url", "key", "header", "prompt"},
        )
        self.assertEqual(
            (rotated["source"], rotated["agent"]["id"]),
            (self.source, self.handed["agent"]["id"]),
        )
        self.assertIn(rotated["key"], rotated["prompt"])
        denied = httpx2.post(
            f"{self.node.url}/agent",
            json={"id": 1, "method": "ping"},
            headers={"Authorization": f"Bearer {self.key}"},
        )
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(
            len(self.save(rotated["key"], {"title": "t", "content": "c"})["saved"]), 1
        )

    def test_revoke_keep_brings_in_what_waits_then_disconnects(self) -> None:
        self.save(self.key, {"title": "Late", "content": "Saved just before."})
        removed = self.json("agents", "revoke", self.source, "--keep")
        self.assertEqual(
            removed, {"name": self.source, "removed": True, "memories": {"kept": 1}}
        )
        self.assertEqual(set(self.memories(self.source)), {"Late"})
        self.assertIsNone(self.endpoint.agent(f"Bearer {self.key}"))
        self.assertEqual(self.json("agents", "list"), {"agents": []})

    def test_what_it_saved_still_says_who_after_it_is_disconnected(self) -> None:
        # APP-213: the agent is on record by its own name and app, which outlive its key.
        self.save(self.key, {"title": "Late", "content": "Saved just before."})
        self.read()
        self.json("agents", "revoke", self.source, "--keep")
        [item] = build()["library"]["items"]  # type: ignore[index]
        self.assertEqual(
            [{k: v for k, v in s.items() if k != "at"} for s in item["sources"]],
            [{"kind": "agent", "id": self.source, "label": "Grok", "mark": "grok"}],
        )

    def test_revoke_delete_removes_what_it_saved_except_what_is_cited(self) -> None:
        self.save(
            self.key, {"title": "A", "content": "a"}, {"title": "B", "content": "b"}
        )
        self.read()
        with Store() as store:
            cited = next(m for m in store.search("B") if m.source == self.source)
            store.add_publication(
                title="Claim",
                content="a bounded claim",
                topic="pricing",
                provenance=[cited.id],
            )
        removed = self.json("agents", "revoke", self.source, "--delete")
        self.assertEqual(removed["memories"], {"deleted": 1, "kept": 1})
        self.assertIsNone(self.endpoint.agent(f"Bearer {self.key}"))

    def test_an_unknown_agent_is_a_plain_error(self) -> None:
        for argv in (
            ("agents", "key", "agent-nope"),
            ("agents", "revoke", "agent-nope", "--keep"),
        ):
            with self.subTest(argv=argv):
                self.assertEqual(self.lore(*argv)[0], 2)

    def test_only_the_owner_hands_out_or_takes_back_a_key(self) -> None:
        source = self.handed["source"]
        with (
            patch.object(cli, "_attended", return_value=False),
            patch.object(cli, "_interactive", return_value=False),
        ):
            for argv, what in (
                (
                    ("agents", "connect", "Claude", "--app", "claude"),
                    "connecting an agent",
                ),
                (("agents", "key", source), "giving an agent a new key"),
                (("agents", "revoke", source, "--delete"), "disconnecting an agent"),
            ):
                with self.subTest(argv=argv):
                    commands = len(self.d1.commands)
                    with captured(), patch("sys.stderr") as err:
                        self.assertEqual(cli.main([*argv, "--json"]), 1)
                    said = "".join(call.args[0] for call in err.write.call_args_list)
                    self.assertIn(f"{what} needs an attended terminal", said)
                    self.assertEqual(
                        len(self.d1.commands), commands, "the store is never asked"
                    )
            # What an agent saved, and what waits, are anyone's to read.
            self.assertEqual(len(self.json("agents", "list")["agents"]), 1)
            self.assertEqual(self.json("agents", "waiting")["waiting"], 0)
        self.assertIsNotNone(
            self.endpoint.agent(f"Bearer {self.key}"), "its key still works"
        )

    def test_list_and_waiting_shapes(self) -> None:
        self.save(self.key, {"title": "A", "content": "a"})
        listed = self.json("agents", "list")
        self.assertEqual(
            listed,
            {
                "agents": [
                    {
                        "source": self.source,
                        "name": "Grok",
                        "app": "grok",
                        "saved": 1,
                        "waiting": 1,
                        "last_saved_at": listed["agents"][0]["last_saved_at"],
                        "memories": 0,
                        "revoked": False,
                    }
                ]
            },
        )
        self.assertIsNotNone(listed["agents"][0]["last_saved_at"])
        self.assertEqual(
            self.json("agents", "waiting"), {"waiting": 1, "sources": [self.source]}
        )
        self.read()
        self.assertEqual(self.json("agents", "list")["agents"][0]["memories"], 1)

    def test_the_catalog_list_and_snapshot_show_the_agent_and_its_app(self) -> None:
        self.save(self.key, {"title": "A", "content": "a"})
        self.read()
        app = next(a for a in Connector.catalog() if a.id == "agent")
        self.assertEqual(
            (app.name, app.kind, app.refresh), ("Personal agent", "agent", True)
        )
        listed = next(e for e in self.json_list() if e["name"] == self.source)
        shown = next(
            e for e in build()["library"]["sources"] if e["name"] == self.source
        )  # type: ignore[index]
        for entry in (listed, shown):
            self.assertEqual(
                {
                    k: entry[k]
                    for k in ("label", "kind", "connector", "app", "imported", "state")
                },
                {
                    "label": "Grok",
                    "kind": "agent",
                    "connector": "agent",
                    "app": "grok",
                    "imported": 1,
                    "state": "connected",
                },
            )

    def json_list(self) -> list[dict]:
        return json.loads(self.lore("sources", "list", "--json")[1])

    def test_the_reading_routine_and_check_in_include_agent_saves(self) -> None:
        routines = automation.Routines(
            clock=lambda: datetime(2026, 10, 14, 9).astimezone()
        )
        routines.change("checkin", paused=False)
        self.save(
            self.key,
            {
                "title": "Pushed back on pricing",
                "content": "Held firm at the budget tier.",
            },
        )
        reading = automation.Routines().run("synthesis")
        self.assertIn("1 new save", str(automation.Routines().list()))
        self.assertEqual(reading["reads"][-1]["added"], 1)  # type: ignore[index]
        ran = automation.Routines(
            clock=lambda: datetime(2026, 10, 14, 18).astimezone()
        ).run("checkin")
        self.assertEqual([i["source"] for i in ran["items"]], [self.source])  # type: ignore[union-attr]


class WaitingTest(AgentCase):
    def test_with_no_agent_connected_waiting_asks_nobody(self) -> None:
        self.assertEqual(self.json("agents", "waiting"), {"waiting": 0, "sources": []})
        self.assertEqual(self.json("agents", "list"), {"agents": []})
        self.wrangler.assert_not_called()
        self.assertEqual(self.keyring.saved, {})

    def test_waiting_is_one_query(self) -> None:
        handed = self.connect()
        self.save(handed["key"], {"title": "A", "content": "a"})
        self.wrangler.reset_mock()
        self.assertEqual(self.json("agents", "waiting")["waiting"], 1)
        self.assertEqual(self.wrangler.call_count, 1)


class PushTest(AgentCase):
    def test_a_push_keeps_the_agent_tables_and_always_carries_the_keys(self) -> None:
        handed = self.connect()
        self.save(handed["key"], {"title": "A", "content": "a"})
        worker = self.store
        (worker / "wrangler.jsonc").write_text("{}\n")
        with captured():
            self.assertEqual(cli.push_job(worker, False), 0)
            self.assertEqual(cli.push_job(worker, False), 0)
        db = sqlite3.connect(self.d1.path)
        settings = dict(db.execute("SELECT key, value FROM node_settings").fetchall())
        self.assertEqual(
            {k: settings[k] for k in ("inbox_public_key", "inbox_salt")},
            Inbox().settings(),
        )
        self.assertEqual(db.execute("SELECT count(*) FROM agents").fetchone()[0], 1)
        self.assertEqual(db.execute("SELECT count(*) FROM inbox").fetchone()[0], 1)
        self.assertEqual(
            len(self.save(handed["key"], {"title": "B", "content": "b"})["saved"]), 1
        )

    def test_a_push_before_any_agent_carries_no_keys(self) -> None:
        with Store() as store:
            answer = store.answer_settings()
        self.assertNotIn(
            "inbox_", cli._push_sql([], answer, "", inbox=Inbox().settings())
        )
