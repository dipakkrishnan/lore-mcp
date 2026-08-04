"""Tests for `lore.deploy` — `lore node deploy`, which touches a real account.

Nothing here runs npm or wrangler; the subprocess boundary is faked so the test
can assert on the *sequence* of commands, which is the part that matters. Two
things are pinned hardest: an owner's `.buyer.env` is never touched, and a
failure never leaves `node_url` claiming a node that is not there.
"""

from __future__ import annotations

import json
import stat
import subprocess
import unittest
from unittest.mock import patch

from helpers import LoreTestCase, captured

from lore import deploy as deploy_module
from lore.store import Store

WALLET = "0x" + "1" * 40
DEPLOY_OUTPUT = "Deployed lore-x402-canary\n  https://lore.example.workers.dev\n"


DATABASE_ID = "11111111-2222-3333-4444-555555555555"


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
        smoke_fails: bool = False,
        install_fails: bool = False,
        secret_put_fails: bool = False,
        d1_exists: bool = False,
        d1_create_fails: bool = False,
        d1_id_in_output: bool = True,
    ) -> None:
        self.deploy_output = deploy_output
        self.logged_in = logged_in
        self.login_fails = login_fails
        self.has_wallet_secret = has_wallet_secret
        self.smoke_fails = smoke_fails
        self.install_fails = install_fails
        self.secret_put_fails = secret_put_fails
        self.d1_exists = d1_exists
        self.d1_create_fails = d1_create_fails
        self.d1_id_in_output = d1_id_in_output
        self.commands: list[tuple[str, ...]] = []

    def __call__(self, args, **kwargs):  # type: ignore[no-untyped-def]
        self.commands.append(tuple(args))
        code, out, err = 0, "", ""
        tail = tuple(args[1:])
        if args[0] == "npm" and tail[:1] == ("install",):
            code = 1 if self.install_fails else 0
            err = "npm ERR! network" if self.install_fails else ""
        elif args[0] == "npm" and tail[:1] == ("run",):
            code = 1 if self.smoke_fails else 0
            err = "402 expected, got 500" if self.smoke_fails else ""
        elif tail == ("whoami",):
            out = "logged in as ada" if self.logged_in else "You are not authenticated."
        elif tail == ("login",):
            code = 1 if self.login_fails else 0
        elif tail == ("secret", "list"):
            out = '[{"name":"LORE_WALLET"}]' if self.has_wallet_secret else "[]"
        elif tail == ("secret", "put", "LORE_WALLET"):
            code = 1 if self.secret_put_fails else 0
            err = "vault down" if self.secret_put_fails else ""
        elif tail == ("d1", "create", "lore-publications"):
            if self.d1_exists:
                code, err = 1, "a database with that name already exists"
            elif self.d1_create_fails:
                code, err = 1, "authentication error"
            elif self.d1_id_in_output:
                out = f'database_id = "{DATABASE_ID}"\n'
        elif tail == ("d1", "list", "--json"):
            out = json.dumps([{"uuid": DATABASE_ID, "name": "lore-publications"}])
        elif tail == ("deploy",):
            out = self.deploy_output
        return subprocess.CompletedProcess(args, code, stdout=out, stderr=err)

    def named(self, *tail: str) -> list[tuple[str, ...]]:
        return [command for command in self.commands if command[1:] == tail]

    def order(self, *tails: tuple[str, ...]) -> list[int]:
        """Index of the first call matching each tail, for ordering assertions."""
        return [
            next(i for i, c in enumerate(self.commands) if c[1:] == tail)
            for tail in tails
        ]


class MaterializeTest(LoreTestCase):
    def test_the_packaged_source_lands_without_dev_artifacts(self) -> None:
        target = deploy_module.materialize(0.37)
        self.assertEqual(target, self.lore_home / "node")
        for shipped in (
            "src/index.ts",
            "scripts/pay.ts",
            ".buyer.env.example",
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


class DeployTest(LoreTestCase):
    def _deploy(
        self, wallet: str | None = WALLET, *, price_usd: float = 0.37, **script: object
    ) -> tuple[int, _Wrangler]:
        with Store() as store:
            store.set_setting("price_usd", price_usd)
        wrangler = _Wrangler(**script)  # type: ignore[arg-type]
        with (
            patch("lore.deploy.subprocess.run", side_effect=wrangler),
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
            # `push` is `lore.cli`'s, exercised in tests/test_cli.py; here it
            # only needs to be observable and not touch the network.
            patch("lore.cli.push") as push,
            captured(),
        ):
            code = deploy_module.deploy(wallet)
        wrangler.push = push  # type: ignore[attr-defined]
        return code, wrangler

    def test_a_full_deploy_drives_wrangler_and_records_the_url(self) -> None:
        code, wrangler = self._deploy()
        self.assertEqual(code, 0)
        self.assertIn(("npm", "install", "--no-fund", "--no-audit"), wrangler.commands)
        self.assertTrue(wrangler.named("deploy"))
        self.assertTrue(wrangler.named("secret", "put", "LORE_WALLET"))
        self.assertIn(
            ("npm", "run", "smoke", "--", "https://lore.example.workers.dev/mcp"),
            wrangler.commands,
        )
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
            (self.lore_home / "node/src/price.ts").read_text(),
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
        with self.assertRaisesRegex(ValueError, "no payout address"):
            self._deploy(None, has_wallet_secret=False)

    def test_a_custom_route_deploy_keeps_the_url_already_recorded(self) -> None:
        # A *successful* deploy that prints no workers.dev address means a custom
        # route, not a dead node. Clearing the recorded URL would strand
        # `lore status` on a node that is actually live.
        with Store() as store:
            store.set_setting("node_url", "https://lore.example.workers.dev/mcp")
        code, wrangler = self._deploy(deploy_output="Deployed, no URL here")
        self.assertEqual(code, 0)
        self.assertEqual(wrangler.named("run", "smoke"), [])
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
            patch("lore.cli.push"),
            captured(),
            self.assertRaisesRegex(OSError, "LORE_WALLET"),
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

    def test_a_failed_smoke_check_says_where_to_look(self) -> None:
        with self.assertRaisesRegex(OSError, "wrangler tail"):
            self._deploy(smoke_fails=True)

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
        config = (self.lore_home / "node/wrangler.jsonc").read_text()
        self.assertIn(DATABASE_ID, config)
        self.assertNotIn("REPLACE_WITH_YOUR_D1_ID", config)
        create, deployed = wrangler.order(
            ("d1", "create", "lore-publications"), ("deploy",)
        )
        self.assertLess(create, deployed)

    def test_an_already_created_database_has_its_id_recovered(self) -> None:
        # On a rerun `d1 create` fails with "already exists"; that is the normal
        # path, not an error, and the id comes from `d1 list` instead.
        code, wrangler = self._deploy(d1_exists=True)
        self.assertEqual(code, 0)
        self.assertTrue(wrangler.named("d1", "list", "--json"))
        self.assertIn(DATABASE_ID, (self.lore_home / "node/wrangler.jsonc").read_text())

    def test_a_create_that_prints_no_id_falls_back_to_listing(self) -> None:
        # Wrangler has moved between TOML and JSON output; matching the id value
        # rather than the syntax is why this still works, and `d1 list` is the
        # backstop when it prints neither.
        code, wrangler = self._deploy(d1_id_in_output=False)
        self.assertEqual(code, 0)
        self.assertTrue(wrangler.named("d1", "list", "--json"))
        self.assertIn(DATABASE_ID, (self.lore_home / "node/wrangler.jsonc").read_text())

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
            patch("lore.cli.push"),
            captured(),
            self.assertRaisesRegex(OSError, "wrangler d1 list"),
        ):
            deploy_module.deploy(WALLET)

    def test_an_owner_pasted_database_id_survives_a_re_materialize(self) -> None:
        # Re-running deploy overwrites the shipped config; resetting a resolved
        # id back to the placeholder would recreate the database every upgrade.
        self._deploy()
        config = self.lore_home / "node/wrangler.jsonc"
        config.write_text(config.read_text().replace(DATABASE_ID, "owner-pasted-id"))
        _, wrangler = self._deploy()
        self.assertIn("owner-pasted-id", config.read_text())
        # Already resolved, so nothing is created a second time.
        self.assertEqual(wrangler.named("d1", "create", "lore-publications"), [])

    def test_the_first_push_runs_before_the_smoke_check(self) -> None:
        # The push creates the publications table, so discover works before the
        # owner has published anything; smoking first would test a broken node.
        code, wrangler = self._deploy()
        self.assertEqual(code, 0)
        wrangler.push.assert_called_once_with(str(self.lore_home / "node"))
        self.assertIn(
            ("npm", "run", "smoke", "--", "https://lore.example.workers.dev/mcp"),
            wrangler.commands,
        )

    def test_a_malformed_wallet_never_reaches_the_network(self) -> None:
        for wallet in ("0xnothex", "0x" + "1" * 39, "1" * 40, "0x" + "1" * 40 + "1"):
            with self.subTest(wallet=wallet):
                with patch("lore.deploy.subprocess.run") as run:
                    with self.assertRaisesRegex(ValueError, "public EVM address"):
                        deploy_module.deploy(wallet)
                run.assert_not_called()

    def test_a_missing_node_toolchain_is_named_before_anything_else(self) -> None:
        with (
            patch("lore.deploy.shutil.which", return_value=None),
            self.assertRaisesRegex(OSError, "nodejs.org"),
        ):
            deploy_module.deploy(WALLET)

    def test_deploying_with_no_price_set_is_refused(self) -> None:
        with (
            patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
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
                    patch("lore.deploy.shutil.which", return_value="/usr/bin/npm"),
                    self.assertRaisesRegex(ValueError, message),
                ):
                    deploy_module.deploy(WALLET)


class RunTest(LoreTestCase):
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

    def test_a_nonzero_exit_is_returned_when_no_failure_message_is_given(self) -> None:
        # `whoami` and `secret list` are probes: their exit code is information,
        # not an error to raise on.
        result = subprocess.CompletedProcess(("x",), 1, stdout="", stderr="")
        with patch("lore.deploy.subprocess.run", return_value=result):
            self.assertEqual(deploy_module._run(("x",), self.lore_home).returncode, 1)


class WalletPatternTest(unittest.TestCase):
    def test_the_pattern_accepts_only_a_public_address(self) -> None:
        self.assertTrue(deploy_module.WALLET.fullmatch("0x" + "aF3" * 13 + "b"))
        # A 64-hex private key must never pass as a payout address.
        self.assertIsNone(deploy_module.WALLET.fullmatch("0x" + "1" * 64))


if __name__ == "__main__":
    unittest.main()
