"""Owner commands `lore.cli.main` dispatches that nothing else drove end to end.

`tests/test_cli.py` owns each command's behaviour, and `tests/test_cli_output.py`
covers what a terminal shows. This file covers what was left: `main` routing a
subcommand to its handler (memory gists, telemetry noticed/record, node login,
accounts, secrets, automation run), what a failed deploy does not record, the
collection edits the app sends, the store being rebuilt before its first push,
and the extras review an owner quits or rejects. Each test pins a line or
branch the rest of the suite left unexercised.
"""

from __future__ import annotations

import json
import math
import sys
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from helpers import LoreTestCase, captured

from lore import automation, cli, usage
from lore.cloudflare import Account
from lore.store import FIT_LIMIT, Status, Store


def attended():
    """Stand in for an owner at a terminal, which owner actions require."""
    return patch.object(cli, "_interactive", return_value=True)


class NoticedTestCase(LoreTestCase):
    """The usage notice is already shown, so an attended `main` prints only its
    own output, and a failure's `cli.failed` event is caught, not sent."""

    def setUp(self) -> None:
        super().setUp()
        with Store() as store:
            store.set_setting(usage.NOTICED_SETTING, True)


class MemoryGistsTest(LoreTestCase):
    def test_gists_prints_each_kept_memorys_gist_by_id(self) -> None:
        kept = self.seed_memory("Kept lesson")
        discarded = self.seed_memory("Discarded lesson")
        with Store() as store:
            store.set_status(discarded, Status.DISCARDED.value)
        with captured() as output:
            self.assertEqual(cli.main(["memory", "gists"]), 0)
        gists = json.loads(output.getvalue())
        # JSON object keys are strings; only the kept memory is offered.
        self.assertEqual(list(gists), [str(kept)])
        self.assertIn("Kept lesson about deployment", gists[str(kept)])


class TelemetryDispatchTest(LoreTestCase):
    def test_noticed_records_that_the_owner_saw_the_notice(self) -> None:
        with Store() as store:
            self.assertFalse(store.setting(usage.NOTICED_SETTING, False))
        with captured() as output:
            self.assertEqual(cli.main(["telemetry", "noticed"]), 0)
        self.assertEqual(output.getvalue(), "")
        with Store() as store:
            self.assertTrue(store.setting(usage.NOTICED_SETTING, False))

    def test_record_passes_the_apps_event_and_value_through(self) -> None:
        with patch("lore.usage.record") as record:
            self.assertEqual(
                cli.main(["telemetry", "record", "firstrun.step", "agent"]), 0
            )
            self.assertEqual(cli.main(["telemetry", "record", "app.opened"]), 0)
        self.assertEqual(
            [call.args for call in record.call_args_list],
            [("firstrun.step", "agent"), ("app.opened", "")],
        )


class NodeDispatchTest(LoreTestCase):
    def test_a_failed_deploy_records_neither_store_event(self) -> None:
        for argv, inbox_only in (
            (["node", "deploy"], False),
            (["node", "deploy", "--inbox-only"], True),
        ):
            with self.subTest(argv=argv):
                with (
                    patch("lore.deploy.deploy", return_value=1) as deploy,
                    patch("lore.usage.record") as record,
                ):
                    self.assertEqual(cli.main(argv), 1)
                self.assertEqual(deploy.call_args.args, (None, None))
                self.assertEqual(deploy.call_args.kwargs, {"inbox_only": inbox_only})
                record.assert_not_called()

    def test_login_returns_what_the_browser_sign_in_returned(self) -> None:
        for code in (0, 3):
            with self.subTest(code=code):
                with patch("lore.deploy.login", return_value=code) as login:
                    self.assertEqual(cli.main(["node", "login"]), code)
                login.assert_called_once_with()

    def test_accounts_at_a_terminal_lists_each_id_and_name(self) -> None:
        found = [
            Account(id="a1b2", name="Ada's account"),
            Account(id="c3d4", name="Team"),
        ]
        with patch("lore.deploy.accounts", return_value=found), captured() as output:
            self.assertEqual(cli.main(["node", "accounts"]), 0)
        self.assertEqual(
            output.getvalue().splitlines(), ["  a1b2  Ada's account", "  c3d4  Team"]
        )

    def test_no_accounts_at_a_terminal_prints_nothing(self) -> None:
        with patch("lore.deploy.accounts", return_value=[]), captured() as output:
            self.assertEqual(cli.main(["node", "accounts"]), 0)
        self.assertEqual(output.getvalue(), "")

    def test_no_secrets_at_a_terminal_says_so(self) -> None:
        with patch("lore.deploy.secret_names", return_value=[]), captured() as output:
            self.assertEqual(cli.main(["node", "secrets"]), 0)
        self.assertIn("No secrets on the node yet.", output.getvalue())


class AutomationRunTest(LoreTestCase):
    """`collect` is the routine whose run does no reading: it only hands the app
    the sentence to ask, so `automation run` can be driven for real."""

    def setUp(self) -> None:
        super().setUp()
        automation.Routines().record("collect", "3 suggested")

    def test_run_at_a_terminal_names_the_routine_and_its_last_result(self) -> None:
        with captured() as output:
            self.assertEqual(cli.main(["automation", "run", "collect"]), 0)
        self.assertEqual(output.getvalue().strip(), "Ran collect: 3 suggested")
        # The run is marked, so the app does not run it again at once.
        self.assertIsNotNone(automation.Routines().saved["collect"].last_run)

    def test_run_as_json_hands_the_app_the_routine_and_what_to_ask(self) -> None:
        with captured() as output:
            self.assertEqual(cli.main(["automation", "run", "collect", "--json"]), 0)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["routine"]["id"], "collect")
        self.assertIn("ask", payload)


class CollectionEditsTest(NoticedTestCase):
    """The edits the app sends for a collection that is not on sale; with no node
    set up, none of them pushes."""

    def setUp(self) -> None:
        super().setUp()
        with Store() as store:
            self.collection = store.new_collection().id
            self.piece = store.add_to_collection(
                self.collection, "A", "Export controls leak"
            ).id

    def run_cli(self, *argv: str) -> dict:
        with attended(), captured() as output:
            self.assertEqual(cli.main(["collection", *argv]), 0)
        result: dict = json.loads(output.getvalue())
        return result

    def test_rename_renames_it(self) -> None:
        renamed = self.run_cli("rename", str(self.collection), "Trade policy")
        self.assertEqual(renamed["title"], "Trade policy")
        with Store() as store:
            self.assertEqual(store.collection(self.collection).title, "Trade policy")

    def test_a_price_that_is_not_a_number_zero_or_more_is_refused(self) -> None:
        for amount in ("-1", "nan", "inf"):
            with self.subTest(amount=amount):
                stderr = StringIO()
                with (
                    attended(),
                    patch("lore.usage.record") as record,
                    patch("lore.collection.Collections.price") as priced,
                    captured() as output,
                    redirect_stderr(stderr),
                ):
                    code = cli.main(
                        ["collection", "price", str(self.collection), "--", amount]
                    )
                self.assertEqual(code, 1)
                self.assertEqual(output.getvalue(), "")
                self.assertIn(
                    "a price has to be a number, zero or more", stderr.getvalue()
                )
                record.assert_called_once_with("cli.failed", "collection")
                # Refused at the command, before the collection is touched; the
                # store's own check is only the backstop.
                priced.assert_not_called()
                with Store() as store:
                    price = store.collection(self.collection).price_usd
                self.assertTrue(math.isfinite(price) and price == 0)

    def test_remove_takes_the_piece_out(self) -> None:
        changed = self.run_cli("remove", str(self.collection), str(self.piece))
        self.assertEqual(changed["pieces"], [])
        with Store() as store:
            self.assertEqual(store.collection(self.collection).pieces, [])

    def test_delete_deletes_it(self) -> None:
        self.assertEqual(
            self.run_cli("delete", str(self.collection)), {"deleted": self.collection}
        )
        with Store() as store, self.assertRaisesRegex(ValueError, "not found"):
            store.collection(self.collection)


class FirstPushTest(NoticedTestCase):
    """A store set up inside Lore's home is rebuilt in its own folder before its
    first push; any other folder without node source is refused as it is."""

    def test_the_store_folder_is_rebuilt_before_its_first_push(self) -> None:
        def rebuild() -> Path:
            self.store.mkdir(parents=True, exist_ok=True)
            (self.store / "wrangler.jsonc").write_text("{}", encoding="utf-8")
            return self.store

        with (
            attended(),
            patch("lore.deploy.tools", side_effect=rebuild) as tools,
            patch.object(cli, "push_job", return_value=0) as push_job,
        ):
            self.assertEqual(cli.push(str(cli.store_folder())), 0)
        tools.assert_called_once_with()
        self.assertEqual(push_job.call_args.args, (self.store, False))

    def test_another_folder_without_node_source_is_not_rebuilt(self) -> None:
        elsewhere = self.store.parent / "elsewhere"
        elsewhere.mkdir()
        with (
            attended(),
            patch("lore.deploy.tools") as tools,
            patch.object(cli, "push_job") as push_job,
            self.assertRaisesRegex(ValueError, "no node source"),
        ):
            cli.push(str(elsewhere))
        tools.assert_not_called()
        push_job.assert_not_called()


class ExtrasReviewStopsTest(LoreTestCase):
    """The extras review an owner quits, rejects, or edits into something too long."""

    def setUp(self) -> None:
        super().setUp()
        with Store() as store:
            self.piece = store.add_publication(
                title="Pricing claim",
                content="a bounded claim about pricing agent APIs",
                topic="pricing",
                teaser="What did pricing teach?",
                provenance=[self.seed_memory("Pricing lesson")],
            )
        batch = json.dumps([{"publication_id": self.piece, "sample": "A dollar."}])
        with patch.object(sys, "stdin", StringIO(batch)), captured():
            self.assertEqual(cli.extras_draft("-"), 0)

    def review(self, answers: list[str]) -> tuple[str, str]:
        stderr = StringIO()
        with (
            attended(),
            patch.object(cli, "ask", side_effect=answers),
            patch.object(cli, "_push_after_approval") as pushed,
            captured() as output,
            redirect_stderr(stderr),
        ):
            self.assertEqual(cli.extras_review(), 0)
        pushed.assert_not_called()
        return output.getvalue(), stderr.getvalue()

    def sample(self) -> str:
        with Store() as store:
            return store.active_publication(self.piece).sample

    def test_quitting_keeps_the_update_staged_and_changes_nothing(self) -> None:
        output, _ = self.review(["q"])
        self.assertIn("Updated 0 pieces", output)
        self.assertEqual(self.sample(), "")
        staged = json.loads(cli._extras_path().read_text(encoding="utf-8"))
        self.assertEqual([entry["sample"] for entry in staged], ["A dollar."])

    def test_rejecting_drops_the_update_and_pushes_nothing(self) -> None:
        output, _ = self.review(["r"])
        self.assertIn("Updated 0 pieces", output)
        self.assertEqual(self.sample(), "")
        self.assertFalse(cli._extras_path().exists())

    def test_an_edit_too_long_is_warned_about_and_the_draft_kept(self) -> None:
        too_long = "x" * (FIT_LIMIT + 1)
        output, stderr = self.review(["e", "", too_long, "", "r"])
        self.assertIn("Updated 0 pieces", output)
        # The warning names the field and its limit, on stderr.
        self.assertIn("useful_if", stderr)
        self.assertIn(str(FIT_LIMIT), stderr)
        self.assertEqual(self.sample(), "")
