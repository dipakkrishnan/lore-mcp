"""Table tests for `snapshot.assemble` and `snapshot.fresh_live` (XC-105): the
desktop snapshot from plain data, and the probe cache's rule. No store, no
network, no file system; `tests/test_snapshot.py` keeps `build` against a real
tmp store as the component tier, and the desktop walks keep it end to end."""

from __future__ import annotations

import copy
import unittest

import hermetic  # noqa: F401  (no test may reach a real Cloudflare account)

from lore import snapshot
from lore.store import Collection, CollectionPiece, JobKind, JobStatus, OwnerJob

ONLINE: dict[str, object] = {
    "state": "online",
    "network": "eip155:84532",
    "price_usd": 0.02,
    "payout": "0x" + "a" * 40,
}
NOT_CONFIGURED: dict[str, object] = {
    "state": "not_configured",
    "network": None,
    "price_usd": None,
    "payout": None,
}


def memory(id: int, project: str, status: str = "private") -> dict[str, object]:
    return {
        "id": id,
        "title": f"Memory {id}",
        "project": project,
        "status": status,
        "updated_at": "2026-01-02T00:00:00Z",
        "arrival": "2026-01-01T00:00:00Z",
        "source": "claude",
        "origin": "native",
        "source_path": "/private/session.jsonl",
        "sources": [],
        "verdict": None,
    }


def publication(id: int, active: int) -> dict[str, object]:
    return {
        "id": id,
        "public_id": f"pub-{id}",
        "title": f"Piece {id}",
        "topic": "testing",
        "active": active,
    }


def rows(**overrides: object) -> snapshot.Rows:
    fields: dict[str, object] = {
        "sources_configured": True,
        "sources": [{"name": "claude", "state": "ready"}],
        "memories": [
            memory(1, "-Users-owner-code-app"),
            memory(2, "-Users-owner-notes", status="archived"),
            memory(3, "-Users-owner-code-app"),
        ],
        "publications": [publication(1, 1), publication(2, 0), publication(3, 1)],
        "collections": [],
        "publication_price": 0.5,
        "answer_price": 0.11,
        "answer_enabled": True,
        "free_copies": 1,
        "telemetry_enabled": True,
        "telemetry_noticed": False,
        "automations_noticed": False,
        "node_url": "https://store.example/mcp",
        "node_selling": True,
        "agents_url": "https://store.example/agent",
        "jobs": [],
    }
    return snapshot.Rows(**(fields | overrides))  # type: ignore[arg-type]


def surroundings(**overrides: object) -> snapshot.Surroundings:
    fields: dict[str, object] = {
        "home": "/Users/owner/.lore",
        "slug_prefix": "-Users-owner-",
        "project_labels": {"-Users-owner-code-app": "app"},
        "blueprint_configured": True,
        "profile_configured": False,
        "schedule": {"configured": False},
        "feedback_available": True,
        "store_state": "current",
    }
    return snapshot.Surroundings(**(fields | overrides))  # type: ignore[arg-type]


class AssembleTest(unittest.TestCase):
    def test_the_inputs_are_left_as_they_were(self) -> None:
        given = rows()
        before = copy.deepcopy(given)
        snapshot.assemble(given, (ONLINE, {"pub-1"}), surroundings())
        self.assertEqual(given, before)

    def test_memories_lose_their_internals_and_gain_a_project_label(self) -> None:
        state = snapshot.assemble(rows(), (ONLINE, {"pub-1"}), surroundings())
        library = state["library"]
        assert isinstance(library, dict)
        items = library["items"]
        self.assertEqual(
            [set(item) for item in items],
            [
                {
                    "id",
                    "title",
                    "status",
                    "updated_at",
                    "arrival",
                    "sources",
                    "verdict",
                    "project_label",
                }
            ]
            * 3,
        )
        # A labelled slug takes its label; an unlabelled one under the owner's
        # home drops the home's prefix and stays a slug.
        self.assertEqual(
            [item["project_label"] for item in items], ["app", "notes", "app"]
        )
        self.assertEqual(library["counts"], {"private": 2})
        self.assertEqual(library["sources"], [{"name": "claude", "state": "ready"}])

    def test_a_slug_outside_the_home_is_kept_whole(self) -> None:
        state = snapshot.assemble(
            rows(memories=[memory(1, "-tmp-scratch")]), (ONLINE, None), surroundings()
        )
        library = state["library"]
        assert isinstance(library, dict)
        self.assertEqual(library["items"][0]["project_label"], "-tmp-scratch")

    def test_publications_carry_a_state_and_whether_the_node_serves_them(self) -> None:
        state = snapshot.assemble(rows(), (ONLINE, {"pub-1"}), surroundings())
        publications = state["publications"]
        assert isinstance(publications, dict)
        self.assertEqual(publications["counts"], {"active": 2, "revoked": 1})
        self.assertEqual(
            [(p["state"], p["live"]) for p in publications["items"]],
            [("approved", True), ("revoked", False), ("approved", False)],
        )
        self.assertNotIn("active", publications["items"][0])

    def test_an_unknown_node_says_nothing_about_what_is_live(self) -> None:
        state = snapshot.assemble(rows(), (NOT_CONFIGURED, None), surroundings())
        publications = state["publications"]
        assert isinstance(publications, dict)
        self.assertEqual([p["live"] for p in publications["items"]], [None] * 3)

    def test_collections_value_their_active_pieces_at_the_piece_price(self) -> None:
        collection = Collection(
            id=1,
            public_id="col-1",
            title="Bundle",
            price_usd=2.0,
            updated_at="2026-01-03T00:00:00Z",
            pieces=[
                CollectionPiece(
                    id=1, public_id="pub-1", title="One", teaser="", active=True
                ),
                CollectionPiece(
                    id=2, public_id="pub-2", title="Two", teaser="", active=False
                ),
                CollectionPiece(
                    id=3, public_id="pub-3", title="Three", teaser="", active=True
                ),
            ],
        )
        state = snapshot.assemble(
            rows(collections=[collection], publication_price=0.5),
            (ONLINE, None),
            surroundings(),
        )
        collections = state["collections"]
        assert isinstance(collections, dict)
        self.assertEqual(
            collections["items"],
            [
                {
                    "id": 1,
                    "public_id": "col-1",
                    "title": "Bundle",
                    "price_usd": 2.0,
                    "on_sale": True,
                    "pieces": [
                        {"id": 1, "public_id": "pub-1", "title": "One"},
                        {"id": 3, "public_id": "pub-3", "title": "Three"},
                    ],
                    "value_usd": 1.0,
                }
            ],
        )

    def test_a_price_that_is_not_a_number_values_collections_at_nothing(self) -> None:
        collection = Collection(
            id=1,
            public_id="col-1",
            title="Bundle",
            price_usd=2.0,
            updated_at="2026-01-03T00:00:00Z",
            pieces=[
                CollectionPiece(
                    id=1, public_id="pub-1", title="One", teaser="", active=True
                )
            ],
        )
        for price in (None, "0.5"):
            with self.subTest(price=price):
                state = snapshot.assemble(
                    rows(collections=[collection], publication_price=price),
                    (ONLINE, None),
                    surroundings(),
                )
                collections = state["collections"]
                assert isinstance(collections, dict)
                self.assertEqual(collections["items"][0]["value_usd"], 0.0)
                pricing = state["pricing"]
                assert isinstance(pricing, dict)
                self.assertEqual(pricing["publication_usd"], price)

    def test_the_answer_price_shows_only_while_answers_are_on(self) -> None:
        on = snapshot.assemble(rows(), (ONLINE, None), surroundings())
        off = snapshot.assemble(
            rows(answer_enabled=False), (ONLINE, None), surroundings()
        )
        self.assertEqual(
            on["pricing"],
            {
                "publication_usd": 0.5,
                "answer_usd": 0.11,
                "answer_enabled": True,
                "free_copies": 1,
            },
        )
        pricing = off["pricing"]
        assert isinstance(pricing, dict)
        self.assertIsNone(pricing["answer_usd"])
        self.assertFalse(pricing["answer_enabled"])

    def test_setup_feedback_and_node_pass_through_as_read(self) -> None:
        state = snapshot.assemble(
            rows(telemetry_noticed=True, automations_noticed=True, node_selling=False),
            (ONLINE, None),
            surroundings(profile_configured=True, feedback_available=False),
        )
        self.assertEqual(state["version"], 1)
        self.assertEqual(state["home"], "/Users/owner/.lore")
        self.assertEqual(
            state["setup"],
            {
                "sources_configured": True,
                "blueprint_configured": True,
                "profile_configured": True,
                "schedule": {"configured": False},
                "telemetry_enabled": True,
                "telemetry_noticed": True,
                "automations_noticed": True,
            },
        )
        self.assertEqual(state["feedback"], {"available": False})
        self.assertEqual(
            state["node"],
            {
                "url": "https://store.example/mcp",
                "agents": "https://store.example/agent",
                "selling": False,
                "store": "current",
                "live": ONLINE,
            },
        )

    def test_jobs_get_their_prose_from_the_summary_code(self) -> None:
        jobs = [
            OwnerJob(
                id=7,
                kind=JobKind.PUSH,
                status=JobStatus.SUCCEEDED,
                title="Push",
                summary="pushed",
                count=2,
                started_at="2026-01-04T00:00:00Z",
                finished_at="2026-01-04T00:00:05Z",
            ),
            OwnerJob(
                id=8,
                kind=JobKind.DEPLOY,
                status=JobStatus.INCOMPLETE,
                started_at="2026-01-05T00:00:00Z",
            ),
        ]
        state = snapshot.assemble(rows(jobs=jobs), (ONLINE, None), surroundings())
        self.assertEqual(
            state["jobs"],
            {
                "items": [
                    {
                        "id": 7,
                        "kind": "push",
                        "status": "succeeded",
                        "title": "Push",
                        "summary": "Saved what you approved"
                        if False
                        else snapshot.JOB_SUMMARIES["pushed"],
                        "count": 2,
                        "cost_usd": None,
                        "started_at": "2026-01-04T00:00:00Z",
                        "finished_at": "2026-01-04T00:00:05Z",
                    },
                    {
                        "id": 8,
                        "kind": "deploy",
                        "status": "incomplete",
                        "title": "",
                        "summary": "",
                        "count": None,
                        "cost_usd": None,
                        "started_at": "2026-01-05T00:00:00Z",
                        "finished_at": None,
                    },
                ]
            },
        )

    def test_an_empty_store_is_empty_sections_not_missing_ones(self) -> None:
        state = snapshot.assemble(
            rows(
                sources_configured=False,
                sources=[],
                memories=[],
                publications=[],
                node_url=None,
                node_selling=False,
                agents_url=None,
            ),
            (NOT_CONFIGURED, None),
            surroundings(store_state="unknown", project_labels={}),
        )
        self.assertEqual(
            state["library"], {"counts": {"private": 0}, "sources": [], "items": []}
        )
        self.assertEqual(
            state["publications"], {"counts": {"active": 0, "revoked": 0}, "items": []}
        )
        self.assertEqual(state["collections"], {"items": []})
        self.assertEqual(state["jobs"], {"items": []})
        node = state["node"]
        assert isinstance(node, dict)
        self.assertIsNone(node["url"])
        self.assertEqual(node["store"], "unknown")


class FreshLiveTest(unittest.TestCase):
    URL = "https://store.example/mcp"

    def cached(self, **overrides: object) -> dict[str, object]:
        kept: dict[str, object] = {
            "url": self.URL,
            "checked_at": 1_000.0,
            "live": dict(ONLINE),
            "ids": ["pub-2", "pub-1"],
        }
        return kept | overrides

    def test_a_fresh_answer_for_the_same_address_is_served(self) -> None:
        kept = snapshot.fresh_live(self.cached(), self.URL, 1_000.0 + 59.9)
        self.assertEqual(kept, (ONLINE, {"pub-1", "pub-2"}))

    def test_the_answer_expires_at_the_cache_window(self) -> None:
        self.assertIsNone(
            snapshot.fresh_live(
                self.cached(), self.URL, 1_000.0 + snapshot.LIVE_CACHE_SECONDS
            )
        )

    def test_another_address_is_never_served_from_cache(self) -> None:
        self.assertIsNone(
            snapshot.fresh_live(self.cached(), "https://elsewhere.example/mcp", 1_001.0)
        )

    def test_what_is_not_a_probe_answer_is_not_one(self) -> None:
        for cached in (None, "online", [], {"live": ONLINE}):
            with self.subTest(cached=cached):
                self.assertIsNone(snapshot.fresh_live(cached, self.URL, 1_001.0))

    def test_a_missing_checked_at_is_the_dawn_of_time(self) -> None:
        kept = self.cached()
        del kept["checked_at"]
        self.assertIsNone(snapshot.fresh_live(kept, self.URL, 1_000.0))
        self.assertIsNotNone(snapshot.fresh_live(kept, self.URL, 1.0))

    def test_a_cache_written_before_the_price_existed_still_serves(self) -> None:
        kept = snapshot.fresh_live(
            self.cached(live={"state": "online", "network": "eip155:8453"}, ids=None),
            self.URL,
            1_001.0,
        )
        self.assertEqual(
            kept,
            ({"state": "online", "network": "eip155:8453", "price_usd": None}, None),
        )

    def test_the_kept_record_is_not_handed_back_by_reference(self) -> None:
        cached = self.cached(live={"state": "online"})
        kept = snapshot.fresh_live(cached, self.URL, 1_001.0)
        assert kept is not None
        self.assertEqual(cached["live"], {"state": "online"}, "the cache was changed")
        self.assertIsNot(kept[0], cached["live"])


if __name__ == "__main__":
    unittest.main()
