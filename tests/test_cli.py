"""Tests for `lore.cli` — every command an owner can actually type.

Two properties are load-bearing across the whole file: no command in here can
disclose anything (only a publication does that), and a command that fails does
so with an exit code and a message rather than a traceback.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import unittest
from contextlib import contextmanager
from io import StringIO
from pathlib import Path
from typing import Iterator
from unittest.mock import patch

from helpers import LoreTestCase, blueprint_input, captured

from lore import automation, blueprint, cli
from lore.store import PublicationKind, Status, Store


@contextmanager
def desktop_stdin(text: str) -> Iterator[None]:
    """Stand in for Electron main piping a decision with the attended marker set."""
    with (
        patch.dict(os.environ, {"LORE_ATTENDED_SURFACE": "desktop"}),
        patch.object(sys, "stdin", StringIO(text)),
    ):
        yield


class ParserTest(unittest.TestCase):
    def test_every_documented_command_is_reachable(self) -> None:
        root = cli.parser()
        for argv, expected in (
            (["setup", "--yes"], {"command": "setup", "yes": True}),
            (["sync", "--source", "codex"], {"command": "sync", "source": ["codex"]}),
            (["review", "a", "b", "--limit", "3"], {"query": ["a", "b"], "limit": 3}),
            (
                ["review", "--all", "discarded"],
                {"all": "discarded"},
            ),
            (["search", "x", "--json"], {"json": True, "limit": 20}),
            (["profile", "-", "--no-schedule"], {"path": "-", "no_schedule": True}),
            (
                ["capture", "apply", "-"],
                {"command": "capture", "capture_command": "apply", "file": "-"},
            ),
            (["status"], {"command": "status"}),
            (["help"], {"command": "help"}),
            (["price", "1.5"], {"amount": 1.5}),
            (
                ["answer", "on", "p.txt", "0.5"],
                {
                    "command": "answer",
                    "answer_command": "on",
                    "file": "p.txt",
                    "price": 0.5,
                },
            ),
            (["answer", "off"], {"answer_command": "off"}),
            (["serve", "--transport", "http"], {"transport": "http", "port": 8765}),
            (
                ["node", "deploy", "--wallet", "0xabc"],
                {"node_command": "deploy", "wallet": "0xabc"},
            ),
            (
                ["blueprint", "apply", "f.json"],
                {"blueprint_command": "apply", "file": "f.json"},
            ),
            (["blueprint", "show"], {"blueprint_command": "show"}),
            (
                ["publication", "review", "c.json"],
                {"publication_command": "review", "file": "c.json"},
            ),
            (["publication", "list"], {"publication_command": "list"}),
            (
                ["publication", "draft", "-"],
                {"publication_command": "draft", "file": "-"},
            ),
            (["publication", "candidates"], {"publication_command": "candidates"}),
            (["publication", "decide"], {"publication_command": "decide"}),
            (
                ["publication", "revoke", "7"],
                {"publication_command": "revoke", "id": 7},
            ),
            (
                ["publication", "reapprove", "7"],
                {"publication_command": "reapprove", "id": 7},
            ),
            (["push", "--local"], {"command": "push", "local": True}),
        ):
            with self.subTest(argv=argv):
                args = vars(root.parse_args(argv))
                for key, value in expected.items():
                    self.assertEqual(args[key], value)

    def test_unknown_values_are_refused_by_the_parser(self) -> None:
        for argv in (
            ["review", "--status", "external"],
            ["review", "--all", "external"],
            ["serve", "--transport", "grpc"],
            ["sync", "--source", "notion"],
            ["node"],  # `node` alone does nothing; a subcommand is required
            ["answer"],
        ):
            with self.subTest(argv=argv):
                with captured(), patch.object(sys, "stderr", StringIO()):
                    with self.assertRaises(SystemExit):
                        cli.parser().parse_args(argv)


class MainDispatchTest(LoreTestCase):
    def test_every_command_routes_to_its_handler(self) -> None:
        for argv, target, expected_args in (
            (["setup", "--yes"], "setup", (True,)),
            (
                ["sync", "--source", "codex", "--source", "claude"],
                "sync",
                ({"codex", "claude"},),
            ),
            (["sync"], "sync", (None,)),
            (["review", "a", "b"], "review", ("a b", "private", 0, None)),
            (
                ["review", "--status", "private", "--all", "discarded"],
                "review",
                ("", "private", 0, "discarded"),
            ),
            (["search", "a", "--limit", "5"], "search", ("a", None, 5, False)),
            (["profile", "p.json"], "profile", ("p.json", True)),
            (["profile", "p.json", "--no-schedule"], "profile", ("p.json", False)),
            (["capture", "apply", "-"], "capture_apply", ("-",)),
            (["status"], "status", ()),
            (["help"], "manual", ()),
            (["price", "2"], "price", (2.0,)),
            (["price"], "price", (None,)),
            (["answer", "on", "p.txt", "2"], "answer_enable", ("p.txt", 2.0)),
            (["answer", "off"], "answer_disable", ()),
            (["blueprint", "apply", "f.json"], "blueprint_apply", ("f.json",)),
            (["blueprint", "show"], "blueprint_show", ()),
            (["blueprint"], "blueprint_show", ()),
            (["publication", "review", "c.json"], "publication_apply", ("c.json",)),
            (["publication", "list"], "publication_list", ()),
            (["publication"], "publication_list", ()),
            (["publication", "draft", "-"], "publication_draft", ("-",)),
            (["publication", "candidates"], "publication_candidates", ()),
            (["publication", "decide"], "publication_decide", ()),
            (["publication", "revoke", "7"], "publication_revoke", (7,)),
            (["publication", "reapprove", "7"], "publication_reapprove", (7,)),
        ):
            with self.subTest(argv=argv):
                with patch.object(cli, target, return_value=0) as handler:
                    self.assertEqual(cli.main(argv), 0)
                self.assertEqual(handler.call_args.args, expected_args)

    def test_serve_forwards_the_transport_arguments(self) -> None:
        with patch("lore.mcp.main", return_value=0) as serve:
            self.assertEqual(cli.main(["serve", "--port", "9001"]), 0)
        self.assertEqual(
            serve.call_args.args[0],
            ["--transport", "stdio", "--host", "127.0.0.1", "--port", "9001"],
        )
        with patch("lore.mcp.main", return_value=0) as serve:
            cli.main(["serve", "--token", "abc"])
        self.assertIn("--token", serve.call_args.args[0])

    def test_push_forwards_the_worker_directory_and_target(self) -> None:
        with patch.object(cli, "push", return_value=0) as push:
            self.assertEqual(cli.main(["push", "--local"]), 0)
        self.assertTrue(push.call_args.kwargs["local"])
        with patch.object(cli, "push", return_value=0) as push:
            cli.main(["push", "--worker-dir", "lore/node"])
        self.assertEqual(push.call_args.args, ("lore/node",))
        self.assertFalse(push.call_args.kwargs["local"])

    def test_node_deploy_forwards_the_wallet(self) -> None:
        with patch("lore.deploy.deploy", return_value=0) as deploy:
            self.assertEqual(cli.main(["node", "deploy", "--wallet", "0x1"]), 0)
        self.assertEqual(deploy.call_args.args, ("0x1",))

    def test_no_command_falls_back_to_status_when_not_interactive(self) -> None:
        with (
            patch.object(sys.stdin, "isatty", return_value=False),
            captured() as output,
        ):
            self.assertEqual(cli.main([]), 0)
        self.assertIn("Library", output.getvalue())

    def test_no_command_opens_the_dashboard_on_a_terminal(self) -> None:
        with (
            patch.object(sys.stdin, "isatty", return_value=True),
            patch("sys.stdout.isatty", return_value=True),
            patch.object(cli, "dashboard", return_value=0) as dashboard,
        ):
            self.assertEqual(cli.main([]), 0)
        dashboard.assert_called_once()

    def test_an_interrupt_exits_130_rather_than_a_traceback(self) -> None:
        for error in (KeyboardInterrupt, EOFError):
            with self.subTest(error=error.__name__):
                with (
                    patch.object(cli, "status", side_effect=error),
                    captured() as output,
                ):
                    self.assertEqual(cli.main(["status"]), 130)
                self.assertIn("Cancelled", output.getvalue())

    def test_an_expected_failure_exits_1_with_a_message_on_stderr(self) -> None:
        for error in (ValueError("bad price"), OSError("disk gone")):
            with self.subTest(error=error):
                errors = StringIO()
                with (
                    patch.object(cli, "status", side_effect=error),
                    patch.object(sys, "stderr", errors),
                ):
                    self.assertEqual(cli.main(["status"]), 1)
                self.assertIn(f"lore: {error}", errors.getvalue())

    def test_an_unexpected_failure_is_not_swallowed(self) -> None:
        # Only OSError and ValueError are owner-facing conditions; anything else
        # is a bug, and hiding it behind exit 1 would make it unreportable.
        with patch.object(cli, "status", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                cli.main(["status"])


class SetupTest(LoreTestCase):
    def test_setup_imports_then_hands_off_to_the_agent(self) -> None:
        memory = self.codex_home / "memories/MEMORY.md"
        memory.parent.mkdir(parents=True)
        memory.write_text("# Preference\n\nKeep setup short.")

        with captured() as output:
            self.assertEqual(cli.setup(True), 0)

        text = output.getvalue()
        self.assertIn("Imported 1 candidate memories", text)
        self.assertIn("Onboard me to Lore", text)
        # Session transcripts are the thing owners fear most; say so up front.
        self.assertIn("Session transcripts stay untouched", text)
        automation_dir = self.lore_home / "automation"
        self.assertEqual(oct(automation_dir.stat().st_mode)[-3:], "700")
        with Store() as store:
            self.assertEqual(store.setting("sources"), ["codex"])

    def test_setup_asks_before_enabling_each_detected_source(self) -> None:
        (self.codex_home / "memories").mkdir(parents=True)
        (self.codex_home / "memories/MEMORY.md").write_text("# C\n\ncodex lesson")
        (self.claude_home / "projects/demo/memory").mkdir(parents=True)
        (self.claude_home / "projects/demo/memory/m.md").write_text(
            "# D\n\nclaude lesson"
        )

        with (
            patch.object(cli, "confirm", side_effect=[True, False]),
            captured() as output,
        ):
            self.assertEqual(cli.setup(), 0)
        self.assertIn("Imported 1 candidate memories", output.getvalue())
        with Store() as store:
            self.assertEqual(store.setting("sources"), ["codex"])

    def test_a_source_that_is_not_installed_is_reported_not_offered(self) -> None:
        with patch.object(cli, "confirm") as confirm, captured() as output:
            self.assertEqual(cli.setup(), 0)
        confirm.assert_not_called()
        self.assertIn("not found", output.getvalue())
        # Synthesis is not a detected agent; it must not appear in the list.
        self.assertNotIn("Synthesis", output.getvalue())


class SyncTest(LoreTestCase):
    def test_sync_reports_per_source_counts(self) -> None:
        (self.codex_home / "memories").mkdir(parents=True)
        (self.codex_home / "memories/MEMORY.md").write_text("# C\n\ncodex lesson")
        with captured() as output:
            self.assertEqual(cli.sync({"codex"}), 0)
        self.assertIn("codex", output.getvalue())
        self.assertIn("1 added", output.getvalue())

    def test_sync_without_names_uses_the_configured_sources_plus_synthesis(
        self,
    ) -> None:
        # Synthesis output is always re-imported: the owner never opted into a
        # source they did not configure, they opted into their own library.
        with Store() as store:
            store.set_setting("sources", ["codex"])
        with patch("lore.cli.scan", return_value={}) as scan:
            self.assertEqual(cli.sync(), 0)
        self.assertEqual(scan.call_args.args[1], {"codex", "automation"})


class ReviewTest(LoreTestCase):
    def test_review_defaults_to_the_private_library(self) -> None:
        # Nothing is ever 'pending' now, so review's default queue must be the
        # private library or the command is a permanent no-op.
        self.seed_memory("Kept lesson")
        self.seed_memory("Other lesson")
        with patch.object(cli, "ask", return_value="d"), captured():
            self.assertEqual(cli.review(), 0)
        with Store() as store:
            self.assertEqual(store.counts(), {"private": 0, "discarded": 2})

    def test_review_can_bring_a_discarded_memory_back(self) -> None:
        self.seed_memory("Kept lesson", "discarded")
        with patch.object(cli, "ask", return_value="k"), captured():
            self.assertEqual(cli.review("lesson", "discarded", 0), 0)
        with Store() as store:
            self.assertIs(store.search("lesson")[0].status, Status.PRIVATE)

    def test_review_offers_no_way_to_disclose(self) -> None:
        # `p` is accepted as a legacy keystroke but means private, not publish;
        # any unrecognized key simply re-prompts rather than acting.
        self.seed_memory("Kept lesson")
        with (
            patch.object(cli, "ask", side_effect=["x", "publish", "p"]),
            captured() as output,
        ):
            self.assertEqual(cli.review(), 0)
        self.assertNotIn("publish", output.getvalue().lower())
        with Store() as store:
            self.assertEqual(store.counts()["private"], 1)

    def test_skip_leaves_a_memory_alone_and_quit_stops_the_queue(self) -> None:
        self.seed_memory("First lesson")
        self.seed_memory("Second lesson")
        with patch.object(cli, "ask", side_effect=["s", "d"]), captured() as output:
            self.assertEqual(cli.review(), 0)
        self.assertIn("Review complete", output.getvalue())
        with Store() as store:
            self.assertEqual(store.counts(), {"private": 1, "discarded": 1})

        with patch.object(cli, "ask", return_value="q"), captured() as output:
            self.assertEqual(cli.review(), 0)
        self.assertNotIn("Review complete", output.getvalue())
        with Store() as store:
            self.assertEqual(store.counts()["private"], 1)

    def test_an_empty_queue_says_so_instead_of_prompting(self) -> None:
        with patch.object(cli, "ask") as ask, captured() as output:
            self.assertEqual(cli.review(), 0)
        ask.assert_not_called()
        self.assertIn("No private memories to review", output.getvalue())

    def test_a_limit_bounds_the_queue_and_a_negative_one_is_refused(self) -> None:
        for title in ("First lesson", "Second lesson", "Third lesson"):
            self.seed_memory(title)
        with patch.object(cli, "ask", return_value="d"), captured() as output:
            self.assertEqual(cli.review("", "private", 2), 0)
        self.assertIn("of 2", output.getvalue())
        with Store() as store:
            self.assertEqual(store.counts()["discarded"], 2)
        with self.assertRaisesRegex(ValueError, "limit cannot be negative"):
            cli.review("", "private", -1)

    def test_all_status_bulk_discards_a_filtered_set_without_prompting(self) -> None:
        for title in ("First lesson", "Second lesson", "Third lesson"):
            self.seed_memory(title)
        with patch.object(cli, "ask") as ask, captured() as output:
            self.assertEqual(cli.review("", "private", 0, "discarded"), 0)
        ask.assert_not_called()
        self.assertIn("Marked 3 memories as discarded", output.getvalue())
        with Store() as store:
            self.assertEqual(store.counts(), {"private": 0, "discarded": 3})

    def test_all_status_reports_only_rows_actually_changed(self) -> None:
        self.seed_memory("Already discarded", "discarded")
        self.seed_memory("Still private")
        with captured() as output:
            # Filtering on status=discarded means only the first memory matches;
            # marking it discarded again should change nothing.
            self.assertEqual(cli.review("", "discarded", 0, "discarded"), 0)
        self.assertIn("Marked 0 memories as discarded", output.getvalue())

    def test_all_status_on_an_empty_match_says_so_and_marks_nothing(self) -> None:
        with patch.object(cli, "ask") as ask, captured() as output:
            self.assertEqual(cli.review("", "private", 0, "discarded"), 0)
        ask.assert_not_called()
        self.assertIn("No private memories to review", output.getvalue())

    def test_apply_all_remaining_from_inside_the_interactive_loop(self) -> None:
        for title in ("First lesson", "Second lesson", "Third lesson"):
            self.seed_memory(title)
        # Keep the first card individually, then discard everything left.
        with patch.object(cli, "ask", side_effect=["k", "D"]), captured() as output:
            self.assertEqual(cli.review(), 0)
        self.assertIn("Marked 2 memories as discarded", output.getvalue())
        with Store() as store:
            self.assertEqual(store.counts(), {"private": 1, "discarded": 2})

    def test_apply_all_remaining_reports_only_rows_actually_changed(self) -> None:
        self.seed_memory("Only lesson")
        with patch.object(cli, "ask", return_value="K"), captured() as output:
            self.assertEqual(cli.review(), 0)
        # It was already private, so keeping it private "for all remaining"
        # changes nothing — the count must say so, not report the match size.
        self.assertIn("Marked 0 memories as private", output.getvalue())


class SearchTest(LoreTestCase):
    def test_search_prints_cards_or_json_and_says_when_there_is_nothing(self) -> None:
        self.seed_memory("Kept lesson")
        with captured() as output:
            self.assertEqual(cli.search("lesson", None, 20, False), 0)
        self.assertIn("Kept lesson", output.getvalue())

        with captured() as output:
            self.assertEqual(cli.search("lesson", None, 20, True), 0)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload[0]["title"], "Kept lesson")
        self.assertEqual(payload[0]["status"], "private")

        with captured() as output:
            self.assertEqual(cli.search("absent", None, 20, False), 0)
        self.assertIn("No matching memories", output.getvalue())
        with captured() as output:
            cli.search("absent", None, 20, True)
        self.assertEqual(json.loads(output.getvalue()), [])


class StatusTest(LoreTestCase):
    def test_status_counts_private_and_discarded_separately(self) -> None:
        self.seed_memory("Kept lesson")
        self.seed_memory("Dropped lesson", "discarded")
        with captured() as output:
            self.assertEqual(cli.status(), 0)
        text = output.getvalue()
        self.assertIn("1 private", text)
        self.assertIn("1 discarded", text)
        self.assertIn("0 active publications", text)
        self.assertIn("Publication price: not set", text)
        # A discarded memory must never be counted as private.
        self.assertNotIn("2 private", text)

    def test_status_reports_price_publications_and_the_last_deployed_node(self) -> None:
        source = self.seed_memory("Ops lesson")
        with Store() as store:
            store.set_setting("price_usd", 1.0)
            store.set_setting("sources", ["codex"])
            store.set_setting("node_url", "https://lore.example.workers.dev/mcp")
            store.add_publication(
                title="Guide",
                content="text",
                topic="ops",
                provenance=[source],
            )
        with captured() as output:
            cli.status()
        text = output.getvalue()
        self.assertIn("1 active publication (externally usable)", text)
        self.assertIn("Publication price: $1.00", text)
        self.assertIn("Node (last deploy): https://lore.example.workers.dev/mcp", text)
        self.assertIn("● Codex", text)
        self.assertIn("○ Claude Code", text)

    def test_status_keeps_reminding_while_a_revocation_has_not_reached_the_node(
        self,
    ) -> None:
        with Store() as store:
            store.set_setting("revocation_pending", True)
        with captured() as output:
            cli.status()
        text = output.getvalue()
        self.assertIn("NOT reached the deployed node", text)
        self.assertIn("lore push", text)

    def test_status_nudges_when_a_publication_outlived_its_source(self) -> None:
        memory_id = self.seed_memory("Project lesson")
        with Store() as store:
            store.add_publication(
                title="Claim",
                content="x",
                topic="ops",
                provenance=[memory_id],
            )
            store.put(
                source="test",
                origin="native",
                source_path="Project lesson",
                source_key="Project lesson",
                fingerprint="changed",
                title="Project lesson",
                content="a changed body",
            )
        with captured() as output:
            cli.status()
        self.assertIn("derives from a memory", output.getvalue())
        self.assertIn("Re-approve or revoke", output.getvalue())


class PriceTest(LoreTestCase):
    def test_price_shows_and_sets_with_free_as_a_real_answer(self) -> None:
        with captured() as output:
            self.assertEqual(cli.price(None), 0)
        self.assertIn("not set", output.getvalue())

        with captured() as output:
            self.assertEqual(cli.price(1.239), 0)
        self.assertIn("$1.24", output.getvalue())
        with Store() as store:
            self.assertEqual(store.setting("price_usd"), 1.239)

        with captured() as output:
            cli.price(None)
        self.assertIn("$1.24 per publication", output.getvalue())

        with captured() as output:
            self.assertEqual(cli.price(0), 0)
        self.assertIn("Publications are free", output.getvalue())

    def test_prices_that_cannot_be_charged_are_refused(self) -> None:
        for amount in (float("nan"), float("inf"), -1.0):
            with self.subTest(amount=amount):
                with self.assertRaisesRegex(ValueError, "finite, non-negative"):
                    cli.price(amount)

    def test_a_price_change_warns_that_a_deployed_node_still_charges_the_old_one(
        self,
    ) -> None:
        with Store() as store:
            store.set_setting("node_url", "https://lore.example.workers.dev/mcp")
        with captured() as output:
            cli.price(0.50)
        self.assertIn("still charges its old price", output.getvalue())

    def test_a_price_change_says_nothing_about_deploys_when_none_exists(self) -> None:
        with captured() as output:
            cli.price(0.50)
        self.assertNotIn("still charges", output.getvalue())


class AnswerCommandTest(LoreTestCase):
    def proxy_file(
        self, text: str = "Act as Ada's concise, evidence-first proxy."
    ) -> str:
        path = self.lore_home / "proxy.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return str(path)

    def test_enabling_needs_an_attended_terminal(self) -> None:
        with patch.object(cli, "_interactive", return_value=False):
            with self.assertRaisesRegex(ValueError, "attended interactive terminal"):
                cli.answer_enable(self.proxy_file(), 0.5)

    def test_enabling_approves_proxy_price_and_switch_together(self) -> None:
        path = self.proxy_file()
        with (
            patch.object(cli, "_interactive", return_value=True),
            patch.object(cli, "confirm", return_value=False),
            captured() as output,
        ):
            self.assertEqual(cli.answer_enable(path, 0.5), 0)
        self.assertIn("Act as Ada", output.getvalue())
        with Store() as store:
            self.assertIsNone(store.setting("proxy_preamble", None))

        with (
            patch.object(cli, "_interactive", return_value=True),
            patch.object(cli, "confirm", return_value=True),
            captured() as output,
        ):
            self.assertEqual(cli.answer_enable(path, 0.5), 0)
        self.assertIn("enabled at $0.50", output.getvalue())
        with Store() as store:
            settings = store.answer_settings()
        self.assertEqual(
            settings.proxy_preamble, "Act as Ada's concise, evidence-first proxy."
        )
        self.assertEqual(settings.answer_price_usd, 0.5)
        self.assertTrue(settings.answer_enabled)

    def test_invalid_price_or_empty_proxy_is_refused(self) -> None:
        for amount in (0.0, -1.0, float("nan"), float("inf")):
            with self.subTest(amount=amount):
                with (
                    patch.object(cli, "_interactive", return_value=True),
                    self.assertRaisesRegex(ValueError, "positive"),
                ):
                    cli.answer_enable(self.proxy_file(), amount)
        with patch.object(cli, "_interactive", return_value=True):
            with self.assertRaisesRegex(ValueError, "empty"):
                cli.answer_enable(self.proxy_file("   \n"), 0.5)

    def test_the_desktop_app_enables_from_stdin_without_the_terminal_prompt(
        self,
    ) -> None:
        with desktop_stdin("Act as Ada's proxy."), patch.object(cli, "confirm") as ask:
            with captured():
                self.assertEqual(cli.answer_enable("-", 0.5), 0)
        ask.assert_not_called()
        with Store() as store:
            self.assertEqual(
                store.answer_settings().proxy_preamble, "Act as Ada's proxy."
            )

    def test_stdin_enabling_is_refused_off_the_desktop_app(self) -> None:
        with patch.object(sys, "stdin", StringIO("Act as Ada's proxy.")):
            with self.assertRaisesRegex(ValueError, "only from the Lore desktop app"):
                cli.answer_enable("-", 0.5)
        with Store() as store:
            self.assertFalse(store.answer_settings().answer_enabled)

    def test_disabling_needs_nothing_and_reminds_about_push(self) -> None:
        with captured() as output:
            self.assertEqual(cli.answer_disable(), 0)
        self.assertIn("disabled", output.getvalue())
        self.assertIn("lore push", output.getvalue())


class ProfileTest(LoreTestCase):
    def test_a_profile_is_saved_and_scheduled(self) -> None:
        path = self.lore_home / "profile.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"role": "maintainer", "executor": "codex"}))
        with patch.object(automation, "install") as install, captured() as output:
            self.assertEqual(cli.profile(str(path)), 0)
        self.assertIn("Saved profile", output.getvalue())
        self.assertIn("Configured Codex local schedule", output.getvalue())
        install.assert_called_once()
        self.assertEqual(
            json.loads(automation.profile_path().read_text())["role"], "maintainer"
        )

    def test_a_profile_can_be_read_from_stdin(self) -> None:
        payload = StringIO(json.dumps({"role": "maintainer", "executor": "claude"}))
        with (
            patch.object(sys, "stdin", payload),
            patch.object(automation, "install"),
            captured() as output,
        ):
            self.assertEqual(cli.profile("-"), 0)
        self.assertIn("Configured Claude local schedule", output.getvalue())

    def test_no_schedule_saves_without_touching_the_installed_schedule(self) -> None:
        path = self.lore_home / "profile.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"role": "maintainer", "executor": "codex"}))
        with patch.object(automation, "install") as install, captured() as output:
            self.assertEqual(cli.profile(str(path), schedule=False), 0)
        install.assert_not_called()
        self.assertIn("previously installed prompt", output.getvalue())

    def test_a_profile_that_is_not_an_object_is_refused(self) -> None:
        path = self.lore_home / "profile.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(["not", "an", "object"]))
        with self.assertRaisesRegex(ValueError, "valid dictionary"):
            cli.profile(str(path))

    def test_profile_reports_a_failed_schedule_instead_of_a_bare_error(self) -> None:
        path = self.lore_home / "profile.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"role": "maintainer", "executor": "claude"}))

        errors = StringIO()
        with (
            patch.object(
                automation,
                "install",
                side_effect=OSError("Claude CLI is not installed"),
            ),
            patch.object(sys, "stderr", errors),
        ):
            self.assertEqual(cli.profile(str(path)), 1)

        report = errors.getvalue()
        self.assertIn("schedule was not installed", report)
        self.assertIn("Claude CLI is not installed", report)
        self.assertIn("which claude", report)
        # The profile is on disk, so the retry command it points at has something to read.
        self.assertIn(str(automation.profile_path()), report)
        self.assertTrue(automation.profile_path().is_file())

    def test_a_blank_executor_reports_a_retry_command_instead_of_crashing(self) -> None:
        # executor: "" is a valid saved profile (no schedule chosen yet); scheduling
        # it anyway fails Agent("") before automation.install() is ever reached. The
        # widened `except` must still catch it rather than let the construction
        # raise straight past the handler.
        path = self.lore_home / "profile.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"role": "maintainer", "executor": ""}))

        errors = StringIO()
        with patch.object(sys, "stderr", errors):
            self.assertEqual(cli.profile(str(path)), 1)

        report = errors.getvalue()
        self.assertIn("schedule was not installed", report)
        self.assertIn(str(automation.profile_path()), report)

    def test_a_missing_executor_key_reports_a_retry_command_instead_of_crashing(
        self,
    ) -> None:
        # A partial-onboarding profile that never set "executor" comes back from
        # save_profile()'s exclude_unset=True with no "executor" key at all — distinct
        # from the blank-string case above. Bare `data["executor"]` raises KeyError,
        # which the except clause does not catch, escaping past the handler.
        path = self.lore_home / "profile.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"role": "maintainer"}))

        errors = StringIO()
        with patch.object(sys, "stderr", errors):
            self.assertEqual(cli.profile(str(path)), 1)

        report = errors.getvalue()
        self.assertIn("schedule was not installed", report)
        self.assertIn(str(automation.profile_path()), report)


class CaptureCommandTest(LoreTestCase):
    def test_capture_apply_reads_stdin_and_prints_the_outcome(self) -> None:
        payload = StringIO(json.dumps([{"title": "A lesson", "content": "the body"}]))
        with patch.object(sys, "stdin", payload), captured() as output:
            self.assertEqual(cli.capture_apply("-"), 0)
        saved = json.loads(output.getvalue())
        self.assertEqual(saved[0]["status"], "added")
        self.assertEqual(saved[0]["title"], "A lesson")
        with Store() as store:
            self.assertEqual(store.counts()["private"], 1)

    def test_capture_apply_reads_a_file(self) -> None:
        path = self.lore_home / "capture.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps([{"title": "A lesson", "content": "the body"}]))
        with captured() as output:
            self.assertEqual(cli.capture_apply(str(path)), 0)
        self.assertEqual(json.loads(output.getvalue())[0]["status"], "added")

    def test_an_invalid_batch_is_refused_before_anything_is_saved(self) -> None:
        payload = StringIO(json.dumps([{"title": "", "content": "x"}]))
        with patch.object(sys, "stdin", payload):
            with self.assertRaises(ValueError):
                cli.capture_apply("-")
        with Store() as store:
            self.assertEqual(store.counts()["private"], 0)


class BlueprintCommandTest(LoreTestCase):
    def _write(self, data: dict) -> str:
        path = self.lore_home / "blueprint-input.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
        return str(path)

    def test_apply_then_show_renders_the_lore_map(self) -> None:
        with captured() as output:
            self.assertEqual(
                cli.blueprint_apply(
                    self._write(blueprint_input(persona="storyteller"))
                ),
                0,
            )
        self.assertIn("captured", output.getvalue().lower())
        self.assertIn(str(blueprint.lore_map_path()), output.getvalue())

        with captured() as output:
            self.assertEqual(cli.blueprint_show(), 0)
        self.assertIn("Chapters", output.getvalue())

    def test_show_falls_back_to_the_raw_blueprint_then_to_a_nudge(self) -> None:
        with captured() as output:
            self.assertEqual(cli.blueprint_show(), 0)
        self.assertIn("No blueprint yet", output.getvalue())

        blueprint.apply(self._write(blueprint_input()))
        blueprint.lore_map_path().unlink()
        with captured() as output:
            self.assertEqual(cli.blueprint_show(), 0)
        self.assertEqual(json.loads(output.getvalue())["name"], "Ada")


class PublicationApplyTest(LoreTestCase):
    """Approval is the only act that makes anything externally readable, so the
    guards on it are the product's central promise, not input validation."""

    def setUp(self) -> None:
        super().setUp()
        self.memory_id = self.seed_memory("Pricing lesson")

    def candidates(self, *overrides: dict) -> str:
        base = {
            "title": "Pricing claim",
            "content": "a bounded claim about pricing agent APIs",
            "topic": "pricing",
            "teaser": "What this claim tells a buyer about pricing",
            "provenance": [self.memory_id],
        }
        path = self.lore_home / "candidates.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps([base | o for o in (overrides or ({},))]))
        return str(path)

    @staticmethod
    def _attended():
        return patch.object(cli, "_interactive", return_value=True)

    def test_approval_refuses_to_run_unattended(self) -> None:
        # A piped or backgrounded approval is an agent approving on the owner's
        # behalf, which is the one thing that must never be possible.
        with patch.object(cli, "_interactive", return_value=False):
            with self.assertRaisesRegex(ValueError, "attended interactive terminal"):
                cli.publication_apply(self.candidates())
        with Store() as store:
            self.assertEqual(store.list_publications(), [])

    def test_interactive_requires_both_ends_of_the_terminal(self) -> None:
        for stdin, stdout, expected in (
            (True, True, True),
            (True, False, False),
            (False, True, False),
            (False, False, False),
        ):
            with self.subTest(stdin=stdin, stdout=stdout):
                with (
                    patch.object(sys.stdin, "isatty", return_value=stdin),
                    patch("sys.stdout.isatty", return_value=stdout),
                ):
                    self.assertIs(cli._interactive(), expected)

    def test_approve_edit_and_reject(self) -> None:
        path = self.candidates(
            {"title": "First claim"},
            {"title": "Second claim"},
            {"title": "Third claim"},
        )
        # Approve the first; edit then approve the second; reject the third.
        # The edit prompt asks title, teaser, then content in that order.
        answers = ["a", "e", "Edited claim", "", "", "a", "r"]
        with (
            self._attended(),
            patch.object(cli, "ask", side_effect=answers),
            captured() as out,
        ):
            self.assertEqual(cli.publication_apply(path), 0)
        self.assertIn("Approved 2 publications", out.getvalue())
        with Store() as store:
            saved = {p.title: p for p in store.list_publications()}
        self.assertEqual(set(saved), {"First claim", "Edited claim"})
        # An empty answer at the edit prompt keeps the current value.
        self.assertEqual(
            saved["Edited claim"].content, "a bounded claim about pricing agent APIs"
        )

    def test_rejecting_everything_saves_nothing_and_says_so(self) -> None:
        with (
            self._attended(),
            patch.object(cli, "ask", return_value="r"),
            captured() as out,
        ):
            self.assertEqual(cli.publication_apply(self.candidates()), 0)
        self.assertIn("Approved 0 publications", out.getvalue())
        self.assertNotIn("answerable over MCP", out.getvalue())
        with Store() as store:
            self.assertEqual(store.list_publications(), [])

    def test_an_unrecognized_key_rejects_rather_than_approving(self) -> None:
        # The default at the prompt is `r`. A stray keystroke must never be the
        # thing that discloses a publication.
        with self._attended(), patch.object(cli, "ask", return_value="x"), captured():
            self.assertEqual(cli.publication_apply(self.candidates()), 0)
        with Store() as store:
            self.assertEqual(store.list_publications(), [])

    def test_quitting_keeps_what_was_already_approved(self) -> None:
        path = self.candidates({"title": "First claim"}, {"title": "Second claim"})
        with (
            self._attended(),
            patch.object(cli, "ask", side_effect=["a", "q"]),
            captured() as out,
        ):
            self.assertEqual(cli.publication_apply(path), 0)
        self.assertIn("Approved 1 publication", out.getvalue())
        with Store() as store:
            self.assertEqual(
                [p.title for p in store.list_publications()], ["First claim"]
            )

    def test_an_approval_tells_the_owner_it_is_reachable_and_how_to_undo(self) -> None:
        with (
            self._attended(),
            patch.object(cli, "ask", return_value="a"),
            captured() as out,
        ):
            cli.publication_apply(self.candidates())
        text = out.getvalue()
        self.assertIn("answerable over MCP", text)
        self.assertIn("lore publication revoke", text)
        # The topic is externally visible, so approving the card approves it too.
        self.assertIn("topic: pricing", text)

    def test_a_malformed_candidates_file_is_refused(self) -> None:
        for payload, message in (
            ({}, "valid array"),
            ([], "at least 1 item"),
            (["not an object"], "should be an object"),
        ):
            path = self.lore_home / "bad.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload))
            with self.subTest(payload=payload):
                with self._attended():
                    with self.assertRaisesRegex(ValueError, message):
                        cli.publication_apply(str(path))

    def test_a_bad_candidate_is_refused_before_the_owner_sees_it(self) -> None:
        # Validation happens up front, so the owner is never shown a card that
        # cannot be saved, and a bad batch never half-applies.
        for override, message in (
            ({"title": "  "}, "at least 1 character"),
            ({"content": ""}, "at least 1 character"),
            ({"topic": ""}, "at least 1 character"),
            ({"teaser": ""}, "non-empty teaser"),
            ({"provenance": []}, "at least 1 item"),
            ({"provenance": "1"}, "valid array"),
            ({"provenance": [True]}, "valid integer"),
            ({"provenance": [9999]}, "unknown memories"),
            ({"extra": "field"}, "Extra inputs are not permitted"),
            ({"kind": "secret"}, "claim.*content"),
        ):
            with self.subTest(override=override):
                with self._attended(), patch.object(cli, "ask") as ask:
                    with self.assertRaisesRegex(ValueError, message):
                        cli.publication_apply(self.candidates(override))
                ask.assert_not_called()

    def test_a_content_candidate_keeps_its_kind(self) -> None:
        with self._attended(), patch.object(cli, "ask", return_value="a"), captured():
            cli.publication_apply(self.candidates({"kind": "content"}))
        with Store() as store:
            self.assertIs(store.list_publications()[0].kind, PublicationKind.CONTENT)

    def drafted(self, *overrides: dict) -> list[dict]:
        """Stage candidates the way the desktop agent does: a JSON array on stdin."""
        with open(self.candidates(*overrides), encoding="utf-8") as batch:
            with patch.object(sys, "stdin", batch), captured():
                self.assertEqual(cli.publication_draft("-"), 0)
        return json.loads(self.staged_path.read_text(encoding="utf-8"))

    @property
    def staged_path(self) -> Path:
        return self.lore_home / "publish-candidates.json"

    def test_drafting_validates_then_stages_for_approval(self) -> None:
        staged = self.drafted({"title": "First"}, {"title": "Second"})
        self.assertEqual([c["title"] for c in staged], ["First", "Second"])
        with captured() as out:
            self.assertEqual(cli.publication_candidates(), 0)
        self.assertEqual(json.loads(out.getvalue()), staged)
        with self.assertRaisesRegex(ValueError, "unknown memories"):
            cli.publication_draft(self.candidates({"provenance": [9999]}))
        self.assertEqual(json.loads(self.staged_path.read_text()), staged)
        with Store() as store:
            self.assertEqual(store.list_publications(), [])

    def test_nothing_is_staged_until_something_is_drafted(self) -> None:
        with captured() as out:
            self.assertEqual(cli.publication_candidates(), 0)
        self.assertEqual(json.loads(out.getvalue()), [])

    def test_the_desktop_app_approves_exactly_the_card_it_showed(self) -> None:
        first, second = self.drafted({"title": "First"}, {"title": "Second"})
        with desktop_stdin(json.dumps({"candidate": first, "approve": True})):
            with captured() as out:
                self.assertEqual(cli.publication_decide(), 0)
        self.assertEqual(json.loads(out.getvalue()), {"approved": True, "remaining": 1})
        with desktop_stdin(json.dumps({"candidate": second, "approve": False})):
            with captured():
                self.assertEqual(cli.publication_decide(), 0)
        with Store() as store:
            self.assertEqual([p.title for p in store.list_publications()], ["First"])
        self.assertFalse(self.staged_path.exists())

    def test_a_card_that_was_never_drafted_or_was_altered_saves_nothing(self) -> None:
        (first,) = self.drafted()
        for candidate, message in (
            (first | {"content": "a different claim"}, "not drafted"),
            (first | {"extra": 1}, "Extra inputs"),
            ({}, "Field required"),
        ):
            with self.subTest(candidate=candidate):
                with desktop_stdin(
                    json.dumps({"candidate": candidate, "approve": True})
                ):
                    with self.assertRaisesRegex(ValueError, message):
                        cli.publication_decide()
        with Store() as store:
            self.assertEqual(store.list_publications(), [])
        self.assertTrue(self.staged_path.exists())

    def test_stdin_decisions_are_refused_off_the_desktop_app(self) -> None:
        # The marker is what Electron main sets; a TTY or any other pipe with it
        # is not the app, so neither the model's shell nor a script can decide.
        (first,) = self.drafted()
        payload = json.dumps({"candidate": first, "approve": True})
        for marker, tty in ((None, False), ("desktop", True), ("shell", False)):
            stdin = StringIO(payload)
            with self.subTest(marker=marker, tty=tty):
                with (
                    patch.dict(os.environ),
                    patch.object(sys, "stdin", stdin),
                    patch.object(stdin, "isatty", return_value=tty),
                ):
                    os.environ.pop("LORE_ATTENDED_SURFACE", None)
                    if marker:
                        os.environ["LORE_ATTENDED_SURFACE"] = marker
                    with self.assertRaisesRegex(
                        ValueError, "only from the Lore desktop app"
                    ):
                        cli.publication_decide()
        with Store() as store:
            self.assertEqual(store.list_publications(), [])
        self.assertTrue(self.staged_path.exists())


class PublicationCommandTest(LoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.memory_id = self.seed_memory("Pricing lesson")

    def publish(self, title: str = "Pricing claim") -> int:
        with Store() as store:
            return store.add_publication(
                title=title,
                content="a bounded claim",
                topic="pricing",
                provenance=[self.memory_id],
            )

    def test_list_shows_state_and_ids_or_points_at_the_skill(self) -> None:
        with captured() as out:
            self.assertEqual(cli.publication_list(), 0)
        self.assertIn("No publications", out.getvalue())
        self.assertIn("lore-publish", out.getvalue())

        active = self.publish("Active claim")
        revoked = self.publish("Revoked claim")
        with Store() as store:
            store.revoke_publication(revoked)
        with captured() as out:
            cli.publication_list()
        text = out.getvalue()
        for expected in (
            "Active claim",
            "Revoked claim",
            "active",
            "revoked",
            f"id {active}",
            f"id {revoked}",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, text)

    def test_revoke_without_a_deployed_node_stays_local(self) -> None:
        pid = self.publish()
        with patch.object(cli, "push") as push, captured() as out:
            self.assertEqual(cli.publication_revoke(pid), 0)
        push.assert_not_called()
        self.assertIn(f"Revoked publication {pid}", out.getvalue())
        with Store() as store:
            self.assertEqual(store.list_publications(active_only=True), [])
            self.assertFalse(store.setting("revocation_pending", False))

    def test_revoke_pushes_to_the_deployed_node_immediately(self) -> None:
        # "Immediately" is the MON-004 invariant: revoking may not wait for
        # whenever the owner next remembers to push.
        pid = self.publish()
        with Store() as store:
            store.set_setting("node_url", "https://node.example/mcp")
        with patch.object(cli, "push", return_value=0) as push, captured():
            self.assertEqual(cli.publication_revoke(pid), 0)
        push.assert_called_once_with(str(cli.home() / "node"))

    def test_a_failed_revocation_push_is_recorded_never_silently_dropped(self) -> None:
        pid = self.publish()
        with Store() as store:
            store.set_setting("node_url", "https://node.example/mcp")
        with (
            patch.object(cli, "push", side_effect=ValueError("wrangler down")),
            captured(),
            self.assertRaises(ValueError) as raised,
        ):
            cli.publication_revoke(pid)
        self.assertIn("lore push", str(raised.exception))
        with Store() as store:
            # The local revocation still landed...
            self.assertEqual(store.list_publications(active_only=True), [])
            # ...and the unreached edge is recorded, not forgotten.
            self.assertTrue(store.setting("revocation_pending", False))

    def test_reapprove_clears_the_stale_flag_without_changing_the_text(self) -> None:
        pid = self.publish()
        with Store() as store:
            store.put(
                source="test",
                origin="native",
                source_path="Pricing lesson",
                source_key="Pricing lesson",
                fingerprint="changed",
                title="Pricing lesson",
                content="a changed body",
            )
            self.assertEqual([p.id for p in store.stale_publications()], [pid])
        with captured() as out:
            self.assertEqual(cli.publication_reapprove(pid), 0)
        self.assertIn(f"Re-approved publication {pid}", out.getvalue())
        with Store() as store:
            self.assertEqual(store.stale_publications(), [])
            self.assertEqual(store.list_publications()[0].content, "a bounded claim")

    def test_acting_on_an_unknown_id_is_a_clean_error(self) -> None:
        for command in (cli.publication_revoke, cli.publication_reapprove):
            with self.subTest(command=command.__name__):
                with self.assertRaisesRegex(ValueError, "publication not found"):
                    command(404)


class PushTest(LoreTestCase):
    """`lore push` is what makes a local revocation true at the edge."""

    def setUp(self) -> None:
        super().setUp()
        self.memory_id = self.seed_memory("Pricing lesson")
        self.worker = self.lore_home / "node"
        self.worker.mkdir(parents=True)
        (self.worker / "wrangler.jsonc").write_text("{}")

    def publish(self, **overrides: object) -> int:
        with Store() as store:
            return store.add_publication(
                **{
                    "title": "Pricing claim",
                    "content": "a bounded claim",
                    "topic": "pricing",
                    "provenance": [self.memory_id],
                }
                | overrides
            )

    def active(self) -> list:
        with Store() as store:
            return store.list_publications(active_only=True)

    def push_sql(self, publications: list) -> str:
        with Store() as store:
            return cli._push_sql(publications, store.answer_settings())

    def _push(self, returncode: int = 0, **kwargs: object):
        result = subprocess.CompletedProcess(("wrangler",), returncode)
        with patch("subprocess.run", return_value=result) as run, captured() as out:
            code = cli.push(str(self.worker), **kwargs)  # type: ignore[arg-type]
        return code, run, out

    def test_push_replaces_the_whole_set_rather_than_diffing(self) -> None:
        # Full replace is what guarantees a revoked publication is gone: nothing
        # absent from the script survives it. Full replace includes the schema
        # (DROP+CREATE) so a node deployed before the current columns existed
        # converges on the current shape.
        kept = self.publish(title="Kept claim", teaser="an ad")
        gone = self.publish(title="Gone claim")
        with Store() as store:
            store.revoke_publication(gone)
            kept_public_id = next(
                p.public_id for p in store.list_publications() if p.id == kept
            )
        sql = self.push_sql(self.active())
        self.assertIn("DROP TABLE IF EXISTS publications;", sql)
        self.assertIn("CREATE TABLE publications", sql)
        self.assertIn("Kept claim", sql)
        self.assertNotIn("Gone claim", sql)
        self.assertIn(f"'{kept_public_id}'", sql)
        # The local integer id never leaves this machine — the edge is keyed
        # on the opaque public id, so revocations leave no visible gap.
        self.assertNotIn(f"({kept},", sql)

    def test_push_sql_escapes_quotes_rather_than_breaking_the_script(self) -> None:
        # An apostrophe in an owner's own prose would otherwise truncate the
        # statement and publish something they never approved.
        self.publish(
            title="Ada" + chr(39) + "s claim",
            content="it" + chr(39) + "s bounded",
            teaser="What Ada" + chr(39) + "s claim tells a buyer",
        )
        sql = self.push_sql(self.active())
        q = chr(39)
        self.assertIn(f"{q}Ada{q}{q}s claim{q}", sql)
        self.assertIn(f"{q}it{q}{q}s bounded{q}", sql)
        self.assertIn(f"{q}What Ada{q}{q}s claim tells a buyer{q}", sql)
        self.assertNotIn(f"{q}Ada{q}s claim{q}", sql)

    def test_push_sql_is_executable_sqlite_against_a_node_created_before_current_columns(
        self,
    ) -> None:
        self.publish(teaser="an ad")
        sql = self.push_sql(self.active())
        with sqlite3.connect(":memory:") as db:
            db.execute(
                "CREATE TABLE publications (id INTEGER PRIMARY KEY, title TEXT NOT NULL, "
                "content TEXT NOT NULL, kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '')"
            )
            db.executescript(sql)
            row = db.execute(
                "SELECT public_id, title, topic, teaser FROM publications"
            ).fetchone()
        self.assertEqual(
            row, (self.active()[0].public_id, "Pricing claim", "pricing", "an ad")
        )

    def test_an_empty_active_set_is_still_a_valid_push(self) -> None:
        # Revoking everything has to be pushable, or the final revocation can
        # never reach the edge.
        sql = self.push_sql([])
        self.assertIn("DROP TABLE IF EXISTS publications;", sql)
        self.assertNotIn("INSERT INTO publications", sql)

    def test_push_ships_the_answer_settings_alongside_publications(self) -> None:
        with Store() as store:
            store.set_setting(
                "proxy_preamble", "Ada" + chr(39) + "s public proxy charter"
            )
            store.set_setting("answer_price_usd", 0.5)
            store.set_setting("answer_enabled", True)
        sql = self.push_sql([])
        self.assertIn("DROP TABLE IF EXISTS node_settings;", sql)
        self.assertIn("CREATE TABLE node_settings", sql)
        q = chr(39)
        self.assertIn(f"{q}Ada{q}{q}s public proxy charter{q}", sql)
        self.assertIn(f"{q}answer_price_usd{q},{q}0.500000{q}", sql)
        self.assertIn(f"{q}answer_enabled{q},{q}true{q}", sql)

    def test_push_ships_disabled_defaults_so_an_unconfigured_node_stays_off(
        self,
    ) -> None:
        sql = self.push_sql([])
        self.assertIn("'answer_enabled','false'", sql)
        self.assertIn("'answer_price_usd','0.000000'", sql)

    def test_push_refuses_a_hand_enabled_tier_missing_proxy_or_price(self) -> None:
        with Store() as store:
            store.set_setting("answer_enabled", True)
        with self.assertRaises(ValueError):
            self.push_sql([])

    def test_pushing_nothing_reports_it_as_valid_rather_than_an_error(self) -> None:
        # After revoking everything, the owner still has to push, and the node
        # serving nothing is the intended outcome — not a failure to explain.
        code, _, out = self._push()
        self.assertEqual(code, 0)
        self.assertIn("Pushed 0 active publications", out.getvalue())
        self.assertIn("valid state, not an error", out.getvalue())

    def test_push_targets_remote_by_default_and_local_on_request(self) -> None:
        self.publish()
        _, run, out = self._push()
        command = run.call_args.args[0]
        self.assertIn("--remote", command)
        self.assertNotIn("--local", command)
        self.assertEqual(run.call_args.kwargs["cwd"], self.worker)
        self.assertIn("deployed node", out.getvalue())

        _, run, out = self._push(local=True)
        self.assertIn("--local", run.call_args.args[0])
        self.assertIn("local dev database", out.getvalue())

    def test_a_remote_push_clears_a_pending_revocation_but_a_local_one_does_not(
        self,
    ) -> None:
        # A remote push is a full replace, so it discharges the debt; a push
        # to the local dev database proves nothing about the deployed node.
        with Store() as store:
            store.set_setting("revocation_pending", True)
        self._push(local=True)
        with Store() as store:
            self.assertTrue(store.setting("revocation_pending", False))
        self._push()
        with Store() as store:
            self.assertFalse(store.setting("revocation_pending", True))

    def test_the_sql_file_is_cleaned_up_after_a_push(self) -> None:
        self.publish()
        _, run, _ = self._push()
        command = run.call_args.args[0]
        script = command[command.index("--file") + 1]
        self.assertFalse(Path(script).exists())

    def test_pushing_without_a_node_says_how_to_get_one(self) -> None:
        with self.assertRaisesRegex(ValueError, "lore node deploy"):
            cli.push(str(self.lore_home / "absent"))

    def test_a_wrangler_failure_names_the_likely_causes(self) -> None:
        self.publish()
        with self.assertRaisesRegex(ValueError, "wrangler login"):
            self._push(returncode=1)


class ManualTest(unittest.TestCase):
    def test_help_is_a_workflow_manual(self) -> None:
        with captured() as output:
            self.assertEqual(cli.manual(), 0)
        text = output.getvalue()
        for command in ("lore setup", "lore review", "lore price", "lore node deploy"):
            with self.subTest(command=command):
                self.assertIn(command, text)
        # The manual is where an owner learns that reviewing is not publishing.
        self.assertIn("Reviewing never discloses anything", text)


class DashboardTest(LoreTestCase):
    def test_the_dashboard_routes_each_key_and_quits(self) -> None:
        self.seed_memory("Kept lesson")
        answers = ["/", "lesson", "/", "", "r", "s", "x", "q"]
        with (
            patch.object(cli, "ask", side_effect=answers),
            patch.object(cli, "review", return_value=0) as review,
            patch.object(cli, "sync", return_value=0) as sync,
            captured() as output,
        ):
            self.assertEqual(cli.dashboard(), 0)
        text = output.getvalue()
        self.assertIn("Kept lesson", text)  # the search ran and printed a card
        review.assert_called_once_with("", "private", 0)
        sync.assert_called_once_with()
        self.assertIn("[q] quit", text)


if __name__ == "__main__":
    unittest.main()
