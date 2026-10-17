"""Tests for the seed tooling under support/seed.

Nothing here reaches a network or the owner's Keychain: the two seeders talk to a stub
HTTP server on 127.0.0.1, the feed recorder reads the committed blog from a local
server, and the hosted recorder reads an in-process stub with a fake keyring.
"""

from __future__ import annotations

import functools
import io
import json
import shutil
import sys
import tempfile
import threading
import unittest
import unittest.mock
import urllib.error
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from http.server import (
    BaseHTTPRequestHandler,
    SimpleHTTPRequestHandler,
    ThreadingHTTPServer,
)
from pathlib import Path
from typing import Any

import keyring
from fixtures.granola import Granola
from helpers import LoreTestCase
from test_hosted import FakeKeyring, serving

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "support" / "seed"
sys.path.insert(0, str(SEED))

import build_blog  # noqa: E402
import build_exports  # noqa: E402
import record  # noqa: E402
import scrub  # noqa: E402
import seed_bluesky  # noqa: E402
import seed_notion  # noqa: E402

from lore import sources as sources_module  # noqa: E402

RULES = scrub.load_rules()
# Not a real password: only its shape matters, and it is built so no file spells it.
PASSWORD = "-".join(["ab3d", "efgh", "ijkl", "mnop"])


class Stub(ThreadingHTTPServer):
    """A local stand-in for a service: records every POST and answers from `reply`."""

    def __init__(self, reply: Any) -> None:
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length) or b"{}")
                stub.calls.append(
                    {"path": self.path, "body": body, "headers": dict(self.headers)}
                )
                status, answer = reply(self.path, body, len(stub.calls))
                data = json.dumps(answer).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args: object) -> None:
                pass

        stub = self
        self.calls: list[dict[str, Any]] = []
        super().__init__(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"

    def stop(self) -> None:
        self.shutdown()
        self.server_close()


class BuildersTest(unittest.TestCase):
    def test_the_committed_blog_matches_what_the_corpus_builds(self) -> None:
        with redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(build_blog.main(["--check"]), 0, errors.getvalue())

    def test_a_stale_blog_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "site"
            shutil.copytree(SEED / "corpus" / "blog", out)
            (out / "feed.xml").write_text("changed", encoding="utf-8")
            with redirect_stderr(io.StringIO()) as errors:
                self.assertEqual(build_blog.main(["--check", "--out", str(out)]), 1)
            self.assertIn("stale: feed.xml", errors.getvalue())

    def test_the_committed_export_fixtures_match_the_corpus(self) -> None:
        with redirect_stderr(io.StringIO()):
            self.assertEqual(build_exports.main(["--check"]), 0)

    def test_the_built_zips_read_the_way_lore_reads_a_real_export(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            build_exports.build(Path(tmp))
            chat = sources_module.preview(str(Path(tmp) / "chatgpt-seed.zip"), "export")
            claude = sources_module.preview(
                str(Path(tmp) / "claude-seed.zip"), "export"
            )
        self.assertEqual((chat["count"], chat["skipped"]), (4, 1))
        self.assertEqual((claude["count"], claude["skipped"]), (2, 2))

    def test_the_zips_are_byte_for_byte_repeatable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            first = [p.read_bytes() for p in build_exports.build(Path(tmp) / "a")]
            second = [p.read_bytes() for p in build_exports.build(Path(tmp) / "b")]
        self.assertEqual(first, second)

    def test_the_vault_reads_nine_notes_and_skips_three(self) -> None:
        vault = SEED / "corpus" / "obsidian-vault" / "Tidewell"
        found = sources_module.preview(str(vault))
        self.assertEqual((found["count"], found["skipped"]), (9, 3))


class RecorderTest(LoreTestCase):
    def test_a_cli_answer_is_scrubbed_before_it_is_appended(self) -> None:
        leak = "s" + "dasbach4@gmail.com"
        with tempfile.TemporaryDirectory() as tmp:
            path = record.append_cli(
                "blog", "lore x", json.dumps({"who": leak}), Path(tmp), RULES
            )
            record.append_cli("blog", "lore y", "plain words", Path(tmp), RULES)
            lines = [
                json.loads(line)
                for line in path.read_text(encoding="utf-8").splitlines()
            ]
        self.assertEqual(lines[0]["output"], {"who": "redacted@example.com"})
        self.assertEqual(lines[1], {"command": "lore y", "output": "plain words"})

    def test_an_export_shape_shows_keys_and_types_never_values(self) -> None:
        private_text = "a private sentence nobody should see"
        document = [
            {"title": private_text, "mapping": {"a1b2c3d4e5f6a7b8c9": {"role": "user"}}}
        ]
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "x.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("deep/conversations.json", json.dumps(document))
            shape = record.export_shape(archive)
        text = json.dumps(shape)
        self.assertNotIn(private_text, text)
        self.assertIn("[].mapping.<id>.role", shape["paths"])
        self.assertEqual(shape["vocabulary"]["[].mapping.<id>.role"], ["user"])

    def test_a_feed_is_recorded_page_by_page_scrubbed_with_counts(self) -> None:
        class Quiet(SimpleHTTPRequestHandler):
            def log_message(self, *args: object) -> None:
                pass

        handler = functools.partial(Quiet, directory=str(SEED / "corpus" / "blog"))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        locator = f"http://127.0.0.1:{server.server_address[1]}"
        with tempfile.TemporaryDirectory() as tmp:
            raw, out = Path(tmp) / "raw", Path(tmp) / "out"
            with redirect_stdout(io.StringIO()):
                counts = record.record_feed("blog", locator, raw, out, RULES)
            saved = sorted(p.name for p in (out / "blog").iterdir())
            meta = json.loads((out / "blog" / "meta.json").read_text(encoding="utf-8"))
            raw_saved = sorted(p.name for p in (raw / "blog").iterdir())
        self.assertEqual(counts, {"found": 6, "kept": 5, "dropped": 1})
        self.assertIn("meta.json", saved)
        self.assertTrue(any(name.endswith(".xml") for name in saved), saved)
        self.assertEqual(len(meta["requests"]), len(raw_saved))
        self.assertTrue(all("scrub_hits" in r for r in meta["requests"]))

    def test_a_hosted_app_is_recorded_from_its_own_tools(self) -> None:
        fake = FakeKeyring()
        previous = keyring.get_keyring()
        keyring.set_keyring(fake)
        self.addCleanup(keyring.set_keyring, previous)
        stub = Granola()
        with tempfile.TemporaryDirectory() as tmp:
            raw, out = Path(tmp) / "raw", Path(tmp) / "out"
            with serving(stub.server), redirect_stdout(io.StringIO()):
                counts = record.record_hosted("granola", raw, out, RULES)
            saved = sorted(p.name for p in (out / "granola").iterdir())
        self.assertEqual(counts, {"listed": 2, "fetched": 2, "errors": 0})
        self.assertIn("tools-list.json", saved)
        self.assertIn("meta.json", saved)
        self.assertEqual(sorted(stub.read), ["m-1", "m-2"])
        self.assertEqual(fake.saved, {})


class SeedBlueskyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.corpus = json.loads(
            (SEED / "corpus" / "bluesky.json").read_text(encoding="utf-8")
        )

        def reply(path: str, body: dict[str, Any], number: int) -> tuple[int, Any]:
            if path.endswith("createSession"):
                return 200, {
                    seed_bluesky.SESSION_FIELD: "session-value",
                    "did": "did:plc:stub",
                }
            return 200, {"uri": f"at://did:plc:stub/x/{number}", "cid": f"cid{number}"}

        self.stub = Stub(reply)
        self.addCleanup(self.stub.stop)

    def test_every_record_is_created_in_order_with_replies_and_reposts_linked(
        self,
    ) -> None:
        made = seed_bluesky.seed(self.corpus, self.stub.base, PASSWORD, pause=0)
        self.assertEqual(list(made), [r["id"] for r in self.corpus["records"]])
        created = [c for c in self.stub.calls if c["path"].endswith("createRecord")]
        by_id = dict(zip(made, created, strict=True))
        reply = by_id["bs-07"]["body"]["record"]["reply"]
        self.assertEqual(reply["root"], made["bs-01"])
        self.assertEqual(reply["parent"], made["bs-01"])
        self.assertEqual(by_id["bs-08"]["body"]["record"]["subject"], made["bs-02"])
        session = self.stub.calls[0]
        self.assertEqual(
            session["body"], {"identifier": self.corpus["handle"], "password": PASSWORD}
        )
        self.assertEqual(created[0]["headers"]["Authorization"], "Bearer session-value")

    def test_facets_are_measured_in_utf8_bytes(self) -> None:
        seed_bluesky.seed(self.corpus, self.stub.base, PASSWORD, pause=0)
        post = next(
            c["body"]["record"]
            for c in self.stub.calls
            if c["body"].get("record", {}).get("facets")
        )
        encoded = post["text"].encode()
        for facet in post["facets"]:
            span = facet["index"]
            self.assertTrue(
                encoded[span["byteStart"] : span["byteEnd"]].decode().strip()
            )

    def test_the_facet_offset_moves_past_an_emoji(self) -> None:
        wanted = [{"kind": "tag", "match": "#tag", "tag": "tag"}]
        found = seed_bluesky.facets("\U0001f690 hello #tag", wanted)
        self.assertEqual(found[0]["index"], {"byteStart": 11, "byteEnd": 15})

    def test_a_record_without_the_seed_marker_is_refused_before_any_request(
        self,
    ) -> None:
        self.corpus["records"][0]["text"] = "an ordinary post"
        with self.assertRaises(seed_bluesky.SeedError):
            seed_bluesky.seed(self.corpus, self.stub.base, PASSWORD, pause=0)
        self.assertEqual(self.stub.calls, [])

    def test_the_manifest_records_each_uri_and_never_the_password_or_session(
        self,
    ) -> None:
        made = seed_bluesky.seed(self.corpus, self.stub.base, PASSWORD, pause=0)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "manifest.json"
            shutil.copy(SEED / "manifest.json", target)
            seed_bluesky.write_manifest(made, target)
            text = target.read_text(encoding="utf-8")
        document = json.loads(text)
        remote = next(i["remote"] for i in document["items"] if i["id"] == "bs-01")
        self.assertEqual(remote["id"], made["bs-01"]["uri"])
        self.assertNotIn(PASSWORD, text)
        self.assertNotIn("session-value", text)

    def test_a_dry_run_makes_no_request_and_a_missing_password_stops(self) -> None:
        with redirect_stdout(io.StringIO()) as printed:
            self.assertEqual(seed_bluesky.main(["--dry-run"]), 0)
        self.assertIn("bs-01", printed.getvalue())
        with unittest.mock.patch.dict("os.environ", {"BSKY_APP_PASSWORD": ""}):
            with redirect_stderr(io.StringIO()):
                self.assertEqual(seed_bluesky.main(["--service", self.stub.base]), 2)
        self.assertEqual(self.stub.calls, [])


class SeedNotionTest(unittest.TestCase):
    def stub(self, database_status: int = 200) -> Stub:
        def reply(path: str, body: dict[str, Any], number: int) -> tuple[int, Any]:
            if path.endswith("/databases") and database_status != 200:
                return database_status, {"object": "error"}
            return 200, {"id": f"id-{number:02d}"}

        stub = Stub(reply)
        self.addCleanup(stub.stop)
        return stub

    def setUp(self) -> None:
        self.corpus = json.loads(
            (SEED / "corpus" / "notion.json").read_text(encoding="utf-8")
        )

    def test_every_page_is_created_under_the_parent_with_its_blocks(self) -> None:
        stub = self.stub()
        made, notes = seed_notion.seed(self.corpus, stub.base, "tok", "parent-1")
        self.assertEqual(list(made), [p["id"] for p in self.corpus["pages"]])
        self.assertEqual(notes, [])
        pages = [
            c
            for c in stub.calls
            if c["path"].endswith("/pages") and "children" in c["body"]
        ]
        self.assertTrue(
            all(c["body"]["parent"] == {"page_id": "parent-1"} for c in pages)
        )
        self.assertTrue(
            all(
                c["headers"]["Notion-Version"] == seed_notion.VERSION
                for c in stub.calls
            )
        )
        kinds = {b["type"] for c in pages for b in c["body"]["children"]}
        self.assertLessEqual(
            kinds,
            {
                "paragraph",
                "heading_1",
                "heading_2",
                "heading_3",
                "bulleted_list_item",
                "to_do",
                "code",
            },
        )

    def test_the_empty_page_is_created_without_children(self) -> None:
        stub = self.stub()
        seed_notion.seed(self.corpus, stub.base, "tok", "parent-1")
        empty = [
            c
            for c in stub.calls
            if c["body"].get("properties", {}).get("title", {})
            and "children" not in c["body"]
            and "parent" in c["body"]
            and c["body"]["parent"].get("page_id")
        ]
        self.assertTrue(empty)

    def test_a_database_notion_refuses_is_skipped_and_logged(self) -> None:
        stub = self.stub(database_status=400)
        made, notes = seed_notion.seed(self.corpus, stub.base, "tok", "parent-1")
        self.assertIn("nt-05", made)
        self.assertEqual(len(notes), 1)
        self.assertIn("nt-05", notes[0])
        self.assertIn("400", notes[0])

    def test_a_page_that_lacks_the_marker_is_refused_before_any_request(self) -> None:
        stub = self.stub()
        self.corpus["pages"][0]["blocks"] = [{"type": "paragraph", "text": "unmarked"}]
        with self.assertRaises(seed_notion.SeedError):
            seed_notion.seed(self.corpus, stub.base, "tok", "parent-1")
        self.assertEqual(stub.calls, [])

    def test_the_manifest_records_each_page_and_never_the_token(self) -> None:
        stub = self.stub()
        made, _ = seed_notion.seed(self.corpus, stub.base, "tok-value", "parent-1")
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "manifest.json"
            shutil.copy(SEED / "manifest.json", target)
            seed_notion.write_manifest(made, target)
            text = target.read_text(encoding="utf-8")
        remote = next(
            i["remote"] for i in json.loads(text)["items"] if i["id"] == "nt-01"
        )
        self.assertEqual(remote["id"], made["nt-01"])
        self.assertNotIn("tok-value", text)

    def test_a_dry_run_lists_pages_and_a_missing_token_stops(self) -> None:
        with redirect_stdout(io.StringIO()) as printed:
            self.assertEqual(seed_notion.main(["--dry-run"]), 0)
        self.assertIn("nt-01", printed.getvalue())
        with unittest.mock.patch.dict("os.environ", {"NOTION_TOKEN": ""}):
            with redirect_stderr(io.StringIO()):
                self.assertEqual(seed_notion.main(["--parent", "p"]), 2)

    def test_the_stub_reports_http_errors_the_way_urllib_raises_them(self) -> None:
        stub = self.stub(database_status=400)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            seed_notion.call(stub.base, "databases", {}, "tok")
        caught.exception.close()


if __name__ == "__main__":
    unittest.main()
