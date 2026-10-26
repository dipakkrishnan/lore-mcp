from __future__ import annotations

import io
import json
from pathlib import Path
from unittest.mock import patch

from helpers import LoreTestCase, captured

from lore import cli
from lore.collection import Collections, Drop
from lore.store import Store


class CollectionTest(LoreTestCase):
    def run_cli(self, *argv: str, stdin: str = "") -> dict:
        with (
            patch.object(cli, "_interactive", return_value=True),
            patch("sys.stdin", io.StringIO(stdin)),
            captured() as output,
        ):
            self.assertEqual(cli.main(list(argv)), 0)
        return json.loads(output.getvalue())

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

    def test_pricing_a_collection_pushes_to_the_live_store(self) -> None:
        with Store() as store:
            store.set_setting("node_url", "https://node.example/mcp")
            collection = store.new_collection()
            store.add_to_collection(collection.id, "A", "Export controls leak")
        with patch.object(cli, "push", return_value=0) as push:
            self.run_cli("collection", "price", str(collection.id), "12")
        push.assert_called_once_with(str(cli.store_folder()))

    def test_kept_memories_become_pieces_as_they_read(self) -> None:
        kept = {
            title: self.seed_memory(title) for title in ("Ship weekly", "Hire slowly")
        }
        made = self.run_cli("collection", "new")
        drop = {"memories": [kept["Ship weekly"], kept["Hire slowly"]]}
        added = self.run_cli(
            "collection", "add", str(made["id"]), "-", stdin=json.dumps(drop)
        )
        self.assertEqual(
            [a["title"] for a in added["added"]], ["Ship weekly", "Hire slowly"]
        )
        again = self.run_cli(
            "collection", "add", str(made["id"]), "-", stdin=json.dumps(drop)
        )
        self.assertEqual(len(again["added"]), 2)
        with Store() as store:
            collection = store.collection(made["id"])
            self.assertEqual(len(collection.pieces), 2)
            piece = store.get_publication(collection.pieces[0].public_id)
            self.assertEqual(
                (piece.content, piece.provenance),
                ("Ship weekly about deployment", [kept["Ship weekly"]]),
            )
            self.assertEqual(len(store.search("")), 2)

    def test_a_discarded_memory_cannot_go_on_sale(self) -> None:
        discarded = self.seed_memory("Old", status="discarded")
        with Store() as store:
            collection = store.new_collection()
            with self.assertRaisesRegex(ValueError, "isn't one Lore keeps"):
                store.add_memory_to_collection(collection.id, discarded)

    def test_a_bad_memory_leaves_the_collection_as_it_was(self) -> None:
        kept = self.seed_memory("Ship weekly")
        gone = self.seed_memory("Old", status="discarded")
        with Store() as store:
            collection = store.new_collection()
        with self.assertRaisesRegex(ValueError, "isn't one Lore keeps"):
            Collections(lambda: None).add(collection.id, Drop(memories=[kept, gone]))
        with Store() as store:
            self.assertEqual(store.collection(collection.id).pieces, [])

    def test_two_memories_that_read_alike_are_two_pieces(self) -> None:
        with Store() as store:
            for title in ("First", "Second"):
                store.put(
                    source="test",
                    origin="native",
                    source_path=title,
                    source_key=title,
                    fingerprint=title,
                    title=title,
                    content="the same words",
                )
            first, second = (store.search(t)[0].id for t in ("First", "Second"))
            collection = store.new_collection()
            store.add_memory_to_collection(collection.id, first)
            piece = store.add_memory_to_collection(collection.id, second)
            self.assertEqual(piece.title, "Second")
            self.assertEqual(len(store.collection(collection.id).pieces), 2)

    def test_the_same_text_dropped_twice_is_one_piece(self) -> None:
        with Store() as store:
            collection = store.new_collection()
            first = store.add_to_collection(collection.id, "A", "same text")
            again = store.add_to_collection(collection.id, "A", "same text")
            self.assertEqual(first.id, again.id)
            self.assertEqual(len(store.collection(collection.id).pieces), 1)

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

    def assertNothingOnSale(self, store: Store, piece_public_id: str) -> None:
        self.assertEqual(store.list_publications(active_only=True), [])
        self.assertEqual(store.unpriced_pieces(), set())
        with self.assertRaises(ValueError):
            store.get_publication(piece_public_id)

    def test_deleting_an_unpriced_collection_does_not_publish_its_pieces(
        self,
    ) -> None:
        with Store() as store:
            collection = store.new_collection()
            piece = store.add_to_collection(collection.id, "A", "private notes")
            store.delete_collection(collection.id)
            self.assertEqual(store.collections(), [])
            self.assertNothingOnSale(store, piece.public_id)

    def test_deleting_a_collection_priced_back_to_zero_does_not_publish_it(
        self,
    ) -> None:
        with Store() as store:
            collection = store.new_collection()
            piece = store.add_to_collection(collection.id, "A", "private notes")
            store.price_collection(collection.id, 5)
            store.price_collection(collection.id, 0)
            store.delete_collection(collection.id)
            self.assertNothingOnSale(store, piece.public_id)

    def test_deleting_a_priced_collection_leaves_its_pieces_on_sale(self) -> None:
        with Store() as store:
            collection = store.new_collection()
            piece = store.add_to_collection(collection.id, "A", "for sale")
            store.price_collection(collection.id, 5)
            store.delete_collection(collection.id)
            self.assertEqual(store.get_publication(piece.public_id).content, "for sale")

    def test_deleting_a_missing_collection_raises(self) -> None:
        with Store() as store:
            with self.assertRaises(ValueError):
                store.delete_collection(999)

    def test_a_price_that_rounds_to_zero_is_refused(self) -> None:
        with Store() as store:
            collection = store.new_collection()
            store.price_collection(collection.id, 4)
            with self.assertRaises(ValueError):
                store.price_collection(collection.id, 1e-9)
            self.assertEqual(store.collection(collection.id).price_usd, 4)

    def test_changes_need_the_owner(self) -> None:
        with captured(), patch("sys.stdin", io.StringIO("")):
            self.assertNotEqual(cli.main(["collection", "new"]), 0)
        with Store() as store:
            self.assertEqual(store.collections(), [])
