"""Tests for the ChatGPT and Claude.ai export reader in `lore.sources`.

An export is a transcript, not a file of agent-written memories: what the owner
themselves typed is the lesson, the assistant's answer is context for it, and a
regenerated branch is an answer that was never given.
"""

from __future__ import annotations

import json
import shutil
import unittest
import zipfile
from pathlib import Path

from helpers import LoreTestCase, captured

from lore import cli
from lore import sources as sources_module
from lore.store import Store

EXPORTS = Path(__file__).parent / "fixtures/exports"


class ExportTest(LoreTestCase):
    def unpacked(self, product: str) -> str:
        return str(EXPORTS / product / "conversations.json")

    def zipped(self, product: str) -> str:
        path = Path(self.tmp.name) / f"{product}.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.write(self.unpacked(product), f"{product}/conversations.json")
        return str(path)

    def written(self, name: str, payload: object) -> str:
        path = Path(self.tmp.name) / name
        path.write_text(json.dumps(payload))
        return str(path)

    def preview(self, locator: str) -> dict[str, object]:
        return sources_module.preview(locator, "export")

    def add(self, locator: str, **kwargs: str) -> dict[str, object]:
        with Store() as store:
            return sources_module.Registry(store).add(locator, kind="export", **kwargs)

    def test_a_chatgpt_export_imports_only_the_path_the_owner_settled_on(self) -> None:
        found = self.preview(self.unpacked("chatgpt"))
        self.assertEqual(
            found,
            {
                "count": 2,
                "from": "2025-11-03",
                "to": "2026-02-10",
                "skipped": 1,
                "state": "connected",
                "label": "ChatGPT",
            },
        )
        self.assertEqual(self.add(self.unpacked("chatgpt"))["imported"], 2)
        with Store() as store:
            memory = store.search("ask for a raise")[0]
            self.assertEqual(memory.title, "Negotiating a raise")
            self.assertIn("Reply: Open with the outcome you want", memory.content)
            # The regenerated sibling hangs off the same tree as the answer the
            # owner kept reading; only the kept path is theirs.
            self.assertEqual(store.search("threw away"), [])
            # A turn under the sentence floor is chat, not a memory.
            self.assertNotIn("thanks!", memory.content)

    def test_the_assistant_reply_is_kept_only_as_trimmed_context(self) -> None:
        self.add(self.unpacked("chatgpt"))
        with Store() as store:
            content = store.search("contractors quoted")[0].content
        question, reply = content.split("\n\nReply: ")
        self.assertTrue(question.startswith("Two contractors quoted"))
        self.assertEqual(len(reply), 600)

    def test_a_claude_export_reads_the_flat_list(self) -> None:
        found = self.preview(self.unpacked("claude"))
        self.assertEqual(found["label"], "Claude")
        self.assertEqual((found["count"], found["skipped"]), (1, 1))
        self.assertEqual((found["from"], found["to"]), ("2026-01-14", "2026-01-14"))
        entry = self.add(self.unpacked("claude"))
        self.assertEqual((entry["label"], entry["kind"]), ("Claude", "export"))
        self.assertEqual(entry["imported"], 1)
        with Store() as store:
            memory = store.search("pull the roast out")[0]
            self.assertEqual(memory.title, "Sunday roast timings")
            self.assertIn("Reply: Pull it at 52C", memory.content)

    def test_either_export_reads_the_same_from_the_zip_it_arrives_as(self) -> None:
        for product in ("chatgpt", "claude"):
            with self.subTest(product=product):
                self.assertEqual(
                    self.preview(self.zipped(product)),
                    self.preview(self.unpacked(product)),
                )
        self.assertEqual(self.add(self.zipped("claude"))["imported"], 1)

    def test_conversation_identity_survives_filename_and_archive_changes(self) -> None:
        for product in ("chatgpt", "claude"):
            with self.subTest(product=product):
                copy = Path(self.tmp.name) / f"renamed-{product}.json"
                shutil.copyfile(self.unpacked(product), copy)
                readers = [
                    sources_module.Source.owner(locator, kind="export").reader()
                    for locator in (
                        self.unpacked(product),
                        str(copy),
                        self.zipped(product),
                    )
                ]
                self.assertEqual([reader.provider for reader in readers], [product] * 3)
                self.assertEqual(
                    [[item.key for item in reader.items()] for reader in readers],
                    [[item.key for item in readers[0].items()]] * 3,
                )
                self.assertNotEqual(
                    next(readers[0].items()).source_path,
                    next(readers[1].items()).source_path,
                )

    def test_a_renamed_download_of_the_same_history_adds_nothing(self) -> None:
        first = self.add(self.unpacked("chatgpt"))
        copy = Path(self.tmp.name) / "renamed.json"
        shutil.copyfile(self.unpacked("chatgpt"), copy)
        again = self.add(str(copy))
        self.assertEqual(again["name"], first["name"])
        self.assertEqual(again["locator"], str(copy.resolve()))
        with Store() as store:
            self.assertEqual(store.counts()["private"], 2)
            self.assertEqual(len(sources_module.Registry(store).owned), 1)

    def test_an_app_takes_only_its_own_export_and_is_named_for_the_app(self) -> None:
        with Store() as store:
            registry = sources_module.Registry(store)
            with self.assertRaisesRegex(
                sources_module.SourceError, "Claude export, not ChatGPT"
            ):
                registry.connect("chatgpt", self.unpacked("claude"))
            entry = registry.connect("chatgpt", self.unpacked("chatgpt"))
            self.assertEqual(
                (entry["name"], entry["label"], entry["refresh"]),
                ("chatgpt-export", "ChatGPT", False),
            )
            self.assertEqual(
                registry.connect("claude", self.zipped("claude"))["name"],
                "claude-export",
            )
            self.assertEqual(store.counts()["private"], 3)

    def test_since_keeps_only_the_conversations_after_that_day(self) -> None:
        entry = self.add(self.unpacked("chatgpt"), since="2026-01-01")
        self.assertEqual(entry["imported"], 1)
        with Store() as store:
            self.assertEqual(store.search("ask for a raise"), [])

    def test_the_same_export_read_twice_adds_nothing(self) -> None:
        first = self.add(self.unpacked("chatgpt"))
        again = self.add(self.unpacked("chatgpt"))
        self.assertEqual((first.pop("added"), again.pop("added")), (2, 0))
        self.assertEqual(again, first)
        with Store() as store:
            self.assertEqual(store.counts()["private"], 2)
            read = sources_module.Registry(store).read([str(first["name"])])
        self.assertEqual(read[0]["added"], 0)
        self.assertEqual(read[0]["unchanged"], 2)

    def test_what_is_not_an_export_is_unreachable_rather_than_empty(self) -> None:
        empty = Path(self.tmp.name) / "empty.zip"
        with zipfile.ZipFile(empty, "w") as archive:
            archive.writestr("readme.txt", "no conversations here")
        for locator in (
            str(Path(self.tmp.name) / "gone.zip"),
            self.written("prose.json", "not a list of conversations"),
            str(empty),
        ):
            with self.subTest(locator=locator):
                self.assertEqual(self.preview(locator)["state"], "unreachable")
                with self.assertRaisesRegex(
                    sources_module.SourceError,
                    "^That file isn't a ChatGPT or Claude export.$",
                ):
                    self.add(locator)
        with (
            Store() as store,
            self.assertRaisesRegex(
                sources_module.SourceError, "^That file isn't a ChatGPT export.$"
            ),
        ):
            sources_module.Registry(store).connect("chatgpt", str(empty))
        nothing = self.written("nothing.json", [])
        self.assertEqual(self.preview(nothing)["state"], "nothing_found")
        self.assertEqual(self.preview(nothing)["label"], "Export")

    def test_a_conversation_missing_everything_but_its_words(self) -> None:
        said = "A conversation with no title, no id, and no usable timestamp."
        locator = self.written(
            "sparse.json",
            [
                None,
                {"chat_messages": [{"sender": "human", "text": said}]},
                {"created_at": "not a date", "chat_messages": [{"text": said}]},
                {"name": "Empty", "chat_messages": []},
            ],
        )
        self.assertEqual(
            self.preview(locator),
            {
                "count": 1,
                "from": None,
                "to": None,
                "skipped": 2,
                "state": "connected",
                "label": "Claude",
            },
        )
        entry = self.add(locator)
        with Store() as store:
            memory = store.search("no usable timestamp")[0]
        self.assertEqual(memory.title, said[:60])
        self.assertEqual(memory.source_path, f"{entry['locator']}#0")

    def test_cycles_and_malformed_nested_records_are_bounded(self) -> None:
        said = "The selected branch should import this owner message exactly once."
        cyclic = self.written(
            "cycle.json",
            [
                {
                    "mapping": {
                        "node": {
                            "parent": "node",
                            "message": {
                                "author": {"role": "user"},
                                "content": {"parts": [said]},
                            },
                        }
                    },
                    "current_node": "node",
                }
            ],
        )
        self.assertEqual(self.preview(cyclic)["count"], 1)
        malformed = self.written(
            "malformed.json", [{"mapping": {"node": 42}, "current_node": "node"}]
        )
        self.assertEqual(self.preview(malformed)["state"], "unreachable")
        archive_path = Path(self.tmp.name) / "misnamed.zip"
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("not-conversations.json", "[]")
        self.assertEqual(self.preview(str(archive_path))["state"], "unreachable")

    def test_the_cli_previews_adds_and_removes_an_export(self) -> None:
        def command(*argv: str) -> object:
            with captured() as output:
                self.assertEqual(cli.main([*argv, "--json"]), 0)
            return json.loads(output.getvalue())

        locator = self.zipped("chatgpt")
        found = command("sources", "preview", "--export", locator)
        self.assertEqual(found["label"], "ChatGPT")
        added = command("sources", "add", "--export", locator)
        self.assertEqual((added["kind"], added["imported"]), ("export", 2))
        removed = command("sources", "remove", str(added["name"]), "--delete")
        self.assertEqual(removed["memories"], {"deleted": 2, "kept": 0})


class TakeoutTest(LoreTestCase):
    """Google Maps from a Takeout archive: a recorded folder layout with Google's own
    file names and fields, the places renamed, and two unrelated products beside it."""

    folder = EXPORTS / "takeout"

    def zipped(self, name: str = "takeout.zip", **changed: str) -> str:
        path = Path(self.tmp.name) / name
        with zipfile.ZipFile(path, "w") as archive:
            for found in sorted(self.folder.rglob("*")):
                if found.is_file():
                    member = found.relative_to(self.folder).as_posix()
                    archive.writestr(member, changed.get(member, found.read_text()))
        return str(path)

    def connect(self, locator: str) -> dict[str, object]:
        with Store() as store:
            return sources_module.Registry(store).connect("google-maps", locator)

    def memories(self) -> dict[str, str]:
        with Store() as store:
            return {memory.title: memory.content for memory in store.search("")}

    def test_a_zip_and_its_unzipped_folder_read_the_same_and_skip_other_products(
        self,
    ) -> None:
        readers = [
            sources_module.Source.owner(
                locator, kind="export", connector="google-maps"
            ).reader()
            for locator in (str(self.folder), self.zipped())
        ]
        found = [{item.key: item.content for item in r.items()} for r in readers]
        self.assertEqual(found[0], found[1])
        self.assertEqual(
            sorted(found[0]),
            [
                "list:Best coffee in SF",
                "list:Want to go",
                *sorted(
                    f"review:https://www.google.com/maps/place//data=!4m2!3m1!1s{cid}"
                    for cid in (
                        "0x808f7e1f1f1f1f1f:0x6f708192a3b4c5d6",
                        "0x808f7e2f2f2f2f2f:0x708192a3b4c5d6e7",
                        "0x808f7e3f3f3f3f3f:0x8192a3b4c5d6e7f8",
                    )
                ),
                "starred",
            ],
        )
        self.assertFalse(
            any("Groceries" in text or "USD" in text for text in found[0].values())
        )

    def test_each_list_keeps_its_notes_and_each_review_its_rating_and_words(
        self,
    ) -> None:
        entry = self.connect(str(self.folder))
        self.assertEqual(
            (entry["name"], entry["label"], entry["refresh"], entry["imported"]),
            ("google-maps-export", "Google Maps", False, 5),
        )
        kept = self.memories()
        self.assertEqual(
            kept["Best coffee in SF"],
            "- Sightglass Coffee — Order the affogato; skip the drip\n"
            "- Ritual Coffee Roasters — Best seat is the bench by the window, before 9\n"
            "- Wrecking Ball Coffee — Closed Mondays",
        )
        self.assertIn("- Lands End Trail", kept["Want to go"])
        self.assertIn(
            "- Tartine Bakery, 600 Guerrero St, San Francisco", kept["Starred places"]
        )
        self.assertEqual(
            kept["Mission Chinese Food"],
            "Reviewed Mission Chinese Food, 3463 18th St, San Francisco, CA 94110, "
            "United States on 2026-03-08. Rated it 5 out of 5.\n\n"
            "Book the counter, not a table: you see the wok station and the food "
            "arrives faster.",
        )
        self.assertTrue(kept["Caffe Trieste"].endswith("Rated it 3 out of 5."))
        # A place reviewed with neither stars nor words left nothing to keep.
        self.assertNotIn("Westfield San Francisco Centre", kept)

    def test_the_older_spelling_of_a_review_reads_the_same(self) -> None:
        older = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "Google Maps URL": "http://maps.google.com/?cid=42",
                        "Location": {
                            "Address": "1 Ferry Building, San Francisco",
                            "Business Name": "Ferry Building",
                        },
                        "Published": "2019-05-04T10:00:00Z",
                        "Star Rating": 4,
                        "Review Comment": "Go on a Saturday morning for the market.",
                    },
                }
            ],
        }
        member = "Takeout/Maps (your places)/Reviews.json"
        reader = sources_module.Source.owner(
            self.zipped(**{member: json.dumps(older)}),
            kind="export",
            connector="google-maps",
        ).reader()
        review = next(i for i in reader.items() if i.key.startswith("review:"))
        self.assertEqual(
            (review.title, review.dated, review.source_path),
            ("Ferry Building", "2019-05-04", "http://maps.google.com/?cid=42"),
        )
        self.assertIn("Rated it 4 out of 5.\n\nGo on a Saturday", review.content)

    def test_a_newer_export_replaces_the_older_one(self) -> None:
        first = self.connect(str(self.folder))
        member = "Takeout/Saved/Want to go.csv"
        grown = (self.folder / member).read_text() + (
            "Golden Gate Park,Rent bikes at the east end,"
            "https://www.google.com/maps/place/Golden+Gate+Park,,\n"
        )
        again = self.connect(self.zipped("takeout-newer.zip", **{member: grown}))
        self.assertEqual(again["name"], first["name"])
        self.assertEqual((again["added"], again["imported"]), (0, 5))
        self.assertIn(
            "- Golden Gate Park — Rent bikes at the east end",
            self.memories()["Want to go"],
        )
        with Store() as store:
            self.assertEqual(len(sources_module.Registry(store).owned), 1)

    def test_an_archive_without_google_maps_is_refused_in_plain_words(self) -> None:
        other = Path(self.tmp.name) / "takeout-keep.zip"
        with zipfile.ZipFile(other, "w") as archive:
            archive.writestr("Takeout/Keep/Groceries.json", "{}")
        for locator in (str(other), str(Path(self.tmp.name) / "gone.zip")):
            with self.subTest(locator=locator):
                with self.assertRaisesRegex(
                    sources_module.SourceError,
                    "^That file isn't a Google Takeout export with Google Maps in it.$",
                ):
                    self.connect(locator)


if __name__ == "__main__":
    unittest.main()
