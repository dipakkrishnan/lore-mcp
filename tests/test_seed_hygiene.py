"""The seed tree and its recorded fixtures must never hold a secret or a real identity.

These tests run the same scrub rules and hygiene check the pre-commit checklist uses,
over the committed seed files, and prove the rules catch what they are meant to. Every
sample secret is assembled at run time so this file does not itself contain one.
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

from defusedxml.ElementTree import fromstring

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "support" / "seed"
sys.path.insert(0, str(SEED))

import build_blog  # noqa: E402
import hygiene_check  # noqa: E402
import scrub  # noqa: E402

from lore.sources import _Html  # noqa: E402

RULES = scrub.load_rules()
JWT = (
    "ey" + "J" + "hbGciOiJIUzI1NiJ9" + "." + "abcdefghijklmn" + "." + "opqrstuvwxyz0123"
)
NOTION = "n" + "tn_" + "A1b2C3d4E5f6G7h8I9j0K1l2"
OWNER = "s" + "dasbach"
OWNER_PATH = "/Users/" + "s" + "hane" + "dasbach" + "/code"
LIVE = ROOT / "tests" / "fixtures" / "live"
PUBLIC = {"bluesky", "substack", "medium", "blog", "notion", "granola"}
# Public items with no text of their own to carry the marker (each one's manifest `why`).
NO_MARKER = {
    "bs-08": "a repost; it has no text of its own",
    "nt-06": "an empty page; no blocks",
    "nt-00": "the hand-made workspace home page",
}
JSON_CORPUS = {
    "bluesky": ("bluesky.json", ("records",)),
    "substack": ("substack.json", ("posts",)),
    "medium": ("medium.json", ("stories",)),
    "notion": ("notion.json", ("pages", "top_level")),
}


def cleaned(text: str) -> str:
    return scrub.scrub(text, RULES)[0]


class ScrubRulesTest(unittest.TestCase):
    def test_a_session_token_and_a_bearer_header_are_replaced(self) -> None:
        text = f'{{"a": "{JWT}"}} Authorization: Bearer abcdefghijklmnopqrstuv'
        out = cleaned(text)
        self.assertNotIn(JWT, out)
        self.assertNotIn("abcdefghijklmnopqrstuv", out)

    def test_an_integration_key_is_replaced(self) -> None:
        self.assertNotIn(NOTION, cleaned(f"key {NOTION}"))

    def test_a_cookie_header_is_replaced_whole(self) -> None:
        text = "Set-" + "Cookie: sid=abc123; Path=/"
        self.assertEqual(cleaned(text), "Set-" + "Cookie: REDACTED")

    def test_real_identities_and_paths_are_replaced(self) -> None:
        out = cleaned(f"{OWNER_PATH} and {OWNER}4@gmail.com and {OWNER}")
        self.assertNotIn(OWNER, out)
        self.assertIn("/Users/owner", out)

    def test_another_users_home_is_replaced(self) -> None:
        self.assertEqual(cleaned("/Users/someone/x"), "/Users/owner/x")

    def test_the_persona_addresses_and_numbers_are_kept(self) -> None:
        for kept in (
            "priya@tidewell.example",
            "+1 (555) 013-4477",
            "tw_live_sk_4f3c9a1e7b2d4e5f6a7b8c9d0e1f2a3b",
        ):
            self.assertEqual(cleaned(kept), kept)

    def test_an_epoch_timestamp_is_not_a_phone_number(self) -> None:
        self.assertEqual(
            cleaned('"create_time": 1776686400.0'), '"create_time": 1776686400.0'
        )

    def test_ordinary_hyphenated_words_are_not_an_app_password(self) -> None:
        self.assertEqual(cleaned("mark-that-says-what"), "mark-that-says-what")

    def test_an_app_password_with_a_digit_is_replaced(self) -> None:
        self.assertEqual(cleaned("ab3d-efgh-ijkl-mnop"), "xxxx-xxxx-xxxx-xxxx")

    def test_a_real_looking_account_id_field_is_replaced(self) -> None:
        out = cleaned('{"workspace_id": "w-123", "email": "someone@corp.io"}')
        self.assertNotIn("w-123", out)
        self.assertNotIn("corp.io", out)

    def test_notion_mcp_account_identifiers_are_replaced(self) -> None:
        fake = "-".join(["00000000", "1111", "2222", "3333", "444444444444"])
        url = (
            "https://app.notion.com/notion-mcp?tool=x"
            f"&mcpRequestId={fake}&mcpUpsellOpportunityId={fake}"
            f"&spaceId={fake}&notionAccountId={fake}&action=learn_more"
        )
        out = cleaned(url)
        self.assertNotIn(fake, out)
        self.assertIn("&spaceId=REDACTED&notionAccountId=REDACTED&action=", out)
        keyed = cleaned(f'{{"spaceId": "{fake}", "notionAccountId": "{fake}"}}')
        self.assertNotIn(fake, keyed)
        self.assertEqual(
            keyed, '{"spaceId": "REDACTED", "notionAccountId": "REDACTED"}'
        )

    def test_a_notion_user_mention_url_is_replaced(self) -> None:
        fake = "-".join(["00000000", "1111", "2222", "3333", "444444444444"])
        out = cleaned(f'<mention-user url="user://{fake}"></mention-user>')
        self.assertNotIn(fake, out)
        self.assertIn('url="user://REDACTED"', out)

    def test_a_brace_null_or_number_after_a_scrubbed_key_is_untouched(self) -> None:
        """F-tool-01 regression (XC-053): a scrubbed key only ever loses a string value."""
        for kept in (
            '{"user_id": {"name": "Priya"}}',
            '{"email": 0}',
            '{"email": null}',
        ):
            self.assertEqual(cleaned(kept), kept)
            json.loads(cleaned(kept))
        redacted = cleaned('{"owner_id": "' + "a1b2c3d4e5f6" + '"}')
        self.assertNotIn("a1b2c3d4e5f6", redacted)
        json.loads(redacted)

    def test_scrubbing_twice_changes_nothing(self) -> None:
        once = cleaned(f"{JWT} {NOTION} {OWNER_PATH} +1 (415) 555-0134")
        self.assertEqual(cleaned(once), once)

    def test_find_reports_the_line_and_rule_but_not_the_text(self) -> None:
        found = scrub.find(f"clean\n{NOTION}\n", RULES)
        self.assertEqual([(v.line, v.rule) for v in found], [(2, "notion-secret")])


class HygieneCheckTest(unittest.TestCase):
    def test_the_committed_seed_and_fixture_trees_are_clean(self) -> None:
        targets = [
            ROOT / rel for rel in hygiene_check.DEFAULT_PATHS if (ROOT / rel).exists()
        ]
        self.assertEqual(hygiene_check.check(targets), [])

    def test_it_flags_a_leak_a_zip_and_a_credential_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "leak.txt").write_text(f"token {NOTION}\n", encoding="utf-8")
            (root / "bundle.zip").write_bytes(b"PK")
            bad_key = "api_" + "tok" + "en"
            (root / "manifest.json").write_text(
                json.dumps({bad_key: 1}), encoding="utf-8"
            )
            problems = hygiene_check.check([root], root)
        joined = "\n".join(problems)
        self.assertIn("leak.txt:1:notion-secret", joined)
        self.assertIn("bundle.zip:0:zip-archive", joined)
        self.assertIn(f"manifest.json:0:credential-key:{bad_key}", joined)

    def test_every_committed_recording_still_parses(self) -> None:
        for path in sorted(LIVE.rglob("*")):
            if not path.is_file():
                continue
            with self.subTest(path=str(path.relative_to(ROOT))):
                if path.suffix == ".html":
                    path.read_bytes().decode("utf-8")
                    continue
                text = path.read_text(encoding="utf-8")
                if path.suffix == ".json":
                    json.loads(text)
                elif path.suffix == ".jsonl":
                    for line in text.splitlines():
                        if line.strip():
                            json.loads(line)
                elif path.suffix == ".xml":
                    fromstring(text)

    def test_it_flags_an_unparseable_recording(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tools.json").write_text('{"a": ', encoding="utf-8")
            (root / "cli.jsonl").write_text('{"ok": 1}\n{"a": \n', encoding="utf-8")
            (root / "feed.xml").write_text("<rss><channel>", encoding="utf-8")
            (root / "fine.json").write_text('{"a": 1}', encoding="utf-8")
            problems = hygiene_check.check([root], root)
            self.assertEqual(hygiene_check.main([tmp]), 1)
        self.assertEqual(
            sorted(problems),
            [
                "cli.jsonl:2:not-parseable",
                "feed.xml:0:not-parseable",
                "tools.json:0:not-parseable",
            ],
        )

    def test_it_flags_a_real_library_key_or_id_outside_the_allow_list(self) -> None:
        hex_id = "0123456789abcdef" * 2
        dashed = "-".join(["0123abcd", "4567", "89ab", "cdef", "0123456789ab"])
        manifest = {
            "sources": {
                "notion": {
                    "real_library": {
                        "name": "notion",
                        "imported": 3,
                        "memory_ids": ["m1", "m2"],
                        "note": f"first memory {hex_id}",
                        "recorded": {"page": dashed},
                    }
                },
                "chatgpt": {"note": "no real_library block"},
            }
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            problems = hygiene_check.check([root], root)
            self.assertEqual(hygiene_check.main([tmp]), 1)
        self.assertEqual(
            problems,
            [
                "manifest.json:0:real-library-key:notion.memory_ids",
                "manifest.json:0:real-library-id:notion.note",
                "manifest.json:0:real-library-id:notion.recorded",
            ],
        )

    def test_it_flags_a_file_over_two_megabytes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            big = "ab cd\n" * (hygiene_check.MAX_BYTES // 6 + 1)
            (root / "big.txt").write_text(big, encoding="utf-8")
            self.assertEqual(hygiene_check.check([root], root), ["big.txt:0:over-2mb"])

    def test_it_exits_zero_on_a_clean_tree_and_one_on_a_dirty_one(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            clean = Path(tmp) / "ok.txt"
            clean.write_text("nothing here\n", encoding="utf-8")
            self.assertEqual(hygiene_check.main([str(clean)]), 0)
            dirty = Path(tmp) / "bad.txt"
            dirty.write_text(NOTION, encoding="utf-8")
            self.assertEqual(hygiene_check.main([str(dirty)]), 1)


class ManifestTest(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = json.loads((SEED / "manifest.json").read_text(encoding="utf-8"))

    def test_remote_is_all_empty_or_all_filled(self) -> None:
        for item in self.manifest["items"]:
            remote = item["remote"]
            self.assertLessEqual({"id", "url", "created_at"}, set(remote), item["id"])
            self.assertIn(
                sum(remote[k] is not None for k in ("id", "url", "created_at")),
                (0, 2, 3),
                item["id"],
            )

    def test_every_item_names_a_corpus_file_that_exists(self) -> None:
        for item in self.manifest["items"]:
            self.assertTrue((ROOT / item["corpus_path"]).exists(), item["id"])

    def test_source_counts_add_up_for_every_connector(self) -> None:
        for name, source in self.manifest["sources"].items():
            expected = source["expected"]
            self.assertEqual(
                expected["kept"] + expected["dropped"], expected["found"], name
            )

    def test_every_observed_value_matches_its_recorded_answer(self) -> None:
        for item in self.manifest["items"]:
            if item["observed"] is None:
                continue
            self.assertEqual(item["observed"], item["expected"], item["id"])
            self.assertTrue((ROOT / item["observed_in"]).is_file(), item["id"])

    def test_canaries_are_unique_and_follow_the_scheme(self) -> None:
        canaries = [i["canary"] for i in self.manifest["items"] if i["canary"]]
        self.assertEqual(len(canaries), len(set(canaries)))
        for canary in canaries:
            self.assertRegex(canary, r"^canary-[a-z]+-\d\d$")

    def item_text(self, item: dict[str, Any]) -> str:
        """The item's own text: its corpus file, or its record minus the `canary` field."""
        if item["connector"] not in JSON_CORPUS:
            return (ROOT / str(item["corpus_path"])).read_text(encoding="utf-8")
        name, lists = JSON_CORPUS[item["connector"]]
        corpus = json.loads((SEED / "corpus" / name).read_text(encoding="utf-8"))
        (record,) = [r for key in lists for r in corpus[key] if r["id"] == item["id"]]
        return json.dumps({k: v for k, v in record.items() if k != "canary"})

    def test_every_corpus_item_carries_its_canary_once_and_public_items_the_marker(
        self,
    ) -> None:
        """XC-053: canary presence per item, not just uniqueness in the manifest.

        A symlinked corpus file is an alias of another item's file (obs-16), so it is
        skipped. ChatGPT and Claude exports hold several items in one file, and a
        conversation repeats its canary (Claude) or holds a regenerated sibling's
        (cg-91 inside cg-01), so for them the rule is: the canary is in exactly one
        conversation of the export.
        """
        canaries = {i["canary"] for i in self.manifest["items"] if i["canary"]}
        for item in self.manifest["items"]:
            path = ROOT / item["corpus_path"]
            canary = item["canary"]
            with self.subTest(item=item["id"]):
                if path.is_symlink():
                    continue
                if item["connector"] in ("chatgpt", "claude"):
                    if canary:
                        conversations = json.loads(path.read_text(encoding="utf-8"))
                        holding = [c for c in conversations if canary in json.dumps(c)]
                        self.assertEqual(len(holding), 1)
                    continue
                text = self.item_text(item)
                found = set(re.findall(r"canary-[a-z]+-\d\d", text))
                if canary:
                    self.assertEqual(text.count(canary), 1)
                    self.assertEqual(found & canaries, {canary})
                else:
                    self.assertNotIn("canary-", text)
                if item["connector"] in PUBLIC and item["id"] not in NO_MARKER:
                    self.assertIn("tidewell-seed", text)

    def test_the_marker_exemptions_are_still_items_without_text(self) -> None:
        ids = {i["id"]: i for i in self.manifest["items"]}
        for item_id in NO_MARKER:
            self.assertIsNone(ids[item_id]["canary"], item_id)
            self.assertNotIn("tidewell-seed", self.item_text(ids[item_id]), item_id)

    def test_the_built_index_advertises_only_the_public_feed(self) -> None:
        built = build_blog.build()["index.html"]
        committed = (SEED / "corpus" / "blog" / "index.html").read_text(
            encoding="utf-8"
        )
        for index in (built, committed):
            self.assertEqual(_Html(index).links, ["/feed.xml"])
            self.assertNotIn("import/substack.xml", index)
            self.assertNotIn("import/medium/", index)

    def test_real_library_blocks_hold_only_names_and_counts(self) -> None:
        for name, source in self.manifest["sources"].items():
            block = source.get("real_library") or {}
            with self.subTest(source=name):
                self.assertLessEqual(set(block), hygiene_check.REAL_LIBRARY_KEYS)
        self.assertEqual(
            hygiene_check.real_library_problems(self.manifest, "manifest.json"), []
        )

    def test_the_proven_connectors_count_what_the_manifest_expects(self) -> None:
        for connector in ("obsidian", "chatgpt", "claude", "blog"):
            kept = [
                i
                for i in self.manifest["items"]
                if i["connector"] == connector and i["expected"] == "kept"
            ]
            self.assertEqual(
                len(kept), self.manifest["sources"][connector]["expected"]["kept"]
            )


if __name__ == "__main__":
    unittest.main()
