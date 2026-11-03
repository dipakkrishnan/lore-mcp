"""`python -m lore desktop-state`, run as the desktop app runs it (XC-097).

`tests/test_snapshot.py` and `tests/test_sources.py` build the snapshot in
process. These tests start the real CLI, so the contract the app reads is the
one a separate interpreter prints: complete, safe, and the same as `build()`.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from helpers import LoreTestCase, serving

from lore import automation, blueprint, capture, snapshot
from lore.paths import home
from lore.store import AnswerSettings, Store

ROOT = Path(__file__).resolve().parents[2]


class DesktopStateTest(LoreTestCase):
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
                # An empty profile names no agent, so Lore reads, each morning.
                "schedule": {
                    "paused": False,
                    "cadence": "daily",
                    "hour": 9,
                    "day": 0,
                    "last_run": None,
                    "missed": False,
                },
                "telemetry_enabled": True,
                "telemetry_noticed": False,
                "automations_noticed": False,
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
                "sources",
                "arrival",
                "verdict",
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
            {
                "publication_usd": 0.01,
                "answer_usd": 0.1,
                "answer_enabled": True,
                "free_copies": 3,
            },
        )
        self.assertEqual(state["node"]["live"]["state"], "online")
        self.assertEqual(state["node"]["live"]["network"], "eip155:8453")
        # What the node charges, not what the owner last saved: the local
        # setting above is 0.01, the deployed node still advertises 0.02.
        self.assertEqual(state["node"]["live"]["price_usd"], 0.02)
        self.assertEqual(state["node"]["live"]["payout"], "0x" + "a" * 40)
        # Nothing on record of putting it online from this Mac: never offered an update (APP-231).
        self.assertEqual(state["node"]["store"], "unknown")


class TildeSourcesTest(LoreTestCase):
    def test_desktop_state_survives_sources_named_with_a_tilde(self) -> None:
        # Only `~/` means home: `~standup` and `~bob/x` would make Path raise.
        for path in ("~standup", "~bob/x"):
            capture.save(
                [{"title": path, "content": "we ship friday", "source_path": path}]
            )
        capture.save(
            [{"title": "Home", "content": "a note", "source_path": "~/notes/a.md"}]
        )
        result = subprocess.run(
            [sys.executable, "-m", "lore", "desktop-state"],
            env=os.environ.copy(),
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
