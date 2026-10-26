"""What a drop on a collection becomes, and when a change reaches buyers.

`test_collection.py` drives collections through the CLI and the store. These
tests hold `Collections` itself: which files a drop reads and refuses, and which
changes push the store. Every drop goes through `add`, never the private
helpers, so the tests describe what the owner sees.
"""

from __future__ import annotations

import io
import subprocess
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import Mock, patch

from helpers import LoreTestCase, captured

from lore import collection as collection_module
from lore.collection import Collections, Drop, Paste
from lore.store import Store


class CollectionDropTest(LoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.push = Mock()
        self.collections = Collections(self.push)
        self.drops = Path(self.tmp.name) / "drops"
        self.drops.mkdir()

    def connect_node(self) -> None:
        with Store() as store:
            store.set_setting("node_url", "https://node.example/mcp")

    def paste(self, collection_id: int, *contents: str) -> list[dict[str, object]]:
        drop = Drop(items=[Paste(content=content) for content in contents])
        return self.collections.add(collection_id, drop)

    def drop_files(self, collection_id: int, *paths: Path) -> list[dict[str, object]]:
        return self.collections.add(collection_id, Drop(files=[str(p) for p in paths]))

    def on_sale(self, title: str = "Playbook") -> int:
        """A collection with one piece and a price: what buyers can see."""
        collection = self.collections.new(title)
        self.paste(collection.id, "first piece")
        self.collections.price(collection.id, 5)
        return collection.id

    def pieces(self, collection_id: int) -> list[tuple[str, str]]:
        with Store() as store:
            return [
                (piece.title, store.get_publication(piece.public_id).content)
                for piece in store.collection(collection_id).pieces
            ]

    # -- when a change pushes ---------------------------------------------

    def test_adding_to_an_unpriced_collection_does_not_push(self) -> None:
        self.connect_node()
        collection = self.collections.new("Drafts")
        added = self.paste(collection.id, "a private note")
        self.assertEqual([a["title"] for a in added], ["a private note"])
        self.push.assert_not_called()

    def test_adding_to_a_collection_on_sale_pushes_once(self) -> None:
        self.connect_node()
        collection_id = self.on_sale()
        self.push.reset_mock()
        self.paste(collection_id, "second piece", "third piece")
        self.push.assert_called_once_with()

    def test_nothing_is_pushed_without_a_deployed_node(self) -> None:
        collection_id = self.on_sale()
        self.paste(collection_id, "second piece")
        self.collections.rename(collection_id, "Renamed")
        self.push.assert_not_called()

    def test_the_push_writes_to_stderr_so_stdout_stays_json(self) -> None:
        self.connect_node()
        self.push.side_effect = lambda: print("pushing 2 pieces")
        collection_id = self.on_sale()
        with captured() as out, redirect_stderr(io.StringIO()) as err:
            self.paste(collection_id, "second piece")
        self.assertEqual(out.getvalue(), "")
        self.assertIn("pushing 2 pieces", err.getvalue())

    def test_renaming_pushes_only_a_collection_on_sale(self) -> None:
        self.connect_node()
        drafts = self.collections.new("Drafts")
        self.paste(drafts.id, "unpriced piece")
        self.assertEqual(self.collections.rename(drafts.id, "Notes").title, "Notes")
        self.push.assert_not_called()

        collection_id = self.on_sale()
        self.push.reset_mock()
        renamed = self.collections.rename(collection_id, "Sales playbook")
        self.assertEqual(renamed.title, "Sales playbook")
        self.push.assert_called_once_with()

    def test_pricing_pushes_when_it_puts_on_or_takes_off_sale(self) -> None:
        self.connect_node()
        collection = self.collections.new("Playbook")
        self.paste(collection.id, "a piece")

        self.collections.price(collection.id, 0)
        self.push.assert_not_called()

        self.assertTrue(self.collections.price(collection.id, 7).on_sale)
        self.push.assert_called_once_with()

        self.push.reset_mock()
        self.assertFalse(self.collections.price(collection.id, 0).on_sale)
        self.push.assert_called_once_with()

    def test_pricing_an_empty_collection_does_not_push(self) -> None:
        self.connect_node()
        collection = self.collections.new("Empty")
        self.assertFalse(self.collections.price(collection.id, 9).on_sale)
        self.push.assert_not_called()

    def test_removing_a_piece_on_sale_pushes_and_returns_what_is_left(self) -> None:
        self.connect_node()
        collection_id = self.on_sale()
        second = self.paste(collection_id, "second piece")[0]
        self.push.reset_mock()
        left = self.collections.remove(collection_id, int(second["publication_id"]))
        self.assertEqual([p.title for p in left.pieces], ["first piece"])
        self.push.assert_called_once_with()

    def test_removing_a_piece_not_in_the_collection_raises_without_pushing(
        self,
    ) -> None:
        self.connect_node()
        collection_id = self.on_sale()
        self.push.reset_mock()
        with self.assertRaisesRegex(ValueError, "isn't in this collection"):
            self.collections.remove(collection_id, 999)
        self.push.assert_not_called()

    def test_deleting_pushes_only_a_collection_that_was_on_sale(self) -> None:
        self.connect_node()
        drafts = self.collections.new("Drafts")
        self.paste(drafts.id, "unpriced piece")
        self.collections.delete(drafts.id)
        self.push.assert_not_called()

        collection_id = self.on_sale()
        self.push.reset_mock()
        self.collections.delete(collection_id)
        self.push.assert_called_once_with()
        with Store() as store:
            self.assertEqual(store.collections(), [])

    # -- what a drop reads ------------------------------------------------

    def test_a_drop_with_only_blank_text_is_refused_and_stores_nothing(self) -> None:
        collection = self.collections.new("Drafts")
        with self.assertRaisesRegex(ValueError, "there was no text to add"):
            self.paste(collection.id, "   \n\t")
        self.assertEqual(self.pieces(collection.id), [])

    def test_blank_items_are_skipped_beside_real_ones(self) -> None:
        collection = self.collections.new("Drafts")
        added = self.paste(collection.id, "  \n", "real text")
        self.assertEqual([a["title"] for a in added], ["real text"])

    def test_an_untitled_paste_is_named_by_its_first_real_line(self) -> None:
        collection = self.collections.new("Drafts")
        added = self.paste(
            collection.id,
            "\n\n## Tariffs  \nwho pays",
            "x" * 100,
            "###\nbody under an empty heading",
        )
        self.assertEqual(
            [a["title"] for a in added], ["Tariffs", "x" * 80, "Untitled piece"]
        )

    def test_a_dropped_folder_yields_its_text_files_and_skips_hidden_ones(
        self,
    ) -> None:
        if any(part.startswith(".") for part in self.drops.resolve().parts):
            self.skipTest("temporary directory sits under a dot-folder (MON-048)")
        folder = self.drops / "notes"
        (folder / "sub").mkdir(parents=True)
        (folder / ".git").mkdir()
        (folder / "b.md").write_text("bee", encoding="utf-8")
        (folder / "sub" / "a.TXT").write_text("ay", encoding="utf-8")
        (folder / "photo.png").write_bytes(b"\x89PNG")
        (folder / ".hidden.md").write_text("hidden note", encoding="utf-8")
        (folder / ".git" / "HEAD.md").write_text("git internals", encoding="utf-8")
        collection = self.collections.new("Notes")

        added = self.drop_files(collection.id, folder.resolve())

        self.assertEqual([a["title"] for a in added], ["b", "a"])
        self.assertEqual(self.pieces(collection.id), [("b", "bee"), ("a", "ay")])

    def test_a_file_that_is_gone_is_named_in_the_refusal(self) -> None:
        collection = self.collections.new("Notes")
        with self.assertRaisesRegex(ValueError, "moved.md isn't there anymore"):
            self.drop_files(collection.id, self.drops / "moved.md")
        self.assertEqual(self.pieces(collection.id), [])

    def test_too_many_files_are_refused_before_anything_is_read(self) -> None:
        files = []
        for n in range(3):
            path = self.drops / f"{n}.md"
            path.write_text(f"note {n}", encoding="utf-8")
            files.append(path)
        collection = self.collections.new("Notes")
        with patch.object(collection_module, "MAX_FILES", 2):
            with self.assertRaisesRegex(ValueError, "over 2 files"):
                self.drop_files(collection.id, *files)
            self.assertEqual(len(self.drop_files(collection.id, *files[:2])), 2)

    def test_a_file_that_is_not_utf8_asks_for_a_paste(self) -> None:
        path = self.drops / "export.txt"
        path.write_bytes(b"\xff\xfe\x00bad")
        collection = self.collections.new("Notes")
        with self.assertRaisesRegex(ValueError, "export.txt yet; paste its text"):
            self.drop_files(collection.id, path)

    def test_a_document_is_converted_to_text_by_textutil(self) -> None:
        path = self.drops / "Pricing memo.docx"
        path.write_bytes(b"PK\x03\x04 not really a docx")
        converted = subprocess.CompletedProcess([], 0, stdout="The memo, as text.")
        collection = self.collections.new("Memos")
        with patch.object(
            collection_module.subprocess, "run", return_value=converted
        ) as run:
            added = self.drop_files(collection.id, path)
        self.assertEqual(
            run.call_args.args[0],
            ["textutil", "-convert", "txt", "-stdout", str(path.resolve())],
        )
        self.assertEqual([a["title"] for a in added], ["Pricing memo"])
        self.assertEqual(
            self.pieces(collection.id), [("Pricing memo", "The memo, as text.")]
        )

    def test_a_document_textutil_cannot_read_is_named_in_the_refusal(self) -> None:
        path = self.drops / "broken.rtf"
        path.write_text("{\\rtf1 broken", encoding="utf-8")
        failed = subprocess.CompletedProcess([], 1, stdout="", stderr="bad file")
        collection = self.collections.new("Memos")
        with patch.object(collection_module.subprocess, "run", return_value=failed):
            with self.assertRaises(ValueError) as refused:
                self.drop_files(collection.id, path)
        self.assertIn("couldn't read broken.rtf", str(refused.exception))
        self.assertEqual(self.pieces(collection.id), [])
