from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator
from unittest.mock import Mock, patch

from helpers import LoreTestCase, captured

from lore import automation, blueprint, cli, snapshot
from lore.paths import home
from lore.store import AnswerSettings, Store

ROOT = Path(__file__).parent.parent


@contextmanager
def serving(manifest: dict[str, object]) -> Iterator[str]:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            size = int(self.headers.get("Content-Length", "0"))
            message = json.loads(self.rfile.read(size))
            method = message["method"]
            if method == "notifications/initialized":
                self.send_response(202)
                self.end_headers()
                return
            result: dict[str, object]
            if method == "initialize":
                result = {"protocolVersion": "2025-06-18"}
            else:
                result = {"content": [{"type": "text", "text": json.dumps(manifest)}]}
            body = (
                "event: message\n"
                + "data: "
                + json.dumps(
                    {"jsonrpc": "2.0", "id": message.get("id"), "result": result}
                )
                + "\n\n"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            if method == "initialize":
                self.send_header("Mcp-Session-Id", "test-session")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/mcp"
    finally:
        server.shutdown()
        thread.join(timeout=5)


class DesktopSnapshotTest(LoreTestCase):
    def seed(self) -> dict[str, str]:
        memory_ids = {
            name: self.seed_memory(f"{name} memory")
            for name in ("live", "pending", "stale", "revoked")
        }
        with Store() as store:
            store.put(
                source="test",
                origin="native",
                source_path="safe",
                source_key="safe",
                fingerprint="safe",
                title="Safe private title",
                content="PRIVATE BODY SECRET",
                project="-Users-owner-code-juniper",
            )
            store.set_setting("sources", ["codex"])
            store.set_setting("price_usd", 0.01)
            store.set_answer_settings(
                AnswerSettings(
                    proxy_preamble="PROXY SECRET",
                    answer_price_usd=0.1,
                    answer_enabled=True,
                )
            )
            for name, memory_id in memory_ids.items():
                publication_id = store.add_publication(
                    title=f"{name.title()} publication",
                    content=f"PUBLICATION BODY SECRET {name}",
                    topic="testing",
                    teaser=f"Safe {name} teaser",
                    provenance=[memory_id],
                )
                if name == "revoked":
                    store.revoke_publication(publication_id)
            store.put(
                source="test",
                origin="native",
                source_path="stale memory",
                source_key="stale memory",
                fingerprint="changed",
                title="Stale memory",
                content="changed",
            )
            return {
                str(item["title"]): str(item["public_id"])
                for item in store.publication_inventory()
            }

    def test_subprocess_returns_the_complete_safe_contract(self) -> None:
        ids = self.seed()
        project = self.claude_home / "projects" / "-Users-owner-code-juniper"
        project.mkdir(parents=True)
        (project / "broken.jsonl").write_text("not json\n")
        (project / "session.jsonl").write_text(
            '{"type":"queue-operation"}\n{"cwd":"/Users/owner/code/juniper"}\n'
        )
        silent = self.claude_home / "projects" / "-Users-owner-code-silent"
        silent.mkdir()
        (silent / "session.jsonl").write_text('[]\n{"cwd":""}\n')
        with Store() as store:
            store.put(
                source="test",
                origin="native",
                source_path="silent",
                source_key="silent",
                fingerprint="silent",
                title="Silent project",
                content="no session names it",
                project="-Users-owner-code-silent",
            )
        blueprint.blueprint_path().parent.mkdir(parents=True, exist_ok=True)
        blueprint.blueprint_path().write_text("{}")
        automation.profile_path().parent.mkdir(parents=True, exist_ok=True)
        automation.profile_path().write_text("{}")
        live_ids = [ids["Live publication"], ids["Stale publication"]]
        manifest = {
            "manifest_version": 1,
            "publication_count": len(live_ids),
            "topics": {
                "testing": [
                    {"id": public_id, "teaser": "safe"} for public_id in live_ids
                ]
            },
            "price_usd": 0.02,
            "payout": "0x" + "a" * 40,
            "answer_price_usd": 0.11,
            "network": "eip155:8453",
        }
        with serving(manifest) as url:
            with Store() as store:
                store.set_setting("node_url", url)
            direct = snapshot.build()
            result = subprocess.run(
                [sys.executable, "-m", "lore", "desktop-state"],
                cwd=ROOT,
                env=os.environ.copy(),
                capture_output=True,
                text=True,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("\x1b", result.stdout)
        self.assertNotIn("PRIVATE BODY SECRET", result.stdout)
        self.assertNotIn("PUBLICATION BODY SECRET", result.stdout)
        self.assertNotIn("PROXY SECRET", result.stdout)
        state = json.loads(result.stdout)
        self.assertEqual(state, direct)
        self.assertEqual(state["version"], 1)
        self.assertEqual(
            state["setup"],
            {
                "sources_configured": True,
                "blueprint_configured": True,
                "profile_configured": True,
            },
        )
        self.assertEqual(state["library"]["counts"], {"private": 6})
        self.assertEqual(
            set(state["library"]["items"][0]),
            {
                "id",
                "title",
                "project_label",
                "status",
                "updated_at",
            },
        )
        labels = {
            item["title"]: item["project_label"] for item in state["library"]["items"]
        }
        self.assertEqual(labels["Safe private title"], "juniper")
        self.assertEqual(labels["live memory"], "")
        self.assertEqual(
            labels["Silent project"],
            "-Users-owner-code-silent".removeprefix(
                "-" + str(Path.home()).strip("/").replace("/", "-") + "-"
            ),
        )
        self.assertEqual(state["home"], str(home()))
        self.assertEqual(
            state["publications"]["counts"],
            {"active": 3, "revoked": 1},
        )
        self.assertEqual(
            set(state["publications"]["items"][0]),
            {
                "id",
                "public_id",
                "title",
                "topic",
                "state",
                "live",
            },
        )
        self.assertEqual(
            state["pricing"],
            {"publication_usd": 0.01, "answer_usd": 0.1, "answer_enabled": True},
        )
        self.assertEqual(state["node"]["live"]["state"], "online")
        self.assertEqual(state["node"]["live"]["network"], "eip155:8453")
        self.assertEqual(state["node"]["live"]["payout"], "0x" + "a" * 40)

    def test_missing_and_unreachable_nodes_are_data(self) -> None:
        response = Mock()
        response.read.return_value = b'{"jsonrpc":"2.0"}'
        response.headers.get_content_type.return_value = "application/json"
        self.assertEqual(snapshot._response(response), {"jsonrpc": "2.0"})
        state = snapshot.build()
        self.assertEqual(state["node"]["live"]["state"], "not_configured")
        with Store() as store:
            store.set_setting("node_url", "https://offline.example/mcp")
        with patch("lore.snapshot._remote_manifest", side_effect=OSError("offline")):
            with captured() as output:
                self.assertEqual(cli.main(["desktop-state"]), 0)
        state = json.loads(output.getvalue())
        self.assertEqual(state["node"]["live"]["state"], "unreachable")
        self.assertEqual(state["node"]["live"]["network"], None)
        self.assertEqual(state["node"]["live"]["payout"], None)

    def test_the_node_probe_is_cached_briefly_and_forgotten_after_a_push(self) -> None:
        with Store() as store:
            store.set_setting("node_url", "https://offline.example/mcp")
        with patch(
            "lore.snapshot._remote_manifest", side_effect=OSError("offline")
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
            "lore.snapshot._remote_manifest",
            side_effect=ValueError("event-stream response had no data line"),
        ):
            with captured() as output:
                self.assertEqual(cli.main(["desktop-state"]), 0)
        state = json.loads(output.getvalue())
        self.assertEqual(state["node"]["live"]["state"], "unreachable")


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
        self.assertNotEqual(items[0]["status"], "succeeded")

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
