"""Table tests for `cli.plan_push` (XC-105): what one push decides, from plain
data. No store, no process, no network; `tests/test_cli.py` keeps the push
against a real tmp store as the component tier."""

from __future__ import annotations

import unittest

import hermetic  # noqa: F401  (no test may reach a real Cloudflare account)

from lore import cli
from lore.store import (
    AnswerSettings,
    Collection,
    CollectionPiece,
    Publication,
    PublicationKind,
)


def piece(
    id: int, title: str, *, teaser: str = "", public_id: str | None = None
) -> Publication:
    return Publication(
        id=id,
        public_id=public_id or f"pub-{id}",
        title=title,
        content=f"what {title} says",
        kind=PublicationKind.CLAIM,
        teaser=teaser,
        provenance=[1],
        active=1,
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-02T00:00:00Z",
    )


def state(**overrides: object) -> cli.PushState:
    fields: dict[str, object] = {
        "publications": [piece(1, "First", teaser="an ad"), piece(2, "Second")],
        "unpriced": set(),
        "answer": AnswerSettings(),
        "listed_name": "",
        "stripe_account": "",
        "free_copies": 1,
        "support_email": "",
        "price_usd": 0.25,
        "collections": [],
        "choice": None,
        "inbox": {},
    }
    return cli.PushState(**(fields | overrides))  # type: ignore[arg-type]


class PlanPushTest(unittest.TestCase):
    def test_a_plain_push_carries_every_active_piece(self) -> None:
        plan = cli.plan_push(state(), local=False)
        self.assertEqual(plan.count, 2)
        self.assertIn("First", plan.script)
        self.assertIn("Second", plan.script)
        self.assertIsNone(plan.selling, "a store from before XC-069 sends no choice")
        self.assertNotIn("'selling'", plan.script)
        self.assertTrue(plan.remote)
        self.assertEqual(plan.said, "Pushed 2 active publications to the deployed node")

    def test_pieces_still_waiting_on_a_price_stay_home(self) -> None:
        plan = cli.plan_push(state(unpriced={2}), local=False)
        self.assertEqual(plan.count, 1)
        self.assertIn("First", plan.script)
        self.assertNotIn("Second", plan.script)

    def test_a_store_that_sells_nothing_ships_settings_and_inbox_keys_only(
        self,
    ) -> None:
        collection = Collection(
            id=1,
            public_id="col-1",
            title="Bundle",
            price_usd=2.0,
            updated_at="2026-01-03T00:00:00Z",
            pieces=[
                CollectionPiece(
                    id=1, public_id="pub-1", title="First", teaser="an ad", active=True
                )
            ],
        )
        inbox = {"inbox_public_key": "pk", "inbox_salt": "salt"}
        plan = cli.plan_push(
            state(choice=False, collections=[collection], inbox=inbox), local=False
        )
        self.assertEqual(plan.count, 0)
        self.assertIs(plan.selling, False)
        for text in ("First", "Second", "Bundle", "what First says"):
            self.assertNotIn(text, plan.script, "piece text left the Mac")
        self.assertIn("VALUES ('selling','false');", plan.script)
        self.assertIn("VALUES ('inbox_public_key','pk');", plan.script)
        self.assertIn("VALUES ('inbox_salt','salt');", plan.script)
        self.assertEqual(plan.said, "Pushed 0 active publications to the deployed node")

    def test_a_chosen_store_says_so(self) -> None:
        plan = cli.plan_push(state(choice=True), local=False)
        self.assertIs(plan.selling, True)
        self.assertIn("VALUES ('selling','true');", plan.script)
        self.assertEqual(plan.count, 2)

    def test_opening_the_store_sells_whatever_the_choice_was(self) -> None:
        for choice in (None, False, True):
            with self.subTest(choice=choice):
                plan = cli.plan_push(state(choice=choice), local=False, opening=True)
                self.assertIs(plan.selling, True)
                self.assertEqual(plan.count, 2)

    def test_a_local_push_always_sells_and_settles_nothing(self) -> None:
        plan = cli.plan_push(state(choice=False), local=True)
        self.assertIs(plan.selling, True)
        self.assertEqual(plan.count, 2)
        self.assertFalse(plan.remote)
        self.assertEqual(
            plan.said, "Pushed 2 active publications to the local dev database"
        )

    def test_one_piece_is_singular(self) -> None:
        plan = cli.plan_push(state(publications=[piece(1, "Only")]), local=False)
        self.assertEqual(plan.said, "Pushed 1 active publication to the deployed node")

    def test_the_price_travels_when_it_is_a_number(self) -> None:
        for price, carried in ((0.25, True), (3, True), (0, False), ("x", False)):
            with self.subTest(price=price):
                plan = cli.plan_push(state(price_usd=price), local=False)
                self.assertEqual("'price_usd'" in plan.script, carried)

    def test_settings_reach_the_script_as_given(self) -> None:
        plan = cli.plan_push(
            state(
                listed_name="Shane",
                stripe_account="acct_1",
                free_copies=3,
                support_email="help@example.com",
            ),
            local=False,
        )
        for key, value in (
            ("listed_name", "Shane"),
            ("stripe_account", "acct_1"),
            ("free_copies", "3"),
            ("support_email", "help@example.com"),
        ):
            self.assertIn(f"VALUES ('{key}','{value}');", plan.script)


class PushCommandTest(unittest.TestCase):
    def test_the_command_targets_the_edge_or_the_dev_database(self) -> None:
        plan = cli.plan_push(state(), local=False)
        self.assertEqual(
            plan.command("/tmp/x.sql"),
            (
                "npx",
                "wrangler",
                "d1",
                "execute",
                "lore-publications",
                "--remote",
                "--file",
                "/tmp/x.sql",
                "-y",
            ),
        )
        local = cli.plan_push(state(), local=True)
        self.assertEqual(
            local.command("/tmp/y.sql")[5:8], ("--local", "--file", "/tmp/y.sql")
        )


if __name__ == "__main__":
    unittest.main()
