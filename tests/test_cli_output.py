"""What `lore.cli` prints at a terminal, and the guards it hits on the way.

`tests/test_cli.py` owns the commands themselves, mostly through their `--json`
output, which is what the desktop app reads. This file covers the other
reader: an owner at a terminal, who gets cards and sentences instead — and the
edges where a command refuses a value that got past argparse. Each test here
pins a branch the rest of the suite left unexercised.
"""

from __future__ import annotations

import json
import os
import sys
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from helpers import LoreTestCase, captured

from lore import cli
from lore import deploy as deploy_module
from lore.store import Status, Store


def attended():
    """Stand in for an owner at a terminal, which owner actions require."""
    return patch.object(cli, "_interactive", return_value=True)


class MemoryCardTextTest(LoreTestCase):
    """Without `--json`, a changed memory comes back as the card a person reads."""

    def test_rename_prints_the_card_with_the_new_title(self) -> None:
        memory_id = self.seed_memory("Old title")
        with captured() as output:
            self.assertEqual(cli.rename_memory(memory_id, "New title", False), 0)
        lines = output.getvalue().splitlines()
        # A rule, then the title the card now carries; the body is unchanged.
        self.assertEqual(lines[1], "─" * 72)
        self.assertEqual(lines[2], "New title")
        self.assertIn("Old title about deployment", output.getvalue())

    def test_edit_prints_the_card_with_the_new_content(self) -> None:
        memory_id = self.seed_memory("Kept lesson")
        with captured() as output:
            self.assertEqual(cli.edit_memory(memory_id, "Rewritten in full", False), 0)
        text = output.getvalue()
        self.assertIn("Kept lesson", text)
        self.assertIn("Rewritten in full", text)
        self.assertNotIn("Kept lesson about deployment", text)

    def test_delete_names_what_went(self) -> None:
        # One a source brought in is discarded, so reading it again keeps it gone.
        memory_id = self.seed_memory("Gone lesson")
        with captured() as output:
            self.assertEqual(cli.delete_memory(memory_id, False), 0)
        self.assertEqual(output.getvalue().strip(), "Deleted Gone lesson.")
        with Store() as store:
            memory = store.get(memory_id)
        assert memory is not None
        self.assertIs(memory.status, Status.DISCARDED)


class NodeReportTextTest(LoreTestCase):
    """`lore node views` and `lore node sales` as an owner reads them."""

    def test_views_list_titles_most_viewed_first_and_fall_back_to_the_id(
        self,
    ) -> None:
        memory_id = self.seed_memory("Deploy notes")
        with Store() as store:
            store.add_publication(
                title="Deploy checklist",
                content="Body",
                topic="deploys",
                teaser="Teaser",
                provenance=[memory_id],
            )
            public_id = store.list_publications()[0].public_id
        rows = [
            deploy_module.PageViews(item_id="0000000000000000deadbeef", views=2),
            deploy_module.PageViews(item_id=public_id, views=9),
        ]
        with patch("lore.deploy.views", return_value=rows), captured() as output:
            self.assertEqual(cli.main(["node", "views"]), 0)
        lines = output.getvalue().splitlines()
        self.assertEqual(
            lines,
            ["       9  Deploy checklist", "       2  0000000000000000deadbeef"],
        )

    def test_views_say_so_when_nobody_has_looked(self) -> None:
        with patch("lore.deploy.views", return_value=[]), captured() as output:
            self.assertEqual(cli.main(["node", "views"]), 0)
        self.assertIn("No page views yet.", output.getvalue())

    def test_sales_say_so_when_nothing_has_sold(self) -> None:
        with patch("lore.deploy.sales", return_value=[]), captured() as output:
            self.assertEqual(cli.main(["node", "sales"]), 0)
        self.assertEqual(output.getvalue().strip(), "No sales yet.")


class StoreSettingHintTest(LoreTestCase):
    """A setting the store serves is only live after the next push; say so then."""

    HINT = "Your store picks this up on the next `lore push`."

    def test_support_and_free_copies_mention_the_push_only_with_a_store(
        self,
    ) -> None:
        with attended(), captured() as output:
            self.assertEqual(cli.support_email("help@example.com"), 0)
            self.assertEqual(cli.free_copies(2), 0)
        self.assertNotIn(self.HINT, output.getvalue())

        with Store() as store:
            store.set_setting("node_url", "https://lore.example.workers.dev")
        with attended(), captured() as output:
            self.assertEqual(cli.support_email("help@example.com"), 0)
        self.assertIn("Buyers write to help@example.com", output.getvalue())
        self.assertIn(self.HINT, output.getvalue())
        with attended(), captured() as output:
            self.assertEqual(cli.free_copies(1), 0)
        self.assertIn("The first 1 copy of each piece is free", output.getvalue())
        self.assertIn(self.HINT, output.getvalue())


class SourcesCatalogTest(LoreTestCase):
    """The apps Lore can read, and the choices one of them offers."""

    def setUp(self) -> None:
        super().setUp()
        # Never the owner's own Obsidian registry.
        self.obsidian_home = Path(self.tmp.name) / "obsidian"
        os.environ["OBSIDIAN_HOME"] = str(self.obsidian_home)
        self.addCleanup(os.environ.pop, "OBSIDIAN_HOME", None)

    def test_catalog_lists_every_app_as_json_and_as_lines(self) -> None:
        with captured() as output:
            self.assertEqual(cli.main(["sources", "catalog", "--json"]), 0)
        apps = json.loads(output.getvalue())
        ids = [app["id"] for app in apps]
        self.assertIn("obsidian", ids)
        self.assertIn("chatgpt", ids)
        with captured() as output:
            self.assertEqual(cli.main(["sources", "catalog"]), 0)
        lines = output.getvalue().splitlines()
        self.assertEqual(len(lines), len(apps))
        self.assertIn(f"  {'obsidian':<14} Your vaults and notes", lines)

    def test_choices_offer_obsidian_vaults_open_one_first(self) -> None:
        vault = Path(self.tmp.name) / "Work"
        vault.mkdir()
        other = Path(self.tmp.name) / "Archive"
        other.mkdir()
        self.obsidian_home.mkdir()
        (self.obsidian_home / "obsidian.json").write_text(
            json.dumps(
                {
                    "vaults": {
                        "a": {"path": str(other)},
                        "b": {"path": str(vault), "open": True},
                    }
                }
            )
        )
        with captured() as output:
            self.assertEqual(cli.main(["sources", "choices", "obsidian", "--json"]), 0)
        choices = json.loads(output.getvalue())
        self.assertEqual([c["label"] for c in choices], ["Work", "Archive"])
        with captured() as output:
            self.assertEqual(cli.main(["sources", "choices", "obsidian"]), 0)
        lines = output.getvalue().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith(f"  {'Work':<20} "))

    def test_choices_for_an_unknown_app_fail_with_a_message(self) -> None:
        with (
            patch.object(sys, "stderr", StringIO()) as errors,
            captured() as output,
        ):
            self.assertEqual(cli.main(["sources", "choices", "nope"]), 2)
        self.assertIn("lore: unknown app: nope", errors.getvalue())
        self.assertEqual(output.getvalue(), "")

    def test_a_blank_locator_is_refused_before_anything_is_read(self) -> None:
        with patch.object(sys, "stderr", StringIO()) as errors, captured():
            self.assertEqual(cli.main(["sources", "preview", "--folder", ""]), 2)
        self.assertIn("lore: a source locator is required", errors.getvalue())

    def test_connecting_an_app_outside_the_reported_list_records_nothing(
        self,
    ) -> None:
        # Only the closed connector vocabulary in `usage.CONNECTORS` is ever reported.
        entry = {
            "name": "agent-1",
            "label": "Agent",
            "enabled": True,
            "state": "connected",
            "imported": 0,
        }
        with (
            patch.object(cli.Registry, "connect", return_value=entry),
            patch("lore.usage.record") as record,
            captured() as output,
        ):
            self.assertEqual(
                cli.main(["sources", "connect", "agent", "x", "--json"]), 0
            )
        self.assertEqual(json.loads(output.getvalue()), entry)
        record.assert_not_called()


class SourceSwitchTest(LoreTestCase):
    """Turning one of the agents' own histories on or off is the owner's call."""

    def setUp(self) -> None:
        super().setUp()
        memory = self.codex_home / "memories/MEMORY.md"
        memory.parent.mkdir(parents=True)
        memory.write_text("# Preference\n\nKeep it short.")

    def test_enable_and_disable_change_the_configured_sources(self) -> None:
        with attended(), captured() as output:
            self.assertEqual(cli.main(["sources", "enable", "codex"]), 0)
        self.assertIn("● Codex", output.getvalue())
        with Store() as store:
            self.assertEqual(store.setting("sources"), ["codex"])
        with attended(), captured() as output:
            self.assertEqual(cli.main(["sources", "disable", "codex", "--json"]), 0)
        self.assertFalse(json.loads(output.getvalue())["enabled"])
        with Store() as store:
            self.assertEqual(store.setting("sources"), [])

    def test_a_pipe_cannot_switch_a_source(self) -> None:
        with (
            patch.object(cli, "_interactive", return_value=False),
            patch.object(sys, "stderr", StringIO()) as errors,
            captured(),
        ):
            self.assertEqual(cli.main(["sources", "enable", "codex"]), 1)
        self.assertIn("turning codex on needs an attended terminal", errors.getvalue())
        with Store() as store:
            self.assertIsNone(store.setting("sources", None))

    def test_a_malformed_sources_setting_stops_sync_with_a_message(self) -> None:
        for bad in ("codex", [1]):
            with self.subTest(bad=bad):
                with Store() as store:
                    store.set_setting("sources", bad)
                with patch.object(sys, "stderr", StringIO()) as errors, captured():
                    self.assertEqual(cli.main(["sync"]), 1)
                self.assertIn(
                    "configured sources must be a list of names", errors.getvalue()
                )


class AutomationEditTest(LoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        # With an app version set, `main` hands every routine to the app first.
        previous = os.environ.pop("LORE_APP_VERSION", None)
        if previous is not None:
            self.addCleanup(os.environ.__setitem__, "LORE_APP_VERSION", previous)

    def test_editing_an_owner_routine_names_what_changed(self) -> None:
        with captured() as output:
            cli.main(
                [
                    "automation",
                    "add",
                    "Summarize my week",
                    "--hour",
                    "9",
                    "--cadence",
                    "weekly",
                    "--json",
                ]
            )
        routine_id = json.loads(output.getvalue())["id"]
        with captured() as output:
            self.assertEqual(
                cli.main(
                    [
                        "automation",
                        "edit",
                        routine_id,
                        "Summarize my month",
                        "--title",
                        "Monthly",
                    ]
                ),
                0,
            )
        self.assertEqual(output.getvalue().strip(), f"Changed {routine_id}: Monthly")


class JobListTest(LoreTestCase):
    def test_job_list_prints_recent_jobs_newest_first(self) -> None:
        with captured():
            cli.main(["job", "start", "synthesis", "--timeout-minutes", "60"])
            cli.main(["job", "start", "push", "--timeout-minutes", "60"])
        with captured() as output:
            self.assertEqual(cli.main(["job", "list"]), 0)
        jobs = json.loads(output.getvalue())
        self.assertEqual([job["kind"] for job in jobs], ["push", "synthesis"])
        self.assertTrue(all(job["status"] == "running" for job in jobs))


class ExtrasCandidatesTest(LoreTestCase):
    def test_nothing_staged_prints_an_empty_list(self) -> None:
        with captured() as output:
            self.assertEqual(cli.main(["publication", "extras", "candidates"]), 0)
        self.assertEqual(json.loads(output.getvalue()), [])


class CardsTextTest(LoreTestCase):
    def test_status_without_a_pending_account_never_asks_stripe(self) -> None:
        with patch.object(cli.cards_module, "status") as status:
            with captured() as output:
                self.assertEqual(cli.cards(None, None, True), 0)
            self.assertIsNone(json.loads(output.getvalue())["ready"])
            with Store() as store:
                store.set_setting("stripe_account", "acct_1Seller")
            with captured() as output:
                self.assertEqual(cli.cards(None, None, True), 0)
        status.assert_not_called()
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["account"], "acct_1Seller")
        self.assertIs(payload["ready"], True)
        self.assertIs(payload["checking"], False)

    def test_connect_at_a_terminal_reuses_the_pending_account_and_prints_its_link(
        self,
    ) -> None:
        with Store() as store:
            store.set_setting("stripe_account_pending", "acct_1Pending")
            store.set_setting("stripe_account_token", "b" * 64)
        with (
            attended(),
            patch.object(cli.cards_module, "open_account") as open_account,
            captured() as output,
        ):
            self.assertEqual(cli.cards("connect", None), 0)
        open_account.assert_not_called()
        text = output.getvalue()
        self.assertIn("Finish with Stripe in your browser: ", text)
        self.assertIn("/onboard?account=acct_1Pending&token=", text)


class SetupFolderModeTest(LoreTestCase):
    def test_setup_tightens_an_automation_folder_others_could_write(self) -> None:
        # The desktop agent's sandbox may read this folder, never write it.
        automation_dir = self.lore_home / "automation"
        automation_dir.mkdir(parents=True, mode=0o755)
        automation_dir.chmod(0o755)
        with captured():
            self.assertEqual(cli.setup(True), 0)
        self.assertEqual(oct(automation_dir.stat().st_mode)[-3:], "700")
