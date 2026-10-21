"""Tests for `lore.deploy` — `lore node deploy`, which touches a real account.

Nothing here runs npm or wrangler; the subprocess boundary is faked so the test
can assert on the *sequence* of commands, which is the part that matters. Two
things are pinned hardest: an owner's `.buyer.env` is never touched, and a
failure never leaves `node_url` claiming a node that is not there.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import stat
import subprocess
import sys
import threading
import time
import unittest
from contextlib import contextmanager, redirect_stderr
from io import StringIO
from pathlib import Path
from typing import Iterator
from unittest.mock import patch

from helpers import LoreTestCase, captured

from lore import deploy as deploy_module
from lore.snapshot import Manifest, ManifestEntry
from lore.store import Store

WALLET = "0x" + "1" * 40
DEPLOY_OUTPUT = "Deployed lore-x402-canary\n  https://lore.example.workers.dev\n"


DATABASE_ID = "11111111-2222-3333-4444-555555555555"
SALES = [
    {
        "kind": "publication",
        "item_id": "0000000000000000fcdb4b42",
        "title": "Fixture Publication",
        "price_usd": 0.01,
        "network": "eip155:84532",
        "payer": "0xpayer",
        "tx": "0xtx",
        "sold_at": "2026-09-02T18:00:00.000Z",
    }
]


# What `wrangler d1 execute --json` prints when Cloudflare refuses a request:
# an object, so the last line of the output is a lone brace.
WRANGLER_REFUSAL = {
    "error": {
        "text": "A request to the Cloudflare API (/accounts/3227/d1/database/88f8/query) failed.",
        "notes": [{"text": "Authentication error [code: 10000]"}],
        "kind": "error",
        "name": "APIError",
        "code": 10000,
    }
}


class _Wrangler:
    """A scriptable stand-in for npm and wrangler.

    Defaults are the happy path; each flag flips one step to the failure the
    owner would actually hit. Nothing here reaches the network — the point is to
    assert on the *sequence and order* of commands, which is what the deploy
    actually guarantees.
    """

    def __init__(
        self,
        *,
        deploy_output: str = DEPLOY_OUTPUT,
        logged_in: bool = True,
        login_fails: bool = False,
        has_wallet_secret: bool = True,
        secret_list_fails: bool = False,
        install_fails: bool = False,
        secret_put_fails: bool = False,
        secret_put_fails_for: str | None = None,
        d1_exists: bool = False,
        d1_exists_quietly: bool = False,
        email_unverified: bool = False,
        d1_create_fails: bool = False,
        d1_id_in_output: bool = True,
        d1_execute_refusals: int = 0,
    ) -> None:
        self.deploy_output = deploy_output
        self.logged_in = logged_in
        self.login_fails = login_fails
        self.has_wallet_secret = has_wallet_secret
        self.secret_list_fails = secret_list_fails
        self.install_fails = install_fails
        self.secret_put_fails = secret_put_fails
        self.secret_put_fails_for = secret_put_fails_for
        self.puts: list[tuple[str, object]] = []
        self.d1_exists = d1_exists
        self.d1_exists_quietly = d1_exists_quietly
        self.email_unverified = email_unverified
        self.d1_create_fails = d1_create_fails
        self.d1_id_in_output = d1_id_in_output
        self.d1_execute_refusals = d1_execute_refusals
        self.commands: list[tuple[str, ...]] = []
        self.secret_values: dict[str, str | None] = {}

    def __call__(self, args, **kwargs):  # type: ignore[no-untyped-def]
        self.commands.append(tuple(args))
        code, out, err = 0, "", ""
        tail = tuple(args[1:])
        if args[0] == "npm" and tail[:1] == ("install",):
            code = 1 if self.install_fails else 0
            if not code:
                binary = Path(kwargs["cwd"]) / "node_modules/.bin/wrangler"
                binary.parent.mkdir(parents=True, exist_ok=True)
                binary.write_text("#!/bin/sh\n")
            err = "npm ERR! network" if self.install_fails else ""
        elif tail == ("whoami",):
            out = "logged in as ada" if self.logged_in else "You are not authenticated."
        elif tail[:1] == ("login",):
            code = 1 if self.login_fails else 0
        elif tail == ("secret", "list"):
            if self.secret_list_fails:
                code, err = 1, "Authentication error [code: 10000]"
            else:
                out = '[{"name":"LORE_WALLET"}]' if self.has_wallet_secret else "[]"
        elif tail[:2] == ("secret", "put"):
            failing = self.secret_put_fails or tail[2] == self.secret_put_fails_for
            code = 1 if failing else 0
            err = "vault down" if failing else ""
            self.secret_values[tail[2]] = kwargs.get("input")
            self.puts.append((tail[2], kwargs.get("input")))
        elif tail == ("d1", "create", "lore-publications"):
            if self.d1_exists:
                code, err = 1, "a database with that name already exists"
            elif self.d1_exists_quietly:
                # Some wrangler versions say so and still exit 0.
                out = "A database with that name already exists"
            elif self.d1_create_fails:
                code, err = 1, "authentication error"
            elif self.d1_id_in_output:
                out = f'database_id = "{DATABASE_ID}"\n'
        elif tail == ("d1", "list", "--json"):
            out = json.dumps([{"uuid": DATABASE_ID, "name": "lore-publications"}])
        elif tail == ("deploy",) and self.email_unverified:
            code = 1
            err = "You need to verify your email address to use Workers. [code: 10034]"
        elif tail == ("deploy",):
            out = self.deploy_output
        elif tail[:2] == ("d1", "execute"):
            if self.d1_execute_refusals:
                self.d1_execute_refusals -= 1
                code, out = 1, json.dumps(WRANGLER_REFUSAL, indent=2)
            else:
                out = json.dumps([{"results": SALES, "success": True}])
        return subprocess.CompletedProcess(args, code, stdout=out, stderr=err)

    def named(self, *tail: str) -> list[tuple[str, ...]]:
        return [command for command in self.commands if command[1:] == tail]

    def order(self, *tails: tuple[str, ...]) -> list[int]:
        """Index of the first call matching each tail, for ordering assertions."""
        return [
            next(i for i, c in enumerate(self.commands) if c[1:] == tail)
            for tail in tails
        ]


LIVE = Manifest(manifest_version=1, topics={"pricing": [ManifestEntry(id="a1")]})


class _NodeCase(LoreTestCase):
    """Every deploy ends by asking the node for its manifest; no test reaches the network."""

    def setUp(self) -> None:
        super().setUp()
        probe = patch("lore.snapshot.remote_manifest", return_value=LIVE)
        self.probe = probe.start()
        self.addCleanup(probe.stop)

    @contextmanager
    def refused(self, npm: str | None = "/usr/bin/npm") -> Iterator[None]:
        """For a deploy a guard must stop: any command or push it reaches fails the test."""
        with (
            patch("lore.deploy.shutil.which", return_value=npm),
            patch(
                "lore.deploy.subprocess.run",
                side_effect=AssertionError("a refused deploy ran a command"),
            ),
            patch(
                "lore.cli.push_job",
                side_effect=AssertionError("a refused deploy pushed"),
            ),
        ):
            yield


class SalesTest(LoreTestCase):
    def test_reads_the_ledger_through_the_staged_node(self) -> None:
        target = deploy_module.materialize(0.1)
        binary = target / "node_modules/.bin/wrangler"
        binary.parent.mkdir(parents=True)
        binary.write_text("#!/bin/sh\n")
        (binary.parents[2] / ".installed").write_text("")
        wrangler = _Wrangler()
        with patch("lore.deploy.subprocess.run", side_effect=wrangler):
            # A node deployed before refunds were tracked has no refund_owed column.
            self.assertEqual(
                [sale.model_dump() for sale in deploy_module.sales()],
                [sale | {"refund_owed": False} for sale in SALES],
            )
        self.assertEqual(
            wrangler.commands,
            [
                (
                    str(binary),
                    "d1",
                    "execute",
                    "lore-publications",
                    "--remote",
                    "--json",
                    "--command",
                    deploy_module.SALES_QUERY,
                )
            ],
        )

    def test_a_refund_owed_answer_reads_from_a_current_node(self) -> None:
        row = SALES[0] | {"id": 7, "kind": "answer", "refund_owed": 1}
        self.assertTrue(deploy_module.SALES.validate_python([row])[0].refund_owed)

    def test_no_staged_node_is_a_plain_error(self) -> None:
        with self.assertRaisesRegex(ValueError, "open your store first"):
            deploy_module.sales()

    def test_views_read_the_last_statement_so_an_unvisited_store_has_none(
        self,
    ) -> None:
        self._stage_node()
        answer = subprocess.CompletedProcess(
            ("wrangler",),
            0,
            json.dumps(
                [
                    {"results": []},
                    {"results": [{"item_id": "0000000000000000fcdb4b42", "views": 3}]},
                ]
            ),
            "",
        )
        with patch("lore.deploy.subprocess.run", return_value=answer) as run:
            found = deploy_module.views()
        self.assertEqual(
            [row.model_dump() for row in found],
            [{"item_id": "0000000000000000fcdb4b42", "views": 3}],
        )
        self.assertEqual(run.call_args.args[0][-1], deploy_module.VIEWS_QUERY)

    def _stage_node(self) -> None:
        binary = deploy_module.materialize(0.1) / "node_modules/.bin/wrangler"
        binary.parent.mkdir(parents=True)
        binary.write_text("#!/bin/sh\n")
        (binary.parents[2] / ".installed").write_text("")

    def test_a_refused_first_read_is_retried_once(self) -> None:
        self._stage_node()
        wrangler = _Wrangler(d1_execute_refusals=1)
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.time.sleep") as pause,
        ):
            self.assertEqual(len(deploy_module.sales()), len(SALES))
        self.assertEqual(len(wrangler.commands), 2)
        self.assertEqual(pause.call_count, 1)

    def test_a_refusal_is_reported_in_cloudflares_words_not_a_brace(self) -> None:
        """The desktop shows the last line of stderr; a JSON blob's last line
        is `}` (APP-085). Cloudflare's sentence comes through on one line,
        naming neither the account nor the database."""
        self._stage_node()
        wrangler = _Wrangler(d1_execute_refusals=2)
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.time.sleep"),
            self.assertRaises(OSError) as failure,
        ):
            deploy_module.sales()
        self.assertEqual(
            str(failure.exception),
            "reading sales failed:\nA request to the Cloudflare API failed. "
            "Authentication error [code: 10000]",
        )
        self.assertEqual(len(wrangler.commands), 2)


class UnattendedDeployTest(_NodeCase):
    def test_a_signed_out_agent_shell_stops_instead_of_starting_a_login(self) -> None:
        with Store() as store:
            store.set_setting("price_usd", 0.01)
        wrangler = _Wrangler(logged_in=False)
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch.dict(os.environ, {"LORE_UNATTENDED": "1"}),
            self.assertRaisesRegex(OSError, "sign in first"),
        ):
            deploy_module.deploy(WALLET)
        self.assertEqual(wrangler.named("login"), [])


class RealMoneyTest(_NodeCase):
    def _staged(self) -> _Wrangler:
        target = deploy_module.materialize(0.1)
        binary = target / "node_modules/.bin/wrangler"
        binary.parent.mkdir(parents=True)
        binary.write_text("#!/bin/sh\n")
        (binary.parents[2] / ".installed").write_text("")
        return _Wrangler()

    def test_a_credential_is_vaulted_from_the_value_given(self) -> None:
        wrangler = self._staged()
        with patch("lore.deploy.subprocess.run", side_effect=wrangler), captured():
            self.assertEqual(deploy_module.secret("CDP_API_KEY_ID", "key-id"), 0)
        self.assertEqual(wrangler.secret_values, {"CDP_API_KEY_ID": "key-id\n"})

    def test_only_the_coinbase_credentials_and_a_real_value_are_accepted(self) -> None:
        with self.assertRaisesRegex(ValueError, "keeps only"):
            deploy_module.secret("LORE_WALLET", "0x1")
        with self.assertRaisesRegex(ValueError, "no value"):
            deploy_module.secret("CDP_API_KEY_SECRET", "")

    def test_the_network_is_set_after_the_deploy_in_plain_words(self) -> None:
        with Store() as store:
            store.set_setting("price_usd", 0.01)
        wrangler = _Wrangler()
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli.push_job", return_value=0),
            captured(),
        ):
            self.assertEqual(deploy_module.deploy(None, "real"), 0)
        self.assertEqual(wrangler.secret_values, {"LORE_NETWORK": "eip155:8453\n"})
        deployed, network = wrangler.order(
            ("deploy",), ("secret", "put", "LORE_NETWORK")
        )
        self.assertLess(deployed, network)

    OLD = "0x" + "a" * 40
    NEW = "0x" + "b" * 40

    def _change(self, fails_for: str, recorded: str | None) -> tuple[_Wrangler, str]:
        """Change the payout and network at once, with one of the two puts failing."""
        with Store() as store:
            store.set_setting("price_usd", 0.01)
        store_dir = deploy_module.store_folder()
        store_dir.mkdir(parents=True, exist_ok=True)
        if recorded:
            (store_dir / "payout.json").write_text(
                json.dumps({"address": recorded, "network": "test"})
            )
        before = (store_dir / "payout.json").read_text() if recorded else ""
        wrangler = _Wrangler(secret_put_fails_for=fails_for)
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli.push_job", return_value=0),
            captured() as output,
            redirect_stderr(StringIO()) as err,
            self.assertRaises(OSError),
        ):
            deploy_module.deploy(self.NEW, "real")
        after = (store_dir / "payout.json").read_text() if recorded else ""
        self.assertEqual(after, before, "the record is unchanged")
        return wrangler, output.getvalue() + err.getvalue()

    def test_a_failed_network_change_puts_the_old_payout_back(self) -> None:
        wrangler, _ = self._change("LORE_NETWORK", self.OLD)
        self.assertEqual(
            wrangler.puts,
            [
                ("LORE_WALLET", self.NEW + "\n"),
                ("LORE_NETWORK", "eip155:8453\n"),
                ("LORE_WALLET", self.OLD + "\n"),
            ],
        )

    def test_a_failed_wallet_change_changes_nothing_else(self) -> None:
        wrangler, _ = self._change("LORE_WALLET", self.OLD)
        self.assertEqual(wrangler.puts, [("LORE_WALLET", self.NEW + "\n")])

    def test_a_restore_that_fails_says_where_the_store_now_pays(self) -> None:
        with patch.object(
            deploy_module, "_put_wallet", side_effect=[None, OSError("vault down")]
        ):
            _, said = self._change("LORE_NETWORK", self.OLD)
        self.assertIn(
            f"Your store may be half-updated: it now pays {self.NEW} on its old network.",
            said,
        )
        self.assertNotIn("LORE_", said)

    def test_with_no_earlier_payout_a_failed_change_says_so_plainly(self) -> None:
        wrangler, said = self._change("LORE_NETWORK", None)
        self.assertEqual(
            [name for name, _ in wrangler.puts], ["LORE_WALLET", "LORE_NETWORK"]
        )
        self.assertIn("may be half-updated", said)
        self.assertFalse((deploy_module.store_folder() / "payout.json").exists())

    def test_a_deploy_from_the_agent_shell_pushes_without_the_owner_gate(
        self,
    ) -> None:
        # The desktop agent's shell has no TTY and no attended marker. The
        # deploy is the owner's action, so its push must not go back through
        # the gate, and it is recorded as its own run beside the deploy.
        with Store() as store:
            store.set_setting("price_usd", 0.01)
        wrangler = _Wrangler()
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli._push", return_value=0) as pushed,
            patch("lore.cli._owner_action", side_effect=AssertionError("gated")),
            patch.dict(os.environ, {"LORE_UNATTENDED": "1"}),
            patch.object(sys.stdin, "isatty", return_value=False),
            captured(),
        ):
            self.assertEqual(deploy_module.deploy(WALLET), 0)
        pushed.assert_called_once()
        with Store() as store:
            kinds = sorted(job.kind for job in store.recent_jobs())
        self.assertEqual(kinds, ["deploy", "push"])


class LoginTest(LoreTestCase):
    def _login(self, wrangler: _Wrangler) -> str:
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            captured() as out,
        ):
            self.assertEqual(deploy_module.login(), 0)
        return out.getvalue()

    def test_a_fresh_machine_is_staged_and_installed_before_signing_in(self) -> None:
        wrangler = _Wrangler()
        output = self._login(wrangler)
        self.assertTrue((self.store / "package.json").is_file())
        self.assertEqual(wrangler.commands[:2][0][:2], ("npm", "install"))
        self.assertEqual(wrangler.commands[1][1:], ("login", "--browser=false"))
        self.assertEqual(wrangler.commands[2][1:], ("whoami",))
        self.assertIn("Signed in to Cloudflare", output)

    def test_an_installed_node_signs_in_without_reinstalling(self) -> None:
        target = deploy_module.materialize(0.1)
        binary = target / "node_modules/.bin/wrangler"
        binary.parent.mkdir(parents=True)
        binary.write_text("#!/bin/sh\n")
        (binary.parents[2] / ".installed").write_text("")
        wrangler = _Wrangler()
        self._login(wrangler)
        self.assertEqual(
            [c[1:] for c in wrangler.commands],
            [("login", "--browser=false"), ("whoami",)],
        )

    def test_a_sign_in_that_did_not_land_is_an_error_even_if_wrangler_exited_clean(
        self,
    ) -> None:
        with (
            patch("lore.deploy.subprocess.run", side_effect=_Wrangler(logged_in=False)),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            captured(),
            self.assertRaisesRegex(OSError, "did not complete"),
        ):
            deploy_module.login()


class MaterializeTest(LoreTestCase):
    def test_an_installed_cli_refuses_to_ignore_checkout_edits(self) -> None:
        root = self.lore_home.parent / "checkout"
        checkout = root / "lore/node/src"
        installed = self.lore_home.parent / "installed/node/src"
        checkout.mkdir(parents=True)
        installed.mkdir(parents=True)
        (root / "pyproject.toml").write_text('[project]\nname = "lore-mcp"\n')
        (checkout / "network.ts").write_text("new guard")
        (installed / "network.ts").write_text("stale guard")

        with patch("lore.deploy.Path.cwd", return_value=checkout):
            with self.assertRaisesRegex(OSError, "deploy stopped") as raised:
                deploy_module._refuse_dev_source_drift(installed.parent)

        self.assertIn("uv tool install --force --reinstall .", str(raised.exception))
        self.assertIn("rerun `lore node deploy`", str(raised.exception))

    def test_the_packaged_source_lands_without_dev_artifacts(self) -> None:
        target = deploy_module.materialize(0.37)
        self.assertEqual(target, self.store)
        for shipped in (
            "src/index.ts",
            "scripts/pay.ts",
            "package.json",
        ):
            with self.subTest(file=shipped):
                self.assertTrue((target / shipped).is_file())
        for excluded in ("node_modules", ".wrangler", ".buyer.env", ".dev.vars"):
            with self.subTest(file=excluded):
                self.assertFalse((target / excluded).exists())
        # Secrets live here, so the directory is owner-only like the rest of ~/.lore.
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
        self.assertIn(
            "export const PRICE_USD = 0.37;", (target / "src/price.ts").read_text()
        )

    def test_re_running_upgrades_the_source_and_spares_the_owners_secrets(self) -> None:
        target = deploy_module.materialize(0.37)
        (target / ".buyer.env").write_text("BUYER_TEST_PRIVATE_KEY=untouched")
        (target / "src/index.ts").write_text("// stale build")
        deploy_module.materialize(0.42)
        self.assertEqual(
            (target / ".buyer.env").read_text(), "BUYER_TEST_PRIVATE_KEY=untouched"
        )
        self.assertNotEqual((target / "src/index.ts").read_text(), "// stale build")
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
        self.assertIn(
            "export const PRICE_USD = 0.42;", (target / "src/price.ts").read_text()
        )


class StoreFolderTest(LoreTestCase):
    """The store's code lives outside Lore's home, which the desktop agent can write."""

    MOVED_ID = "11111111-2222-3333-4444-666666666666"

    def _plant(self) -> Path:
        """What an agent could leave in Lore's home: npm settings and an old store."""
        (self.lore_home / "node/node_modules/.bin").mkdir(parents=True)
        (self.lore_home / "package.json").write_text('{"workspaces": ["node"]}')
        (self.lore_home / ".npmrc").write_text("node-options=--require=/planted.js\n")
        planted = self.lore_home / "node/node_modules/.bin/wrangler"
        planted.write_text("#!/bin/sh\n")
        (self.lore_home / "node/wrangler.jsonc").write_text(
            f'{{"database_id": "{self.MOVED_ID}"}}'
        )
        return planted

    def test_the_store_folder_is_not_in_lores_home(self) -> None:
        self.assertFalse(self.store.is_relative_to(self.lore_home))
        with patch.dict(os.environ):
            del os.environ["LORE_STORE"]
            self.assertEqual(
                deploy_module.store_folder(),
                Path("~/Library/Application Support/Lore/store").expanduser(),
            )

    def test_a_store_set_up_in_lores_home_is_rebuilt_in_its_own_folder(self) -> None:
        planted = self._plant()
        wrangler = _Wrangler()

        def install(args: tuple[str, ...], cwd: Path, **_: object) -> object:
            if args[:2] == ("npm", "install"):
                binary = self.store / "node_modules/.bin/wrangler"
                binary.parent.mkdir(parents=True, exist_ok=True)
                binary.write_text("#!/bin/sh\n")
                (binary.parents[2] / ".installed").write_text("")
            return wrangler(args, cwd=cwd)

        with patch("lore.deploy.subprocess.run", side_effect=install):
            deploy_module.sales()
        ran = [command[0] for command in wrangler.commands]
        self.assertNotIn(str(planted), ran)
        self.assertEqual(ran[0], "npm")
        self.assertEqual(ran[1], str(self.store / "node_modules/.bin/wrangler"))
        # Only the database id came across; nothing else from Lore's home.
        config = (self.store / "wrangler.jsonc").read_text()
        self.assertIn(self.MOVED_ID, config)
        self.assertEqual((self.store / ".npmrc-user").read_text(), "")

    def test_a_moved_id_must_look_like_one(self) -> None:
        self._plant()
        (self.lore_home / "node/wrangler.jsonc").write_text('{"database_id": "x"}')
        with self.assertRaisesRegex(ValueError, "open your store first"):
            deploy_module.sales()

    def _installs(self) -> tuple[_Wrangler, list[int], object]:
        """A stand-in npm that takes a moment, counting how many installs ran."""
        wrangler, runs = _Wrangler(), []

        def run(args: tuple[str, ...], **kwargs: object) -> object:
            if args[:2] == ("npm", "install"):
                runs.append(1)
                time.sleep(0.2)
            return wrangler(args, **kwargs)

        return wrangler, runs, run

    def test_an_interrupted_first_build_leaves_nothing_and_the_next_one_finishes(
        self,
    ) -> None:
        self._plant()
        with (
            patch("lore.deploy._replace", side_effect=OSError("interrupted")),
            self.assertRaises(OSError),
        ):
            deploy_module.materialize(0.0)
        self.assertFalse(self.store.exists(), "nothing half-built in its place")
        self.assertEqual(
            [
                path.name
                for path in self.store.parent.iterdir()
                if path.name.startswith(".store")
            ],
            [],
            "nor beside it",
        )
        _, _, run = self._installs()
        with patch("lore.deploy.subprocess.run", side_effect=run):
            deploy_module.tools()
        self.assertIn(self.MOVED_ID, (self.store / "wrangler.jsonc").read_text())

    def test_a_placeholder_config_takes_the_moved_id(self) -> None:
        self._plant()
        self.store.mkdir()
        (self.store / "wrangler.jsonc").write_text(
            f'{{"database_id": "{deploy_module.D1_PLACEHOLDER}"}}'
        )
        _, runs, run = self._installs()
        with patch("lore.deploy.subprocess.run", side_effect=run):
            deploy_module.tools()
        self.assertIn(self.MOVED_ID, (self.store / "wrangler.jsonc").read_text())
        self.assertEqual(len(runs), 1)

    def test_an_unfinished_install_is_finished_from_the_stores_own_id(self) -> None:
        # The old folder is gone; the store's own config still names its database.
        deploy_module.materialize(0.0)
        config = self.store / "wrangler.jsonc"
        config.write_text(
            config.read_text().replace(deploy_module.D1_PLACEHOLDER, self.MOVED_ID)
        )
        binary = self.store / "node_modules/.bin/wrangler"
        binary.parent.mkdir(parents=True)
        binary.write_text("#!/bin/sh\n")
        self.assertFalse(
            deploy_module.installed(self.store), "wrangler alone is not done"
        )
        _, runs, run = self._installs()
        with patch("lore.deploy.subprocess.run", side_effect=run):
            deploy_module.tools()
            deploy_module.tools()
        self.assertEqual(len(runs), 1)
        self.assertTrue(deploy_module.installed(self.store))
        self.assertIn(self.MOVED_ID, config.read_text())

    def test_two_checks_at_once_install_once(self) -> None:
        self._plant()
        _, runs, run = self._installs()
        with patch("lore.deploy.subprocess.run", side_effect=run):
            checks = [threading.Thread(target=deploy_module.tools) for _ in range(2)]
            for check in checks:
                check.start()
            for check in checks:
                check.join()
        self.assertEqual(len(runs), 1)
        self.assertTrue(deploy_module.installed(self.store))

    @unittest.skipIf(shutil.which("npm") is None, "needs npm")
    def test_npm_settings_above_the_store_never_reach_its_install(self) -> None:
        # The worst case: a workspace root above the store with its own npm
        # settings, and an install script of the store's own. Real npm, offline:
        # the store has no dependencies to fetch.
        parent = self.store.parent
        marker = parent / "ran"
        planted = parent / "planted.cjs"
        planted.write_text(f"require('fs').writeFileSync({str(marker)!r}, 'options')")
        (parent / "package.json").write_text('{"workspaces": ["store"]}')
        (parent / ".npmrc").write_text(f"node-options=--require={planted}\n")
        self.store.mkdir()
        (self.store / "package.json").write_text(
            json.dumps(
                {
                    "name": "store",
                    "version": "1.0.0",
                    "scripts": {
                        "postinstall": f"node -e \"require('fs').writeFileSync({str(marker)!r}, 'script')\""
                    },
                }
            )
        )
        offline = {
            "npm_config_offline": "true",
            "npm_config_update_notifier": "false",
            "NO_UPDATE_NOTIFIER": "1",
        }
        # The fixture has no wrangler, so the install is not marked done either.
        # Real npm on purpose, past the hermetic guard: offline, with nothing to
        # fetch, it reaches no network and no account.
        with (
            patch.dict(os.environ, offline),
            patch("lore.deploy.subprocess.run", new=subprocess.run),
            self.assertRaisesRegex(OSError, "without wrangler"),
        ):
            deploy_module.install(self.store)
        self.assertFalse(marker.exists(), marker.read_text() if marker.exists() else "")
        self.assertFalse(deploy_module.installed(self.store))


class DeployTest(_NodeCase):
    def _deploy(
        self,
        wallet: str | None = WALLET,
        *,
        price_usd: float | None = 0.37,
        probe_fails: bool = False,
        inbox_only: bool = False,
        **script: object,
    ) -> tuple[int, _Wrangler]:
        if price_usd is not None:
            with Store() as store:
                store.set_setting("price_usd", price_usd)
        wrangler = _Wrangler(**script)  # type: ignore[arg-type]
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            # `push_job` is `lore.cli`'s, exercised in tests/test_cli.py; here
            # it only needs to be observable and not touch the network.
            patch("lore.cli.push_job") as push,
            captured() as output,
        ):
            # The push creates the publications table, so the node is only
            # asked for its manifest after it; probing first would test a
            # broken node.
            def probed(url: str) -> Manifest:
                self.assertTrue(push.called, "the node was probed before the push")
                if probe_fails:
                    raise OSError("connection refused")
                return LIVE

            self.probe.side_effect = probed
            code = deploy_module.deploy(wallet, inbox_only=inbox_only)
        wrangler.push = push  # type: ignore[attr-defined]
        wrangler.output = output.getvalue()  # type: ignore[attr-defined]
        return code, wrangler

    def _selling(self) -> object:
        with Store() as store:
            return store.setting(deploy_module.SELLING_SETTING, None)

    def test_inbox_only_needs_no_price_and_no_payout_address(self) -> None:
        # XC-069: a new owner's agents save to the store before anything is
        # priced or approved; only the Cloudflare sign-in stands in the way.
        code, wrangler = self._deploy(
            None, price_usd=None, inbox_only=True, has_wallet_secret=False
        )
        self.assertEqual(code, 0)
        self.assertTrue(wrangler.named("deploy"))
        self.assertEqual(wrangler.named("secret", "put", "LORE_WALLET"), [])
        self.assertEqual(wrangler.named("secret", "put", "LORE_NETWORK"), [])
        # The push is what carries the inbox keys and creates the tables.
        wrangler.push.assert_called_once()  # type: ignore[attr-defined]
        self.probe.assert_called_once_with("https://lore.example.workers.dev/mcp")
        with Store() as store:
            self.assertEqual(
                store.setting("node_url"), "https://lore.example.workers.dev/mcp"
            )
            self.assertFalse(deploy_module.selling(store))
        self.assertIs(self._selling(), False)
        self.assertIn("nothing for sale", wrangler.output)  # type: ignore[attr-defined]
        # No price is baked in: the shipped placeholder stays, and nothing is charged.
        self.assertIn(
            deploy_module.PRICE_DECLARATION,
            (self.store / "src/price.ts").read_text(),
        )

    def test_inbox_only_still_walks_a_logged_out_owner_through_sign_in(self) -> None:
        code, wrangler = self._deploy(
            None, price_usd=None, inbox_only=True, logged_in=False
        )
        self.assertEqual(code, 0)
        self.assertTrue(wrangler.named("login"))

    def test_inbox_only_takes_no_payout_address_or_network(self) -> None:
        for wallet, network in ((WALLET, None), (None, "real")):
            with self.subTest(wallet=wallet, network=network):
                with (
                    self.refused(),
                    self.assertRaisesRegex(ValueError, "nothing for sale"),
                ):
                    deploy_module.deploy(wallet, network, inbox_only=True)
        with Store() as store:
            self.assertEqual(store.recent_jobs(limit=5), [])

    def test_a_piece_approved_while_online_for_agents_reaches_the_store_when_it_opens(
        self,
    ) -> None:
        # The real push, not a stand-in: what the edge database is sent.
        from lore import cli

        wrangler = _Wrangler(has_wallet_secret=False)
        sent: list[str] = []

        def run(args, **kwargs):  # type: ignore[no-untyped-def]
            if "--file" in args:
                sent.append(Path(args[args.index("--file") + 1]).read_text())
            return wrangler(args, **kwargs)

        def deploy(wallet: str | None, **options: bool) -> None:
            with (
                patch("lore.deploy.subprocess.run", side_effect=run),
                patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
                captured(),
            ):
                self.assertEqual(deploy_module.deploy(wallet, **options), 0)

        deploy(None, inbox_only=True)
        self.assertIn("('selling','false')", sent[-1])
        memory = self.seed_memory("Price a sync placement by its reach")
        with Store() as store:
            store.add_publication(
                title="Price by reach",
                content="PAID-PIECE-TEXT",
                topic="licensing",
                teaser="How to price a sync placement",
                provenance=[memory],
            )
        pushes = len(sent)
        with patch("lore.deploy.subprocess.run", side_effect=run), captured():
            cli._push_after_approval()
        self.assertEqual(len(sent), pushes, "an approval pushed to a store not selling")
        # A push by hand, and a second inbox-only deploy, still carry no piece.
        with patch("lore.deploy.subprocess.run", side_effect=run), captured():
            cli.push_job(self.store, False)
        deploy(None, inbox_only=True)
        for script in sent[pushes:]:
            self.assertNotIn("PAID-PIECE-TEXT", script)
            self.assertIn("('selling','false')", script)

        with Store() as store:
            store.set_setting("price_usd", 3.0)
        deploy(WALLET)
        self.assertIn("PAID-PIECE-TEXT", sent[-1])
        self.assertIn("('selling','true')", sent[-1])
        self.assertIn("('price_usd','3.000000')", sent[-1])

    def _sent_by(
        self, wrangler: _Wrangler, wallet: str | None, **options: bool
    ) -> list[str]:
        """Deploy through the real push, and return the scripts it sent."""
        sent: list[str] = []

        def run(args, **kwargs):  # type: ignore[no-untyped-def]
            if "--file" in args:
                sent.append(Path(args[args.index("--file") + 1]).read_text())
            return wrangler(args, **kwargs)

        with (
            patch("lore.deploy.subprocess.run", side_effect=run),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            captured(),
        ):
            self.assertEqual(deploy_module.deploy(wallet, **options), 0)
        return sent

    def test_a_new_store_online_for_agents_is_never_told_to_sell_without_an_address(
        self,
    ) -> None:
        # A custom route, or wrangler output that changed: no workers.dev
        # address is printed, yet the push still runs and must not sell.
        memory = self.seed_memory("Price a sync placement by its reach")
        with Store() as store:
            store.add_publication(
                title="Price by reach",
                content="PAID-PIECE-TEXT",
                topic="licensing",
                teaser="How to price a sync placement",
                provenance=[memory],
            )
        sent = self._sent_by(
            _Wrangler(deploy_output="Deployed to a custom route"), None, inbox_only=True
        )
        self.assertIn("('selling','false')", sent[-1])
        self.assertNotIn("PAID-PIECE-TEXT", sent[-1])
        with Store() as store:
            self.assertIsNone(store.setting("node_url", None))
            self.assertIs(store.setting(deploy_module.SELLING_SETTING, None), False)
            self.assertIs(deploy_module.choice(store), False)

    def test_inbox_only_is_recorded_as_online_for_agents_not_live(self) -> None:
        self._deploy(None, price_usd=None, inbox_only=True)
        with Store() as store:
            self.assertEqual(store.recent_jobs(limit=1)[0].summary, "deployed_inbox")
        self._deploy(WALLET)
        with Store() as store:
            self.assertEqual(store.recent_jobs(limit=1)[0].summary, "deployed")
        # Inbox-only on a store already selling leaves it selling: it is live.
        self._deploy(None, inbox_only=True)
        with Store() as store:
            self.assertEqual(store.recent_jobs(limit=1)[0].summary, "deployed")

    def test_inbox_only_on_a_selling_store_keeps_a_price_it_can_charge(self) -> None:
        self._deploy(WALLET)
        for stored, message in (
            (0, "stop here"),
            ("bogus", "at least"),
            (None, "no publication price"),
        ):
            with self.subTest(stored=stored):
                with Store() as store:
                    store.set_setting("price_usd", stored)
                    jobs = len(store.recent_jobs())
                with (
                    self.refused(),
                    self.assertRaisesRegex(ValueError, message),
                ):
                    deploy_module.deploy(None, inbox_only=True)
                with Store() as store:
                    self.assertEqual(len(store.recent_jobs()), jobs)

    def test_inbox_only_never_reads_the_wallet(self) -> None:
        # A failed or empty secret listing must never decide whether a store
        # sells; inbox-only doesn't ask.
        _, wrangler = self._deploy(
            None, price_usd=None, inbox_only=True, secret_list_fails=True
        )
        self.assertEqual(wrangler.named("secret", "list"), [])

    def test_inbox_only_on_a_store_already_selling_keeps_it_selling(self) -> None:
        self._deploy(WALLET)
        self.assertIs(self._selling(), True)
        code, wrangler = self._deploy(
            None, inbox_only=True, has_wallet_secret=False, secret_list_fails=True
        )
        self.assertEqual(code, 0)
        self.assertEqual(wrangler.named("secret", "list"), [])
        self.assertEqual(wrangler.named("secret", "put", "LORE_WALLET"), [])
        self.assertIs(self._selling(), True)
        self.assertIn("Live:", wrangler.output)  # type: ignore[attr-defined]
        self.assertNotIn("nothing for sale", wrangler.output)  # type: ignore[attr-defined]
        # A price the owner already set is still the one baked in.
        self.assertIn(
            "export const PRICE_USD = 0.37;",
            (self.store / "src/price.ts").read_text(),
        )

    def _legacy(self, *, node_url: str | None) -> None:
        """A store from before XC-069 (0.1.15): the staged node holds its real
        database id, and no choice to sell was ever recorded. A failed old
        deploy, a dry run, or a store deployed and long kept selling all look
        like this; none of them is ever guessed at."""
        node = deploy_module.materialize(0.37)
        config = node / "wrangler.jsonc"
        config.write_text(
            config.read_text().replace(deploy_module.D1_PLACEHOLDER, DATABASE_ID)
        )
        memory = self.seed_memory("Price a sync placement by its reach")
        with Store() as store:
            store.set_setting("node_url", node_url)
            store.add_publication(
                title="Price by reach",
                content="PAID-PIECE-TEXT",
                topic="licensing",
                teaser="How to price a sync placement",
                provenance=[memory],
            )

    def test_inbox_only_on_a_store_from_before_the_setting_changes_nothing_about_selling(
        self,
    ) -> None:
        # Codex scenario 1: a real D1 id left by an old deploy that may never
        # have gone live. The database was found, not created, so the store
        # stays as 0.1.15 left it: its push carries the pieces and no key.
        self._legacy(node_url=None)
        sent = self._sent_by(
            _Wrangler(deploy_output="Deployed to a custom route"), None, inbox_only=True
        )
        self.assertIsNone(self._selling())
        self.assertIn("PAID-PIECE-TEXT", sent[-1])
        self.assertNotIn("'selling'", sent[-1])

    def test_inbox_only_that_adopts_an_existing_database_leaves_the_choice_unset(
        self,
    ) -> None:
        # The address is known, the staged config was reset, and the database
        # already exists: adopted, not created, so nothing is decided for the owner.
        with Store() as store:
            store.set_setting("node_url", "https://lore.example.workers.dev/mcp")
            # It sells, so like any deploy of a store that sells it keeps a real price.
            store.set_setting("price_usd", 0.37)
        sent = self._sent_by(_Wrangler(d1_exists=True), None, inbox_only=True)
        self.assertIsNone(self._selling())
        self.assertNotIn("'selling'", sent[-1])

    def test_a_fresh_inbox_only_deploy_creates_its_database_and_sells_nothing(
        self,
    ) -> None:
        memory = self.seed_memory("Price a sync placement by its reach")
        with Store() as store:
            store.add_publication(
                title="Price by reach",
                content="PAID-PIECE-TEXT",
                topic="licensing",
                teaser="How to price a sync placement",
                provenance=[memory],
            )
        sent = self._sent_by(_Wrangler(), None, inbox_only=True)
        self.assertIs(self._selling(), False)
        self.assertIn("('selling','false')", sent[-1])
        self.assertNotIn("PAID-PIECE-TEXT", sent[-1])

    def test_a_failed_choice_write_records_no_database_and_a_retry_stays_safe(
        self,
    ) -> None:
        # Codex round 7: the store's "not selling" is written before the new
        # database's id, so a write SQLite refuses leaves neither; a retry then
        # finds the database already made and is refused or adopts it, never
        # pushing pieces with no choice recorded.
        config = self.store / "wrangler.jsonc"
        for inbox_only in (True, False):
            with self.subTest(inbox_only=inbox_only):
                shutil.rmtree(self.store, ignore_errors=True)
                with Store() as store:
                    store.set_setting(deploy_module.SELLING_SETTING, None)
                    store.set_setting("node_url", None)
                    store.set_setting("price_usd", 0.37)
                wallet = None if inbox_only else WALLET
                with (
                    patch("lore.deploy.subprocess.run", side_effect=_Wrangler()),
                    patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
                    patch.object(
                        Store,
                        "set_setting_if_unset",
                        side_effect=sqlite3.OperationalError("database is locked"),
                    ),
                    patch("lore.cli.push_job") as push,
                    captured(),
                    self.assertRaisesRegex(sqlite3.OperationalError, "locked"),
                ):
                    deploy_module.deploy(wallet, inbox_only=inbox_only)
                push.assert_not_called()
                self.assertIn(deploy_module.D1_PLACEHOLDER, config.read_text())
                self.assertIsNone(self._selling())
                with Store() as store:
                    self.assertIsNone(store.setting("node_url", None))

                # The retry: the database now exists on the account.
                with (
                    patch(
                        "lore.deploy.subprocess.run",
                        side_effect=_Wrangler(d1_exists=True),
                    ),
                    patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
                    patch("lore.cli.push_job") as push,
                    captured(),
                    self.assertRaisesRegex(OSError, "already exists"),
                ):
                    deploy_module.deploy(wallet, inbox_only=inbox_only)
                push.assert_not_called()
                self.assertIsNone(self._selling())
                if inbox_only:
                    # Reconnecting it for agents only is refused outright.
                    with (
                        patch.dict(os.environ, {"LORE_ADOPT_EXISTING_D1": "1"}),
                        self.refused(),
                        self.assertRaisesRegex(ValueError, "run the full store setup"),
                    ):
                        deploy_module.deploy(None, inbox_only=True)
                else:
                    # Adopting it with a full deploy opens it for sale, explicitly.
                    with patch.dict(os.environ, {"LORE_ADOPT_EXISTING_D1": "1"}):
                        sent = self._sent_by(_Wrangler(d1_exists=True), WALLET)
                    self.assertIn("('selling','true')", sent[-1])
                    self.assertIs(self._selling(), True)

    def test_an_explicit_choice_written_during_the_deploy_is_never_overwritten(
        self,
    ) -> None:
        # Codex scenario 3: the owner's yes lands while the database is being
        # created; the deploy's no is guarded and never replaces it.
        wrangler = _Wrangler()

        def run(args, **kwargs):  # type: ignore[no-untyped-def]
            if tuple(args[1:]) == ("d1", "create", deploy_module.D1_NAME):
                with Store() as other:
                    other.set_setting(deploy_module.SELLING_SETTING, True)
            return wrangler(args, **kwargs)

        with (
            patch("lore.deploy.subprocess.run", side_effect=run),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli.push_job"),
            captured(),
        ):
            deploy_module.deploy(None, inbox_only=True)
        self.assertIs(self._selling(), True)

    def test_a_full_deploy_says_selling_only_after_its_push_landed(self) -> None:
        self._deploy(None, price_usd=None, inbox_only=True)
        seen: list[object] = []
        wrangler = _Wrangler()
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch(
                "lore.cli.push_job",
                side_effect=lambda *a, **k: seen.append(self._selling()),
            ),
            captured(),
        ):
            with Store() as store:
                store.set_setting("price_usd", 0.37)
            deploy_module.deploy(WALLET)
        self.assertEqual(seen, [False])
        self.assertIs(self._selling(), True)

    def test_inbox_only_refuses_to_reconnect_a_store_that_sells(self) -> None:
        for chosen in (True, None):
            with self.subTest(chosen=chosen):
                with Store() as store:
                    store.set_setting(deploy_module.SELLING_SETTING, chosen)
                with (
                    patch.dict(os.environ, {"LORE_ADOPT_EXISTING_D1": "1"}),
                    self.refused(),
                    self.assertRaisesRegex(
                        ValueError, "run the full store setup so it keeps selling"
                    ),
                ):
                    deploy_module.deploy(None, inbox_only=True)
        # A store its owner already took off sale can be reconnected for its agents.
        with Store() as store:
            store.set_setting(deploy_module.SELLING_SETTING, False)
        with patch.dict(os.environ, {"LORE_ADOPT_EXISTING_D1": "1"}):
            code, _ = self._deploy(None, price_usd=None, inbox_only=True)
        self.assertEqual(code, 0)
        self.assertIs(self._selling(), False)

    def test_a_failed_push_leaves_the_store_as_it_was(self) -> None:
        # The node never heard it, so the owner's status must not say it sells.
        self._deploy(None, price_usd=None, inbox_only=True)
        self.assertIs(self._selling(), False)
        wrangler = _Wrangler()
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch(
                "lore.cli.push_job",
                side_effect=ValueError("wrangler could not write the edge database"),
            ),
            captured(),
            self.assertRaisesRegex(ValueError, "edge database"),
        ):
            with Store() as store:
                store.set_setting("price_usd", 0.37)
            deploy_module.deploy(WALLET)
        self.assertIs(self._selling(), False)
        with Store() as store:
            self.assertFalse(deploy_module.selling(store))

    def test_a_failed_check_after_a_pushed_deploy_keeps_the_store_selling(self) -> None:
        # The push told the node to sell; only the probe afterwards failed.
        self._deploy(None, price_usd=None, inbox_only=True)
        with self.assertRaisesRegex(OSError, "did not answer discover"):
            self._deploy(WALLET, probe_fails=True)
        self.assertIs(self._selling(), True)

    def test_a_failed_secret_listing_stops_the_deploy_and_changes_nothing(
        self,
    ) -> None:
        with Store() as store:
            store.set_setting("node_url", "https://lore.example.workers.dev/mcp")
            store.set_setting(deploy_module.SELLING_SETTING, False)
        with self.assertRaisesRegex(OSError, "reading your store's settings"):
            self._deploy(None, secret_list_fails=True)
        self.assertIs(self._selling(), False)

    def test_a_new_store_is_not_selling_until_its_secrets_are_in_place(
        self,
    ) -> None:
        # Nothing seeded: a fresh deploy whose payout or network write fails
        # leaves a live address that must not read as a store open for sale.
        failures = {"LORE_WALLET": "payout address", "LORE_NETWORK": "network"}
        for failing, said in failures.items():
            with self.subTest(failing=failing):
                # Each run creates its store's database afresh, as a new owner's does.
                shutil.rmtree(self.store, ignore_errors=True)
                with Store() as store:
                    store.set_setting("node_url", None)
                    store.set_setting(deploy_module.SELLING_SETTING, None)
                    store.set_setting("price_usd", 0.37)
                wrangler = _Wrangler(secret_put_fails=True)
                with (
                    patch("lore.deploy.subprocess.run", side_effect=wrangler),
                    patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
                    patch("lore.cli.push_job") as push,
                    captured(),
                    self.assertRaisesRegex(OSError, said),
                ):
                    deploy_module.deploy(
                        WALLET if failing == "LORE_WALLET" else None,
                        "real" if failing == "LORE_NETWORK" else None,
                    )
                push.assert_not_called()
                with Store() as store:
                    self.assertEqual(
                        store.setting("node_url"),
                        "https://lore.example.workers.dev/mcp",
                    )
                    self.assertIs(
                        store.setting(deploy_module.SELLING_SETTING, None), False
                    )
                    self.assertFalse(deploy_module.selling(store))

    def test_a_store_online_for_agents_opens_for_sale_on_the_usual_deploy(
        self,
    ) -> None:
        self._deploy(None, price_usd=None, inbox_only=True, has_wallet_secret=False)
        self.assertIs(self._selling(), False)
        # The first piece to sell: no price yet, so the usual guard asks for one.
        with (
            self.refused(),
            self.assertRaisesRegex(ValueError, "no publication price is set"),
        ):
            deploy_module.deploy(WALLET)
        # Without --wallet or card payments, a store with no payout address is still refused in seconds.
        with self.assertRaisesRegex(ValueError, "no way to be paid"):
            self._deploy(None, has_wallet_secret=False)
        self.assertIs(self._selling(), False)
        with self.assertRaisesRegex(OSError, "payout address"):
            self._deploy(WALLET, secret_put_fails=True)
        self.assertIs(self._selling(), False)
        code, wrangler = self._deploy(WALLET, has_wallet_secret=False)
        self.assertEqual(code, 0)
        self.assertEqual(wrangler.secret_values["LORE_WALLET"], WALLET + "\n")
        self.assertIs(self._selling(), True)
        self.assertIn("Live:", wrangler.output)  # type: ignore[attr-defined]
        with Store() as store:
            self.assertTrue(deploy_module.selling(store))

    def test_a_deploy_that_sets_the_payout_records_it_beside_the_stores_code(
        self,
    ) -> None:
        self._deploy()
        payout = json.loads((self.store / "payout.json").read_text())
        self.assertEqual(payout, {"address": WALLET, "network": None})
        # A later deploy on a network keeps the address and records the network;
        # nothing that is not an address is ever recorded.
        deploy_module._record_payout(self.store, None, "real")
        deploy_module._record_payout(self.store, "0xnot-an-address", "test")
        payout = json.loads((self.store / "payout.json").read_text())
        self.assertEqual(payout, {"address": WALLET, "network": "real"})
        self.assertFalse(self.store.is_relative_to(self.lore_home))

    def test_a_full_deploy_drives_wrangler_and_records_the_url(self) -> None:
        code, wrangler = self._deploy()
        self.assertEqual(code, 0)
        # From the store's own folder only: no settings from above it, the user or
        # global, and no install scripts.

        self.assertIn(
            (
                "npm",
                "install",
                "--no-fund",
                "--no-audit",
                "--ignore-scripts",
                "--prefix",
                str(self.store),
                "--userconfig",
                str(self.store / ".npmrc-user"),
                "--globalconfig",
                str(self.store / ".npmrc-global"),
            ),
            wrangler.commands,
        )
        self.assertTrue(wrangler.named("deploy"))
        self.assertTrue(wrangler.named("secret", "put", "LORE_WALLET"))
        self.probe.assert_called_once_with("https://lore.example.workers.dev/mcp")
        # Everything runs inside the wrangler the install just put there, never
        # whatever version happens to be on the owner's PATH.
        for command in wrangler.commands:
            if command[0] != "npm":
                with self.subTest(command=command):
                    self.assertTrue(command[0].endswith("node_modules/.bin/wrangler"))
        with Store() as store:
            self.assertEqual(
                store.setting("node_url"), "https://lore.example.workers.dev/mcp"
            )
        self.assertIn(
            "export const PRICE_USD = 0.37;",
            (self.store / "src/price.ts").read_text(),
        )

    def test_a_logged_out_owner_is_walked_through_the_browser_login(self) -> None:
        # Some wrangler versions exit 0 while logged out and only say so in text.
        code, wrangler = self._deploy(logged_in=False)
        self.assertEqual(code, 0)
        self.assertTrue(wrangler.named("login"))

    def test_an_already_authenticated_owner_is_not_sent_to_the_browser(self) -> None:
        _, wrangler = self._deploy()
        self.assertEqual(wrangler.named("login"), [])

    def test_a_failed_login_stops_before_deploying(self) -> None:
        with self.assertRaisesRegex(OSError, "Cloudflare login failed"):
            self._deploy(logged_in=False, login_fails=True)

    def test_without_a_wallet_the_existing_secret_is_checked_not_overwritten(
        self,
    ) -> None:
        code, wrangler = self._deploy(None)
        self.assertEqual(code, 0)
        self.assertTrue(wrangler.named("secret", "list"))
        self.assertEqual(wrangler.named("secret", "put", "LORE_WALLET"), [])

    def test_a_node_with_no_payout_address_fails_in_seconds_not_after_a_deploy(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, "no way to be paid") as refused:
            self._deploy(None, has_wallet_secret=False)
        self.assertIn("lore cards connect", str(refused.exception))

    def test_card_payments_open_a_store_with_no_payout_address(self) -> None:
        # XC-039 cards are enough to sell: the store opens selling by card alone,
        # with no wallet put and no wallet secret asked for.
        with Store() as store:
            store.set_setting("stripe_account", "acct_1Seller")
        code, wrangler = self._deploy(None, has_wallet_secret=False)
        self.assertEqual(code, 0)
        self.assertEqual(wrangler.named("secret", "list"), [])
        self.assertEqual(wrangler.named("secret", "put", "LORE_WALLET"), [])
        self.assertIs(self._selling(), True)
        self.assertFalse((self.store / "payout.json").exists())

    def test_a_card_only_store_records_its_network_and_no_address(self) -> None:
        self.store.mkdir(parents=True, exist_ok=True)
        deploy_module._record_payout(self.store, None, "real")
        payout = json.loads((self.store / "payout.json").read_text())
        self.assertEqual(payout, {"address": None, "network": "real"})
        # An address set later is kept with it.
        deploy_module._record_payout(self.store, WALLET, None)
        payout = json.loads((self.store / "payout.json").read_text())
        self.assertEqual(payout, {"address": WALLET, "network": "real"})

    def test_a_custom_route_deploy_keeps_the_url_already_recorded(self) -> None:
        # A *successful* deploy that prints no workers.dev address means a custom
        # route, not a dead node. Clearing the recorded URL would strand
        # `lore status` on a node that is actually live.
        with Store() as store:
            store.set_setting("node_url", "https://lore.example.workers.dev/mcp")
        code, wrangler = self._deploy(deploy_output="Deployed, no URL here")
        self.assertEqual(code, 0)
        self.probe.assert_not_called()
        with Store() as store:
            self.assertEqual(
                store.setting("node_url"), "https://lore.example.workers.dev/mcp"
            )

    def test_the_url_is_recorded_before_the_payout_secret_is_set(self) -> None:
        # If `secret put` fails the node is already live, so the URL has to be
        # on disk by then or `lore status` cannot recover it.
        with Store() as store:
            store.set_setting("price_usd", 0.01)
        with (
            patch(
                "lore.deploy.subprocess.run",
                side_effect=(w := _Wrangler(secret_put_fails=True)),
            ),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli.push_job"),
            captured(),
            self.assertRaisesRegex(OSError, "set your store.s payout address"),
        ):
            deploy_module.deploy(WALLET)
        deployed, secret = w.order(("deploy",), ("secret", "put", "LORE_WALLET"))
        self.assertLess(deployed, secret)
        with Store() as store:
            self.assertEqual(
                store.setting("node_url"), "https://lore.example.workers.dev/mcp"
            )

    def test_a_colourised_deploy_log_still_yields_a_clean_url(self) -> None:
        # Wrangler colourises under TTY-ish environments, and \S+ would happily
        # swallow the escape sequence into the recorded address.
        code, _ = self._deploy(
            deploy_output="Deployed\n  \x1b[32mhttps://lore.example.workers.dev\x1b[0m\n"
        )
        self.assertEqual(code, 0)
        with Store() as store:
            self.assertEqual(
                store.setting("node_url"), "https://lore.example.workers.dev/mcp"
            )

    def test_a_node_that_does_not_answer_after_deploy_says_where_to_look(
        self,
    ) -> None:
        with self.assertRaisesRegex(OSError, "wrangler tail"):
            self._deploy(probe_fails=True)

    def test_a_failed_install_reports_the_tool_output(self) -> None:
        with self.assertRaisesRegex(OSError, "npm install failed"):
            self._deploy(install_fails=True)

    def test_the_publications_database_is_created_and_pinned_into_the_config(
        self,
    ) -> None:
        # Wrangler validates D1 bindings at deploy time, so the shipped
        # placeholder has to become a real id before `deploy` runs.
        code, wrangler = self._deploy()
        self.assertEqual(code, 0)
        config = (self.store / "wrangler.jsonc").read_text()
        self.assertIn(DATABASE_ID, config)
        self.assertNotIn("REPLACE_WITH_YOUR_D1_ID", config)
        create, deployed = wrangler.order(
            ("d1", "create", "lore-publications"), ("deploy",)
        )
        self.assertLess(create, deployed)

    def test_an_already_created_database_has_its_id_recovered(self) -> None:
        # On a genuine rerun (this installation deployed before — a re-
        # materialize just reset the local config) `d1 create` fails with
        # "already exists"; that is the normal path, not an error, and the id
        # comes from `d1 list` instead.
        with Store() as store:
            store.set_setting("node_url", "https://lore.example.workers.dev/mcp")
        code, wrangler = self._deploy(d1_exists=True)
        self.assertEqual(code, 0)
        self.assertTrue(wrangler.named("d1", "list", "--json"))
        self.assertIn(DATABASE_ID, (self.store / "wrangler.jsonc").read_text())

    def test_a_fresh_installation_refuses_to_adopt_someone_elses_database(
        self,
    ) -> None:
        # Issue #257: a dogfood sandbox signed into the owner's real Cloudflare
        # account found the real node's already-existing database and silently
        # adopted it, then the deploy's own push wiped its publications with
        # the sandbox's empty local set. A fresh installation (no `node_url`
        # recorded here) must refuse rather than repeat that — before ever
        # touching the Worker itself.
        with Store() as store:
            store.set_setting("price_usd", 0.37)
        wrangler = _Wrangler(d1_exists=True)
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli.push_job") as push,
            captured(),
            self.assertRaisesRegex(OSError, "never deployed a node before"),
        ):
            deploy_module.deploy(WALLET)
        push.assert_not_called()
        self.assertFalse(wrangler.named("deploy"))
        with Store() as store:
            self.assertIsNone(store.setting("node_url", None))
        # Refused before the config was ever rewritten with someone else's id.
        self.assertIn(
            "REPLACE_WITH_YOUR_D1_ID",
            (self.store / "wrangler.jsonc").read_text(),
        )

    def test_an_existing_database_is_refused_even_when_wrangler_exits_0(self) -> None:
        # APP-223: a returning owner signed in to the account that already has their store; wrangler said the
        # database exists and exited 0. The deploy refused nothing, and went on with the placeholder id.
        wrangler = _Wrangler(d1_exists_quietly=True)
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli.push_job") as push,
            captured(),
            self.assertRaisesRegex(
                OSError, "already exists on this Cloudflare account"
            ),
        ):
            deploy_module.deploy(None, inbox_only=True)
        push.assert_not_called()
        self.assertFalse(wrangler.named("deploy"))
        self.assertFalse([c for c in wrangler.commands if c[1:3] == ("d1", "execute")])
        self.assertIn(
            "REPLACE_WITH_YOUR_D1_ID",
            (self.store / "wrangler.jsonc").read_text(),
        )

    def test_an_unverified_email_is_said_plainly_and_a_retry_keeps_the_database(
        self,
    ) -> None:
        # APP-223: a brand-new Cloudflare account; the database was made and its id
        # recorded, then Workers refused the deploy until the owner verifies their email.
        with self.assertRaisesRegex(OSError, "verify your email first"):
            self._deploy(None, price_usd=None, inbox_only=True, email_unverified=True)
        config = (self.store / "wrangler.jsonc").read_text()
        self.assertIn(DATABASE_ID, config)
        with Store() as store:
            self.assertIsNone(store.setting("node_url", None))
        # Verified: the retry deploys onto the database this Mac already made.
        code, wrangler = self._deploy(None, price_usd=None, inbox_only=True)
        self.assertEqual(code, 0)
        self.assertFalse(wrangler.named("d1", "create", "lore-publications"))
        self.assertTrue(wrangler.named("deploy"))
        self.assertIn(DATABASE_ID, (self.store / "wrangler.jsonc").read_text())

    def test_an_explicit_override_still_adopts_an_existing_database(self) -> None:
        # A deliberate cross-machine reconnect (a real second machine picking
        # up an already-deployed node) needs an escape hatch from the refusal
        # above; it is opt-in, never automatic.
        with patch.dict(os.environ, {"LORE_ADOPT_EXISTING_D1": "1"}):
            code, wrangler = self._deploy(d1_exists=True)
        self.assertEqual(code, 0)
        self.assertIn(DATABASE_ID, (self.store / "wrangler.jsonc").read_text())

    def test_a_create_that_prints_no_id_falls_back_to_listing(self) -> None:
        # Wrangler has moved between TOML and JSON output; matching the id value
        # rather than the syntax is why this still works, and `d1 list` is the
        # backstop when it prints neither.
        code, wrangler = self._deploy(d1_id_in_output=False)
        self.assertEqual(code, 0)
        self.assertTrue(wrangler.named("d1", "list", "--json"))
        self.assertIn(DATABASE_ID, (self.store / "wrangler.jsonc").read_text())

    def test_a_real_d1_failure_stops_the_deploy(self) -> None:
        with self.assertRaisesRegex(OSError, "creating the D1 database failed"):
            self._deploy(d1_create_fails=True)

    def test_an_unresolvable_database_id_says_what_to_paste_where(self) -> None:
        with Store() as store:
            store.set_setting("price_usd", 0.01)
        wrangler = _Wrangler(d1_exists=True)
        original = wrangler.__call__

        def no_listing(args, **kwargs):
            if tuple(args[1:]) == ("d1", "list", "--json"):
                return subprocess.CompletedProcess(
                    args, 0, stdout="not json", stderr=""
                )
            return original(args, **kwargs)

        with (
            patch("lore.deploy.subprocess.run", side_effect=no_listing),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            patch("lore.cli.push_job"),
            captured(),
            self.assertRaisesRegex(OSError, "wrangler d1 list"),
        ):
            deploy_module.deploy(WALLET)

    def test_an_owner_pasted_database_id_survives_a_re_materialize(self) -> None:
        # Re-running deploy overwrites the shipped config; resetting a resolved
        # id back to the placeholder would recreate the database every upgrade.
        self._deploy()
        config = self.store / "wrangler.jsonc"
        config.write_text(config.read_text().replace(DATABASE_ID, "owner-pasted-id"))
        _, wrangler = self._deploy()
        self.assertIn("owner-pasted-id", config.read_text())
        # Already resolved, so nothing is created a second time.
        self.assertEqual(wrangler.named("d1", "create", "lore-publications"), [])

    def test_the_first_push_runs_before_the_node_is_probed(self) -> None:
        # The order itself is asserted inside _deploy's probe; this pins that
        # both halves happened exactly once.
        code, wrangler = self._deploy()
        self.assertEqual(code, 0)
        wrangler.push.assert_called_once_with(self.store, False, opening=True)
        self.probe.assert_called_once()

    def test_a_malformed_wallet_never_reaches_the_network(self) -> None:
        for wallet in ("0xnothex", "0x" + "1" * 39, "1" * 40, "0x" + "1" * 40 + "1"):
            with self.subTest(wallet=wallet):
                with patch("lore.deploy.subprocess.run") as run:
                    with self.assertRaisesRegex(ValueError, "public EVM address"):
                        deploy_module.deploy(wallet)
                run.assert_not_called()

    def test_a_missing_node_toolchain_is_named_before_anything_else(self) -> None:
        with (
            self.refused(npm=None),
            self.assertRaisesRegex(OSError, "nodejs.org"),
        ):
            deploy_module.deploy(WALLET)

    def test_deploying_with_no_price_set_is_refused(self) -> None:
        with (
            self.refused(),
            self.assertRaisesRegex(ValueError, "no publication price is set"),
        ):
            deploy_module.deploy(WALLET)

    def test_a_free_node_is_told_apart_from_an_unpriced_one(self) -> None:
        # `lore price 0` is a supported final state; the refusal must not tell
        # the owner to set a price they already deliberately set.
        cases = (
            (0, "stop here"),
            (5e-7, "at least"),  # positive but renders as PRICE_USD = 0
            ("bogus", "at least"),  # hand-edited settings, not reachable via CLI
        )
        for stored, message in cases:
            with self.subTest(stored=stored):
                with Store() as store:
                    store.set_setting("price_usd", stored)
                with (
                    self.refused(),
                    self.assertRaisesRegex(ValueError, message),
                ):
                    deploy_module.deploy(WALLET)


class HermeticTest(LoreTestCase):
    """No test can reach a real Cloudflare account, whatever guard regresses."""

    def test_an_unstubbed_command_is_refused_before_it_runs(self) -> None:
        for command in (
            ("npm", "install"),
            ("npx", "wrangler", "whoami"),
            ("wrangler", "deploy"),
        ):
            with self.subTest(command=command):
                with self.assertRaisesRegex(
                    AssertionError, "tests must not run wrangler/npm"
                ):
                    deploy_module._run(command, self.lore_home)

    def test_a_whole_deploy_with_nothing_stubbed_runs_nothing(self) -> None:
        with Store() as store:
            store.set_setting("price_usd", 0.37)
        with (
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            captured(),
            self.assertRaisesRegex(AssertionError, "tests must not run wrangler/npm"),
        ):
            deploy_module.deploy(WALLET)

    def test_a_real_wrangler_could_not_sign_in_or_npm_download(self) -> None:
        self.assertEqual(os.environ["CLOUDFLARE_API_TOKEN"], "invalid-for-tests")
        self.assertEqual(os.environ["npm_config_offline"], "true")
        self.assertEqual(Path(os.environ["npm_config_userconfig"]).read_text(), "")
        home = str(Path.home())
        for name in ("WRANGLER_HOME", "XDG_CONFIG_HOME", "npm_config_cache"):
            with self.subTest(name=name):
                self.assertFalse(os.environ[name].startswith(home), os.environ[name])


class RunTest(_NodeCase):
    def test_failure_detail_keeps_both_streams(self) -> None:
        # A tool that writes its diagnosis to stdout and its error to stderr is
        # normal; reporting only one of them is how a deploy failure gets opaque.
        result = subprocess.CompletedProcess(
            ("x",), 1, stdout="ran out of quota", stderr="ERR 429"
        )
        with patch("lore.deploy.subprocess.run", return_value=result):
            with self.assertRaises(OSError) as raised:
                deploy_module._run(("x",), self.lore_home, fail="it broke")
        message = str(raised.exception)
        self.assertIn("it broke", message)
        self.assertIn("ERR 429", message)
        self.assertIn("ran out of quota", message)

    def test_failure_detail_keeps_the_tail_of_a_long_log(self) -> None:
        # npm can print megabytes; the last lines are the ones that say why.
        result = subprocess.CompletedProcess(
            ("x",), 1, stdout="noise\n" * 2000 + "THE CAUSE", stderr=""
        )
        with patch("lore.deploy.subprocess.run", return_value=result):
            with self.assertRaises(OSError) as raised:
                deploy_module._run(("x",), self.lore_home, fail="it broke")
        message = str(raised.exception)
        self.assertIn("THE CAUSE", message)
        self.assertLess(len(message), 2100)

    def test_failure_detail_is_wranglers_refusal_not_its_help_footer(self) -> None:
        # The desktop shows the last line, which after a refusal is a bug-report link.
        result = subprocess.CompletedProcess(
            ("x",),
            1,
            stdout="",
            stderr="\x1b[31m✘ \x1b[41;31m[\x1b[41;97mERROR\x1b[41;31m]\x1b[0m \x1b[1mUnknown arguments: d1\x1b[0m\n"
            "COMMANDS\n  wrangler d1  Manage D1\n"
            "Please report any issues to https://github.com/cloudflare/workers-sdk/issues/new/choose",
        )
        with patch("lore.deploy.subprocess.run", return_value=result):
            with self.assertRaises(OSError) as raised:
                deploy_module._run(("x",), self.lore_home, fail="reading sales failed")
        self.assertEqual(
            str(raised.exception), "reading sales failed:\nUnknown arguments: d1"
        )

    def test_a_nonzero_exit_is_returned_when_no_failure_message_is_given(self) -> None:
        # `whoami` and `secret list` are probes: their exit code is information,
        # not an error to raise on.
        result = subprocess.CompletedProcess(("x",), 1, stdout="", stderr="")
        with patch("lore.deploy.subprocess.run", return_value=result):
            self.assertEqual(deploy_module._run(("x",), self.lore_home).returncode, 1)

    def test_a_wedged_subprocess_is_killed_and_reported_rather_than_hanging(
        self,
    ) -> None:
        # MON-023: a subprocess that never returns (a wedged `wrangler deploy`,
        # say) must not hang the caller — a bash tool call from the desktop
        # agent, a terminal session — forever.
        error = subprocess.TimeoutExpired(
            ("wrangler", "deploy"), 300, output="deploying...", stderr="stuck"
        )
        with patch("lore.deploy.subprocess.run", side_effect=error):
            with self.assertRaises(OSError) as raised:
                deploy_module._run(
                    ("wrangler", "deploy"), self.lore_home, fail="deploy failed"
                )
        message = str(raised.exception)
        self.assertIn("timed out after 300s", message)
        self.assertIn("stuck", message)
        self.assertIn("deploying...", message)

    def test_every_call_sets_a_timeout_and_closes_stdin_unless_input_is_given(
        self,
    ) -> None:
        # A hung wrangler prompt for interactive input it will never receive
        # (this context has no owner at the terminal) must fail fast, not wait
        # on a stdin nothing will ever write to.
        result = subprocess.CompletedProcess(("x",), 0, stdout="", stderr="")
        with patch("lore.deploy.subprocess.run", return_value=result) as run:
            deploy_module._run(("x",), self.lore_home)
        self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertGreater(run.call_args.kwargs["timeout"], 0)

        with patch("lore.deploy.subprocess.run", return_value=result) as run:
            deploy_module._run(("x",), self.lore_home, input="a-secret\n")
        self.assertIsNone(run.call_args.kwargs["stdin"])
        self.assertEqual(run.call_args.kwargs["input"], "a-secret\n")


class WalletPatternTest(unittest.TestCase):
    def test_the_pattern_accepts_only_a_public_address(self) -> None:
        self.assertTrue(deploy_module.WALLET.fullmatch("0x" + "aF3" * 13 + "b"))
        # A 64-hex private key must never pass as a payout address.
        self.assertIsNone(deploy_module.WALLET.fullmatch("0x" + "1" * 64))


if __name__ == "__main__":
    unittest.main()
