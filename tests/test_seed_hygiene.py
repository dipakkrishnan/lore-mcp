"""The seed tree and its recorded fixtures must never hold a secret or a real identity.

These tests run the same scrub rules and hygiene check the pre-commit checklist uses,
over the committed seed files, and prove the rules catch what they are meant to. Every
sample secret is assembled at run time so this file does not itself contain one.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "support" / "seed"
sys.path.insert(0, str(SEED))

import hygiene_check  # noqa: E402
import scrub  # noqa: E402

RULES = scrub.load_rules()
JWT = (
    "ey" + "J" + "hbGciOiJIUzI1NiJ9" + "." + "abcdefghijklmn" + "." + "opqrstuvwxyz0123"
)
NOTION = "n" + "tn_" + "A1b2C3d4E5f6G7h8I9j0K1l2"
OWNER = "s" + "dasbach"
OWNER_PATH = "/Users/" + "s" + "hane" + "dasbach" + "/code"


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
