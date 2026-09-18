"""Tests for the ChatGPT and Claude.ai export reader in `lore.sources`.

An export is a transcript, not a file of agent-written memories: what the owner
themselves typed is the lesson, the assistant's answer is context for it, and a
regenerated branch is an answer that was never given.
"""

from __future__ import annotations

import json
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

    def test_since_keeps_only_the_conversations_after_that_day(self) -> None:
        entry = self.add(self.unpacked("chatgpt"), since="2026-01-01")
        self.assertEqual(entry["imported"], 1)
        with Store() as store:
            self.assertEqual(store.search("ask for a raise"), [])

    def test_the_same_export_read_twice_adds_nothing(self) -> None:
        first = self.add(self.unpacked("chatgpt"))
        self.assertEqual(self.add(self.unpacked("chatgpt")), first)
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
                with self.assertRaises(sources_module.SourceError):
                    self.add(locator)
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


if __name__ == "__main__":
    unittest.main()
