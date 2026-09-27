"""Tests for lore/marketplace.py (XC-036): the store lists itself by saying so
in its own discover, and the public list is read straight from the registry
file. No test makes a real network call or runs wrangler."""

from __future__ import annotations

import json
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import Mock, patch

from helpers import LoreTestCase

from lore import blueprint, cli, marketplace
from lore.store import Store

NODE = "https://lore.example.workers.dev/mcp"


class MarketplaceTest(LoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        with Store() as store:
            store.set_setting("node_url", NODE)
        self.file = Path(self.tmp.name) / "marketplace.json"
        self.on_file(False)
        env = patch.dict("os.environ", {"LORE_MARKETPLACE_URL": self.file.as_uri()})
        env.start()
        self.addCleanup(env.stop)
        self.push = Mock(return_value=0)

    def market(self) -> marketplace.Marketplace:
        return marketplace.Marketplace(self.push)

    def on_file(self, listed: bool) -> None:
        sellers = [{"node": NODE}] if listed else [{"node": "https://other.dev/mcp"}]
        self.file.write_text(json.dumps({"sellers": sellers}))

    def pushed_name(self) -> str:
        with Store() as store:
            return store.setting(marketplace.NAME_SETTING, "")

    def test_needs_an_open_store(self) -> None:
        with Store() as store:
            store.set_setting("node_url", None)
        with self.assertRaisesRegex(ValueError, "open your store"):
            self.market()

    def test_status_reads_the_file_and_the_switch(self) -> None:
        market = self.market()
        self.assertEqual(market.status(), marketplace.Listing(state="none"))
        market.name = "Ada"
        pending = market.status()
        self.assertEqual((pending.state, pending.action), ("pending", "list"))
        self.assertEqual(pending.url, market.request_url())
        self.on_file(True)
        self.assertEqual(market.status().state, "listed")
        market.name = ""
        self.assertEqual(market.status().action, "delist")

    def test_the_request_link_prefills_the_form(self) -> None:
        url = self.market().request_url()
        self.assertTrue(
            url.startswith(
                "https://github.com/dipakkrishnan/lore-marketplace/issues/new?"
            )
        )
        self.assertIn("template=listing.yml", url)
        self.assertIn("node=https%3A%2F%2Flore.example.workers.dev%2Fmcp", url)

    def test_an_unreadable_file_is_an_oserror(self) -> None:
        self.file.write_text("not json")
        with self.assertRaisesRegex(OSError, "public list"):
            self.market().status()

    def test_listing_pushes_the_setup_name(self) -> None:
        blueprint.blueprint_path().parent.mkdir(parents=True, exist_ok=True)
        blueprint.blueprint_path().write_text(json.dumps({"name": " A\x00da "}))
        listing = self.market().list()
        self.assertEqual(self.pushed_name(), "Ada")
        self.push.assert_called_once_with()
        self.assertEqual((listing.state, listing.action), ("pending", "list"))

    def test_a_name_is_needed_and_capped(self) -> None:
        with self.assertRaisesRegex(ValueError, "display name"):
            self.market().list()
        with self.assertRaisesRegex(ValueError, "over 80"):
            self.market().list("x" * 81)
        self.push.assert_not_called()

    def test_a_failed_push_keeps_the_old_switch(self) -> None:
        self.push.side_effect = ValueError("wrangler could not write")
        with self.assertRaisesRegex(ValueError, "wrangler"):
            self.market().list("Ada")
        self.assertEqual(self.pushed_name(), "")

    def test_delisting_switches_the_store_off(self) -> None:
        self.on_file(True)
        self.market().list("Ada")
        listing = self.market().delist()
        self.assertEqual(self.pushed_name(), "")
        self.assertEqual(listing, marketplace.Listing(state="none"))

    def test_a_switch_that_landed_does_not_need_the_public_list(self) -> None:
        self.file.unlink()
        listing = self.market().list("Ada")
        self.assertEqual(listing.url, self.market().request_url())

    def test_the_push_carries_the_listed_name(self) -> None:
        with Store() as store:
            sql = cli._push_sql([], store.answer_settings(), "Ada")
        self.assertIn("VALUES ('listed_name','Ada');", sql)

    def test_list_pushes_the_node_and_prints_only_json(self) -> None:
        worker = self.lore_home / "node"
        worker.mkdir(parents=True)
        (worker / "wrangler.jsonc").write_text("{}")
        out = StringIO()
        with (
            patch.object(cli, "_owner_action"),
            patch.object(
                cli, "push_job", side_effect=lambda *_: print("✓ Pushed")
            ) as push_job,
            patch("sys.stdout", out),
        ):
            code = cli.main(["marketplace", "list", "--name", "Ada", "--json"])
        push_job.assert_called_once_with(worker, False)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["state"], "pending")

    def test_status_needs_no_attended_surface(self) -> None:
        out = StringIO()
        with patch("sys.stdout", out):
            code = cli.main(["marketplace", "status", "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue()), {"state": "none"})

    def test_listing_is_an_owner_action(self) -> None:
        err = StringIO()
        with patch("sys.stderr", err), patch("sys.stdin") as stdin:
            stdin.isatty.return_value = False
            code = cli.main(["marketplace", "list", "--name", "Ada"])
        self.assertEqual(code, 1)
        self.assertIn("attended terminal", err.getvalue())


if __name__ == "__main__":
    unittest.main()
