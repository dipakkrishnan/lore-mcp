from __future__ import annotations

import io
import json
from pathlib import Path
from unittest.mock import patch

from helpers import LoreTestCase, captured

from lore import cli
from lore.store import Store, valid_public_id


class OwnerTestCase(LoreTestCase):
    def run_cli(self, *argv: str, stdin: str = "") -> dict:
        with (
            patch.object(cli, "_interactive", return_value=True),
            patch("sys.stdin", io.StringIO(stdin)),
            captured() as output,
        ):
            self.assertEqual(cli.main(list(argv)), 0)
        return json.loads(output.getvalue())


class CollectionTest(OwnerTestCase):
    def test_new_drop_and_price_puts_it_on_sale(self) -> None:
        made = self.run_cli("collection", "new")
        self.assertEqual(made["title"], "Untitled collection")
        note = Path(self.tmp.name) / "China's industrial policy.md"
        note.write_text("# Subsidies\n\nWhat the numbers say.", encoding="utf-8")
        drop = {
            "items": [{"content": "Export controls\nwhy they leak"}],
            "files": [str(note)],
        }
        added = self.run_cli(
            "collection", "add", str(made["id"]), "-", stdin=json.dumps(drop)
        )
        self.assertEqual(
            [a["title"] for a in added["added"]],
            ["Export controls", "China's industrial policy"],
        )
        with Store() as store:
            self.assertFalse(store.collection(made["id"]).on_sale)
        priced = self.run_cli("collection", "price", str(made["id"]), "12")
        self.assertEqual(priced["price_usd"], 12)
        with Store() as store:
            collection = store.collection(made["id"])
            self.assertTrue(collection.on_sale)
            piece = store.get_publication(collection.pieces[0].public_id)
            self.assertEqual(piece.teaser, "Export controls")

    def test_sell_puts_each_item_on_sale_on_its_own(self) -> None:
        drop = {"items": [{"title": "", "content": "# Tariffs\nwho pays"}]}
        sold = self.run_cli("sell", "-", stdin=json.dumps(drop))["added"]
        self.assertEqual([s["title"] for s in sold], ["Tariffs"])
        again = self.run_cli("sell", "-", stdin=json.dumps(drop))["added"]
        self.assertEqual(again[0]["publication_id"], sold[0]["publication_id"])
        with Store() as store:
            self.assertEqual(store.unpriced_pieces(), set())
            piece = store.get_publication(sold[0]["public_id"])
        self.assertEqual(piece.teaser, "Tariffs")

    def test_a_sold_piece_takes_a_drafted_description(self) -> None:
        from lore.store import PublicationExtras

        with Store() as store:
            piece = store.sell_piece("Tariffs", "who pays the tariff")
            store.set_extras(
                PublicationExtras(
                    publication_id=piece,
                    teaser="Who really pays",
                    sample="Not who you think.",
                )
            )
            self.assertEqual(store.active_publication(piece).teaser, "Who really pays")
            store.set_extras(
                PublicationExtras(publication_id=piece, sample="Still not.")
            )
            self.assertEqual(store.active_publication(piece).teaser, "Who really pays")
            with self.assertRaisesRegex(ValueError, "description can't"):
                store.with_extras(
                    PublicationExtras(
                        publication_id=piece, teaser="who pays the tariff"
                    )
                )

    def test_the_same_text_dropped_twice_is_one_piece(self) -> None:
        with Store() as store:
            collection = store.new_collection()
            first = store.add_to_collection(collection.id, "A", "same text")
            again = store.add_to_collection(collection.id, "A", "same text")
            self.assertEqual(first.id, again.id)
            self.assertEqual(len(store.collection(collection.id).pieces), 1)

    def test_memories_say_which_collection_they_went_into(self) -> None:
        from lore.snapshot import build

        alone = self.seed_memory("Standalone")
        with Store() as store:
            collection = store.new_collection("Sales playbook")
            store.add_to_collection(collection.id, "A", "dropped text")
        memories = {m["title"]: m for m in build()["library"]["items"]}
        self.assertEqual(
            memories["A"]["collection"],
            {"id": collection.id, "title": "Sales playbook"},
        )
        self.assertIsNone(memories["Standalone"]["collection"])
        self.assertEqual(memories["Standalone"]["id"], alone)

    def test_rename_retopics_its_pieces(self) -> None:
        with Store() as store:
            collection = store.new_collection()
            piece = store.add_to_collection(collection.id, "A", "text")
            store.rename_collection(collection.id, "Sales playbook")
            self.assertEqual(
                store.get_publication(piece.public_id).topic, "Sales playbook"
            )

    def test_removing_a_piece_takes_it_off_sale(self) -> None:
        with Store() as store:
            collection = store.new_collection()
            piece = store.add_to_collection(collection.id, "A", "text")
            store.remove_from_collection(collection.id, piece.id)
            self.assertEqual(store.collection(collection.id).pieces, [])
            with self.assertRaises(ValueError):
                store.get_publication(piece.public_id)

    def test_push_carries_only_collections_on_sale(self) -> None:
        with Store() as store:
            on_sale = store.new_collection("On sale")
            store.add_to_collection(on_sale.id, "A", "text a")
            store.price_collection(on_sale.id, 9)
            unpriced = store.new_collection("Unpriced")
            store.add_to_collection(unpriced.id, "B", "text b")
            waiting = store.unpriced_pieces()
            sql = cli._push_sql(
                [
                    p
                    for p in store.list_publications(active_only=True)
                    if p.id not in waiting
                ],
                store.answer_settings(),
                "",
                collections=store.collections(),
            )
            piece = store.collection(on_sale.id).pieces[0].public_id
        self.assertIn(f"'{on_sale.public_id}','On sale',9.000000", sql)
        self.assertNotIn("'Unpriced'", sql)
        self.assertIn(f"'{piece}',1);", sql)

    def test_changes_need_the_owner(self) -> None:
        with captured(), patch("sys.stdin", io.StringIO("")):
            self.assertNotEqual(cli.main(["collection", "new"]), 0)
        with Store() as store:
            self.assertEqual(store.collections(), [])


class FeedTest(OwnerTestCase):
    def test_one_click_turns_it_on_at_the_suggested_price(self) -> None:
        with Store() as store:
            store.set_setting("price_usd", 1.0)
        self.assertEqual(self.run_cli("feed", "on"), {"price_usd": 10.0})
        with Store() as store:
            feed_id = str(store.setting("feed_id"))
        self.assertTrue(valid_public_id(feed_id))
        sql = cli._push_sql(
            [], Store().answer_settings(), "", feed_price_usd=10, feed_id=feed_id
        )
        self.assertIn(f"('feed_id','{feed_id}')", sql)
        sql = cli._push_sql([], Store().answer_settings(), "", feed_price_usd=10)
        self.assertIn("('feed_price_usd','10.000000')", sql)
        self.assertEqual(self.run_cli("feed", "off"), {"price_usd": 0.0})
        self.assertNotIn(
            "feed_price_usd", cli._push_sql([], Store().answer_settings(), "")
        )

    def test_a_chosen_price_wins(self) -> None:
        self.assertEqual(self.run_cli("feed", "on", "--price", "8"), {"price_usd": 8.0})
