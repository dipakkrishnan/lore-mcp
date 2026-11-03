from __future__ import annotations

import json
import os
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from helpers import LoreTestCase, captured

from lore import automation, cli, snapshot, sources
from lore.store import Store

ROOT = Path(__file__).parent.parent


class DesktopSnapshotTest(LoreTestCase):
    def test_the_schedule_is_the_profiles_rhythm_kept_by_lore(self) -> None:
        automation.save_profile({"cadence": "weekly", "hour": 21, "day": 6})
        state = snapshot.build()["setup"]
        self.assertTrue(state["profile_configured"])
        self.assertEqual(
            {key: state["schedule"][key] for key in ("cadence", "hour", "day")},
            {"cadence": "weekly", "hour": 21, "day": 6},
        )

    def test_telemetry_enabled_defaults_true_and_reflects_the_setting(self) -> None:
        self.assertTrue(snapshot.build()["setup"]["telemetry_enabled"])
        with Store() as store:
            store.set_setting("telemetry_enabled", False)
        self.assertFalse(snapshot.build()["setup"]["telemetry_enabled"])

    def test_every_source_carries_its_state_and_last_read(self) -> None:
        vault = Path(self.tmp.name) / "vault"
        vault.mkdir()
        (vault / "note.md").write_text("# Note\n\nA lesson long enough to keep here.")
        (self.codex_home / "memories").mkdir(parents=True)
        (self.claude_home / "projects").mkdir(parents=True)
        with Store() as store:
            store.set_setting("sources", ["codex"])
            added = sources.Registry(store).add(str(vault))
        entries = snapshot.build()["library"]["sources"]
        self.assertEqual(
            [set(entry) for entry in entries],
            [
                {
                    "name",
                    "label",
                    "kind",
                    "locator",
                    "owned",
                    "connector",
                    "refresh",
                    "app",
                    "enabled",
                    "imported",
                    "state",
                    "last_read_at",
                }
            ]
            * 3,
        )
        by_name = {entry["name"]: entry for entry in entries}
        # Synthesis is Lore's own output, never a source the owner connects.
        self.assertNotIn("automation", by_name)
        # An enabled built-in with nothing in it is not connected.
        self.assertEqual(by_name["codex"]["state"], "nothing_found")
        self.assertIsNone(by_name["codex"]["last_read_at"])
        self.assertEqual(by_name["claude"]["state"], "off")
        self.assertIsNone(by_name["claude"]["last_read_at"])
        owner = by_name[added["name"]]
        self.assertEqual(owner["state"], "connected")
        self.assertEqual(owner["locator"], str(vault.resolve()))
        self.assertEqual(owner["imported"], 1)
        self.assertTrue(owner["owned"])
        self.assertTrue(str(owner["last_read_at"]).startswith("20"))

    def test_missing_and_unreachable_nodes_are_data(self) -> None:
        response = Mock()
        response.read.return_value = b'{"jsonrpc":"2.0"}'
        response.headers.get_content_type.return_value = "application/json"
        self.assertEqual(snapshot._response(response), {"jsonrpc": "2.0"})
        state = snapshot.build()
        self.assertEqual(state["node"]["live"]["state"], "not_configured")
        self.assertEqual(state["node"]["live"]["price_usd"], None)
        self.assertFalse(state["node"]["selling"])
        with Store() as store:
            store.set_setting("node_url", "https://offline.example/mcp")
        with patch("lore.snapshot.remote_manifest", side_effect=OSError("offline")):
            with captured() as output:
                self.assertEqual(cli.main(["desktop-state"]), 0)
        state = json.loads(output.getvalue())
        self.assertEqual(state["node"]["live"]["state"], "unreachable")
        # A store from before XC-069 recorded no choice: it sells, as it did.
        self.assertTrue(state["node"]["selling"])
        self.assertEqual(state["node"]["live"]["network"], None)
        self.assertEqual(state["node"]["live"]["payout"], None)
        # A node we cannot reach tells us nothing about its price, and the app
        # must never name an amount it did not read.
        self.assertEqual(state["node"]["live"]["price_usd"], None)

    def test_a_node_that_advertises_no_price_is_online_without_one(self) -> None:
        """A node deployed before `discover` carried the price is still live;
        the app just has nothing to say about what it charges."""
        manifest = {"manifest_version": 1, "topics": {}, "network": "eip155:84532"}
        with serving(manifest) as url:
            with Store() as store:
                store.set_setting("node_url", url)
            state = snapshot.build()
        self.assertEqual(state["node"]["live"]["state"], "online")
        self.assertEqual(state["node"]["live"]["price_usd"], None)

    def test_a_cache_written_before_the_price_existed_still_serves(self) -> None:
        with Store() as store:
            store.set_setting("node_url", "https://cached.example/mcp")
            store.set_setting(
                "node_live",
                {
                    "url": "https://cached.example/mcp",
                    "checked_at": time.time(),
                    "live": {"state": "online", "network": "eip155:8453"},
                    "ids": [],
                },
            )
        with patch("lore.snapshot.remote_manifest", side_effect=OSError) as probe:
            state = snapshot.build()
        self.assertEqual(probe.call_count, 0, "the fresh cache is still trusted")
        self.assertEqual(state["node"]["live"]["state"], "online")
        self.assertEqual(state["node"]["live"]["price_usd"], None)

    def test_the_node_probe_is_cached_briefly_and_forgotten_after_a_push(self) -> None:
        with Store() as store:
            store.set_setting("node_url", "https://offline.example/mcp")
        with patch(
            "lore.snapshot.remote_manifest", side_effect=OSError("offline")
        ) as probe:
            snapshot.build()
            state = snapshot.build()
            self.assertEqual(probe.call_count, 1)
            self.assertEqual(state["node"]["live"]["state"], "unreachable")
            snapshot.forget_live()
            snapshot.build()
            self.assertEqual(probe.call_count, 2)
            with Store() as store:
                store.set_setting("node_url", "https://elsewhere.example/mcp")
            snapshot.build()
            self.assertEqual(
                probe.call_count, 3, "a new address is never served from cache"
            )
            with patch("lore.snapshot.time.time", return_value=time.time() + 61):
                snapshot.build()
            self.assertEqual(probe.call_count, 4, "the cache expires")

    def test_event_stream_with_no_data_line_is_unreachable_not_a_crash(self) -> None:
        response = Mock()
        response.read.return_value = b"event: heartbeat\n\n"
        response.headers.get_content_type.return_value = "text/event-stream"
        with self.assertRaises(ValueError):
            snapshot._response(response)
        with Store() as store:
            store.set_setting("node_url", "https://cold-start.example/mcp")
        with patch(
            "lore.snapshot.remote_manifest",
            side_effect=ValueError("event-stream response had no data line"),
        ):
            with captured() as output:
                self.assertEqual(cli.main(["desktop-state"]), 0)
        state = json.loads(output.getvalue())
        self.assertEqual(state["node"]["live"]["state"], "unreachable")


class UnreadableClaudeCodeTest(LoreTestCase):
    def test_a_claude_code_folder_lore_cant_open_never_stops_the_snapshot(self) -> None:
        # APP-215: an owner who hasn't let Lore into Claude Code's notes yet still gets the app, not "could not load".
        projects = self.claude_home / "projects"
        (projects / "demo").mkdir(parents=True)
        projects.chmod(0o000)
        self.addCleanup(projects.chmod, 0o755)
        built = snapshot.build()
        self.assertEqual(built["library"]["counts"]["private"], 0)


class SnapshotJobsTest(LoreTestCase):
    """Owner-run history reaches the desktop app through the snapshot, so the
    app never needs its own database access to show what ran."""

    def test_recent_runs_are_exposed_with_prose_and_cost(self) -> None:
        with Store() as store:
            job_id = store.start_job(
                "capture", owner_pid=os.getpid(), timeout_minutes=720
            )
            store.finish_job(job_id, "succeeded", summary="captured", cost_usd=0.25)
        state = snapshot.build()
        self.assertEqual(state["version"], 1, "an added section is not a new contract")
        items = state["jobs"]["items"]  # type: ignore[index,call-overload]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["kind"], "capture")
        self.assertEqual(items[0]["status"], "succeeded")
        # The database stores a code; the reader gets the sentence.
        self.assertEqual(items[0]["summary"], "Saved what you approved")
        self.assertEqual(items[0]["cost_usd"], 0.25)

    def test_reading_the_snapshot_concedes_a_run_that_never_finished(self) -> None:
        # No scheduler watches for this. Every refresh and every relaunch reads
        # the snapshot, so that read is what notices.
        with Store() as store:
            store.start_job("capture", owner_pid=4_000_000, timeout_minutes=720)
        items = snapshot.build()["jobs"]["items"]  # type: ignore[index,call-overload]
        self.assertEqual(items[0]["status"], "incomplete")

    def test_the_liveness_columns_never_reach_the_snapshot(self) -> None:
        with Store() as store:
            store.start_job("push", owner_pid=os.getpid(), timeout_minutes=60)
        items = snapshot.build()["jobs"]["items"]  # type: ignore[index,call-overload]
        self.assertEqual(
            set(items[0]),
            {
                "id",
                "kind",
                "status",
                "title",
                "summary",
                "count",
                "cost_usd",
                "started_at",
                "finished_at",
            },
        )

    def test_an_empty_history_is_an_empty_list_not_a_missing_section(self) -> None:
        self.assertEqual(snapshot.build()["jobs"], {"items": []})


if __name__ == "__main__":
    unittest.main()
