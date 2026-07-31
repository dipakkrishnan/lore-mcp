"""The payment gate decides whether a buyer is served, never what is servable.

Every test here runs offline against a stubbed facilitator. Nothing contacts
Coinbase, no key is real, and no funds move — which is the point: the one thing that
cannot be automated is a settled transaction on a live network, so everything that
*can* be pinned is pinned here, and the live run is a one-time manual gate.

Two invariants get the most attention, because both fail silently in production:
a challenge that leaks the answer it is charging for, and a price that is set but
uncollectable.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from lore import mcp
from lore.payments import config as payment_config
from lore.payments import credentials, gate
from lore.store import Store

try:  # The payment packages are an optional extra; most of Lore never needs them.
    import x402  # noqa: F401
    from x402.schemas import SettleResponse, SupportedKind, SupportedResponse, VerifyResponse

    PAYMENTS_INSTALLED = True
except ImportError:  # pragma: no cover - exercised only without the extra
    PAYMENTS_INSTALLED = False

needs_payments = unittest.skipUnless(
    PAYMENTS_INSTALLED, "install the payments extra to exercise the gate"
)

PAY_TO = "0x0000000000000000000000000000000000000001"
SECRET = "cdp-secret-that-must-never-be-printed"


class StubFacilitator:
    """Coinbase's facilitator, minus Coinbase.

    Counts verify and settle so tests can assert the gate does not contact either
    before a payment actually arrives.
    """

    def __init__(self) -> None:
        self.verified = 0
        self.settled = 0

    def get_supported(self) -> "SupportedResponse":
        return SupportedResponse(
            kinds=[SupportedKind(x402_version=2, scheme="exact", network=payment_config.BASE_SEPOLIA)]
        )

    def verify(self, *_: object) -> "VerifyResponse":
        self.verified += 1
        return VerifyResponse(is_valid=True, payer="0xbuyer")

    def settle(self, *_: object) -> "SettleResponse":
        self.settled += 1
        return SettleResponse(
            success=True,
            payer="0xbuyer",
            transaction="0xtestnet",
            network=payment_config.BASE_SEPOLIA,
        )


def paid_config(**overrides: str) -> payment_config.PaymentConfig:
    """A configuration complete enough to build a gate from."""
    values = {
        "x402_pay_to": PAY_TO,
        "x402_network": payment_config.BASE_SEPOLIA,
        "cdp_api_key_id": "test-key-id",
        "cdp_api_key_secret": SECRET,
    }
    values.update(overrides)
    return payment_config.PaymentConfig(**values)


class PaymentTestCase(unittest.TestCase):
    """Isolate LORE_HOME and the payment environment for every test."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        os.environ["LORE_HOME"] = str(Path(self.tmp.name) / "lore")
        for name in (
            "LORE_X402_PAY_TO",
            "LORE_X402_NETWORK",
            "CDP_API_KEY_ID",
            "CDP_API_KEY_SECRET",
            "LORE_TEST_BUYER_KEY",
        ):
            os.environ.pop(name, None)

    def publish(self, title: str, content: str) -> None:
        with Store() as store:
            store.add_publication(title=title, content=content)

    def set_price(self, amount: float) -> None:
        with Store() as store:
            store.set_setting("price_usd", amount)

    def build_gate(self, price: float, handler, facilitator: StubFacilitator | None = None):
        """Build a real gate whose only stand-in is the facilitator."""
        facilitator = facilitator or StubFacilitator()
        with patch(
            "lore.payments.coinbase.HTTPFacilitatorClientSync", return_value=facilitator
        ):
            return gate(price, handler, paid_config()), facilitator


class ConfigurationTest(PaymentTestCase):
    def test_settings_supply_what_the_environment_does_not(self) -> None:
        """The skill persists settings; if they do not resolve, the skill does nothing."""
        with Store() as store:
            store.set_setting(payment_config.PAY_TO_SETTING, PAY_TO)
            store.set_setting(payment_config.NETWORK_SETTING, payment_config.BASE_MAINNET)
            resolved = payment_config.resolve(store)
        self.assertEqual(resolved.x402_pay_to, PAY_TO)
        self.assertEqual(resolved.x402_network, payment_config.BASE_MAINNET)

    def test_the_environment_wins_over_stored_settings(self) -> None:
        """A deployed node has no settings to read, so the environment must override."""
        other = "0x00000000000000000000000000000000000000ff"
        with Store() as store:
            store.set_setting(payment_config.PAY_TO_SETTING, PAY_TO)
            store.set_setting(payment_config.NETWORK_SETTING, payment_config.BASE_SEPOLIA)
            os.environ["LORE_X402_PAY_TO"] = other
            os.environ["LORE_X402_NETWORK"] = payment_config.BASE_MAINNET
            resolved = payment_config.resolve(store)
        self.assertEqual(resolved.x402_pay_to, other)
        self.assertEqual(resolved.x402_network, payment_config.BASE_MAINNET)

    def test_credentials_resolve_from_the_file_and_defer_to_the_environment(self) -> None:
        credentials.save(cdp_api_key_id="from-file", cdp_api_key_secret="file-secret")
        with Store() as store:
            self.assertEqual(payment_config.resolve(store).cdp_api_key_id, "from-file")
            os.environ["CDP_API_KEY_ID"] = "from-env"
            self.assertEqual(payment_config.resolve(store).cdp_api_key_id, "from-env")

    def test_the_default_network_is_the_test_network(self) -> None:
        """Testnet-first is not advice; nothing configures mainnet by omission."""
        with Store() as store:
            self.assertEqual(payment_config.resolve(store).x402_network, payment_config.BASE_SEPOLIA)
        self.assertFalse(payment_config.PaymentConfig().is_mainnet)

    def test_an_address_is_rejected_up_front_not_at_the_first_buyer(self) -> None:
        for bad in ("", "0xnope", "1234567890abcdef1234567890abcdef12345678", PAY_TO + "aa"):
            with self.subTest(address=bad), self.assertRaises(ValueError):
                payment_config.normalize_pay_to(bad)
        self.assertEqual(payment_config.normalize_pay_to(f"  {PAY_TO} "), PAY_TO)

    def test_only_base_and_base_sepolia_are_accepted(self) -> None:
        self.assertEqual(payment_config.normalize_network("base"), payment_config.BASE_MAINNET)
        self.assertEqual(
            payment_config.normalize_network("base-sepolia"), payment_config.BASE_SEPOLIA
        )
        with self.assertRaisesRegex(ValueError, "unsupported payment network"):
            payment_config.normalize_network("eip155:1")

    def test_missing_configuration_is_named_in_owner_facing_terms(self) -> None:
        """`LORE_X402_PAY_TO is required` tells an owner nothing about what to do."""
        blank = payment_config.PaymentConfig()
        self.assertIn("lore-enable-payments", blank.missing() or "")

        no_credentials = paid_config(cdp_api_key_id="", cdp_api_key_secret="")
        self.assertIn("lore payment auth", no_credentials.missing() or "")

        self.assertIsNone(paid_config().missing())

    def test_no_error_message_ever_contains_the_secret(self) -> None:
        """An error is the likeliest place for a secret to escape into a transcript."""
        for broken in (
            paid_config(x402_pay_to=""),
            paid_config(x402_pay_to="0xnope"),
            paid_config(cdp_api_key_id=""),
            paid_config(x402_network="eip155:1"),
        ):
            with self.subTest(config=broken.missing()):
                self.assertNotIn(SECRET, broken.missing() or "")


class FreePathTest(PaymentTestCase):
    def test_a_free_price_builds_no_gate_at_all(self) -> None:
        self.assertIsNone(gate(0, lambda _: {}))
        self.assertIsNone(gate(None, lambda _: {}))

    def test_a_nonsense_price_is_refused_rather_than_treated_as_free(self) -> None:
        for bad in ("1.00", True, float("nan"), float("inf")):
            with self.subTest(price=bad), self.assertRaisesRegex(ValueError, "must be a number"):
                gate(bad, lambda _: {})
        with self.assertRaisesRegex(ValueError, "must not be negative"):
            gate(-1, lambda _: {})

    def test_a_free_node_never_imports_the_payment_packages(self) -> None:
        """The extra is optional. If serving free needs it, it is not optional."""
        program = (
            "import sys\n"
            "from lore import cli, mcp\n"
            "assert mcp.answer_gate() is None\n"
            "print(json.dumps([m in sys.modules for m in ('x402', 'cdp', 'web3')]))\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", "import json\n" + program],
            capture_output=True,
            text=True,
            env={**os.environ, "LORE_HOME": os.environ["LORE_HOME"]},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [False, False, False])

    def test_a_free_node_answers_without_a_gate(self) -> None:
        self.publish("Deployment", "Ship on Fridays only when the rollback is tested.")
        result = mcp.call_tool("answer", {"query": "deployment"})
        self.assertIn("rollback", result["content"][0]["text"])


@needs_payments
class GateTest(PaymentTestCase):
    def test_an_unpaid_call_is_challenged_and_the_handler_never_runs(self) -> None:
        executed: list[dict] = []
        answer_gate, facilitator = self.build_gate(0.01, executed.append)

        challenge = answer_gate({"query": "deployment"}, {})

        self.assertTrue(challenge["isError"])
        self.assertEqual(challenge["structuredContent"]["x402Version"], 2)
        self.assertEqual(executed, [], "the answer was produced before payment")
        self.assertEqual(
            (facilitator.verified, facilitator.settled),
            (0, 0),
            "the facilitator was contacted before a payment arrived",
        )

    def test_the_challenge_quotes_the_price_and_the_payout_address(self) -> None:
        answer_gate, _ = self.build_gate(0.25, lambda _: {})
        accepted = answer_gate({"query": "x"}, {})["structuredContent"]["accepts"][0]
        self.assertEqual(accepted["payTo"], PAY_TO)
        self.assertEqual(accepted["network"], payment_config.BASE_SEPOLIA)

    def test_the_challenge_discloses_no_publication_content(self) -> None:
        """A gate that leaks the answer in its own challenge is worse than no gate."""
        secret_title = "Zorbulax migration retrospective"
        secret_body = "We rolled back at 3am after the quorum flapped."
        self.publish(secret_title, secret_body)

        answer_gate, _ = self.build_gate(
            0.01, lambda arguments: mcp.call_tool("answer", arguments)
        )
        challenge = answer_gate({"query": "zorbulax"}, {})

        rendered = json.dumps(challenge, default=str).casefold()
        for leaked in ("zorbulax", "quorum", "3am", secret_body.casefold()):
            with self.subTest(term=leaked):
                self.assertNotIn(leaked.casefold(), rendered)

    def test_a_paid_retry_returns_the_answer_and_a_settlement_receipt(self) -> None:
        executed: list[dict] = []
        answer_gate, facilitator = self.build_gate(
            0.01,
            lambda arguments: executed.append(arguments)
            or {"content": [{"type": "text", "text": "approved answer"}]},
        )

        challenge = answer_gate({"query": "deployment"}, {})
        accepted = challenge["structuredContent"]["accepts"][0]
        result = answer_gate(
            {"query": "deployment"},
            {
                "x402/payment": {
                    "x402Version": 2,
                    "accepted": accepted,
                    "payload": {"signature": "0xtest"},
                }
            },
        )

        self.assertFalse(result["isError"])
        self.assertEqual(result["content"][0]["text"], "approved answer")
        self.assertEqual(result["_meta"]["x402/payment-response"]["transaction"], "0xtestnet")
        self.assertEqual(executed, [{"query": "deployment"}])
        self.assertEqual((facilitator.verified, facilitator.settled), (1, 1))

    def test_settlement_precedes_the_answer_and_the_window_is_one_call(self) -> None:
        """The MVP accepts a paid-for-nothing window; pin how wide it actually is."""
        order: list[str] = []
        facilitator = StubFacilitator()

        def handler(_: dict) -> dict:
            order.append("answer")
            return {"content": [{"type": "text", "text": "ok"}]}

        original = facilitator.settle

        def settle(*args: object):
            order.append("settle")
            return original(*args)

        facilitator.settle = settle  # type: ignore[method-assign]
        answer_gate, _ = self.build_gate(0.01, handler, facilitator)
        accepted = answer_gate({"query": "q"}, {})["structuredContent"]["accepts"][0]
        answer_gate(
            {"query": "q"},
            {"x402/payment": {"x402Version": 2, "accepted": accepted, "payload": {}}},
        )
        self.assertEqual(order, ["answer", "settle"])


@needs_payments
class DispatchTest(PaymentTestCase):
    def test_discover_stays_free_on_a_paid_node(self) -> None:
        """A buyer must be able to learn whether this node is worth paying."""
        self.publish("Deployment", "Ship on Fridays only when the rollback is tested.")
        calls: list[object] = []

        def never(arguments: dict, meta: object) -> dict:
            calls.append(arguments)
            return {"content": [], "isError": True}

        response = mcp.dispatch(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "discover", "arguments": {"query": "deployment"}},
            },
            never,
        )
        payload = json.loads(response["result"]["content"][0]["text"])
        self.assertTrue(payload["can_help"])
        self.assertEqual(calls, [], "discover was routed through the payment gate")

    def test_a_malformed_paid_request_is_refused_before_it_is_charged(self) -> None:
        """Charging for a request that can only fail is charging for nothing."""
        calls: list[object] = []
        response = mcp.dispatch(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "answer", "arguments": {"query": "x", "bogus": 1}},
            },
            lambda arguments, meta: calls.append(arguments) or {},
        )
        self.assertIn("unexpected argument", response["error"]["message"])
        self.assertEqual(calls, [])

    def test_stdio_is_never_gated(self) -> None:
        """stdio is the owner's own agent; billing it bills them for their own lore."""
        self.publish("Deployment", "Ship on Fridays only when the rollback is tested.")
        self.set_price(5.0)
        response = mcp.dispatch(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "answer", "arguments": {"query": "deployment"}},
            }
        )
        self.assertIn("rollback", response["result"]["content"][0]["text"])

    def test_payment_never_widens_what_is_disclosable(self) -> None:
        """A paid answer and a free answer read the same publications, byte for byte."""
        self.publish("Deployment", "Ship on Fridays only when the rollback is tested.")
        free = mcp.call_tool("answer", {"query": "deployment"})

        answer_gate, _ = self.build_gate(
            0.01, lambda arguments: mcp.call_tool("answer", arguments)
        )
        accepted = answer_gate({"query": "deployment"}, {})["structuredContent"]["accepts"][0]
        paid = answer_gate(
            {"query": "deployment"},
            {"x402/payment": {"x402Version": 2, "accepted": accepted, "payload": {}}},
        )
        self.assertEqual(paid["content"], free["content"])


class ServeTest(PaymentTestCase):
    def test_a_price_without_configuration_fails_at_start_not_at_a_buyer(self) -> None:
        self.set_price(0.05)
        with self.assertRaises(ValueError) as raised:
            mcp.answer_gate()
        self.assertIn("no payout address configured", str(raised.exception))

    def test_each_missing_item_names_its_own_next_step(self) -> None:
        """One error at a time, each pointing at the command that resolves it."""
        self.set_price(0.05)
        with Store() as store:
            store.set_setting(payment_config.PAY_TO_SETTING, PAY_TO)
        with self.assertRaises(ValueError) as raised:
            mcp.answer_gate()
        self.assertIn("lore payment auth", str(raised.exception))

    def test_serve_exits_nonzero_and_says_what_is_missing(self) -> None:
        from lore.cli import main

        self.set_price(0.05)
        errors = StringIO()
        with patch("sys.stderr", errors):
            code = main(["serve", "--transport", "http"])
        self.assertEqual(code, 1)
        self.assertIn("payout address", errors.getvalue())

    def test_a_free_node_builds_no_gate(self) -> None:
        self.set_price(0)
        self.assertIsNone(mcp.answer_gate())


class CredentialStorageTest(PaymentTestCase):
    def test_the_secret_lands_in_its_own_0600_file(self) -> None:
        path = credentials.save(cdp_api_key_id="id", cdp_api_key_secret=SECRET)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(path.name, "payment.json")

    def test_the_secret_is_kept_out_of_the_database_and_the_synthesis_directory(self) -> None:
        """lore.db gets copied and automation/ gets read by synthesis. Neither is safe."""
        credentials.save(cdp_api_key_id="id", cdp_api_key_secret=SECRET)
        with Store() as store:
            store.set_setting("price_usd", 1.0)
            database = Path(store.path)
        self.assertNotIn(SECRET, database.read_bytes().decode("utf-8", "ignore"))
        self.assertNotIn("automation", str(credentials.path()))

    def test_an_existing_file_with_a_loose_mode_is_tightened(self) -> None:
        path = credentials.path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}", encoding="utf-8")
        path.chmod(0o644)
        credentials.save(cdp_api_key_id="id", cdp_api_key_secret=SECRET)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_saving_one_credential_leaves_the_others_alone(self) -> None:
        credentials.save(cdp_api_key_id="id", cdp_api_key_secret=SECRET)
        credentials.save(test_buyer_key="0xbuyerkey")
        stored = credentials.load()
        self.assertEqual(stored[credentials.CDP_KEY_SECRET], SECRET)
        self.assertEqual(stored[credentials.TEST_BUYER_KEY], "0xbuyerkey")

    def test_presence_is_reportable_without_reading_the_value(self) -> None:
        credentials.save(cdp_api_key_id="id", cdp_api_key_secret=SECRET)
        present = credentials.configured()
        self.assertTrue(present[credentials.CDP_KEY_SECRET])
        self.assertFalse(present[credentials.TEST_BUYER_KEY])
        self.assertNotIn(SECRET, json.dumps(present))

    def test_clearing_removes_everything(self) -> None:
        credentials.save(cdp_api_key_id="id", cdp_api_key_secret=SECRET)
        self.assertTrue(credentials.clear())
        self.assertEqual(credentials.load(), {})
        self.assertFalse(credentials.clear())


class CommandOutputTest(PaymentTestCase):
    def test_no_command_prints_the_secret(self) -> None:
        """FR12, as a test: the secret appears in no output, whole or partial."""
        from lore.cli import payment_status, price, status

        credentials.save(cdp_api_key_id="visible-id", cdp_api_key_secret=SECRET)
        with Store() as store:
            store.set_setting(payment_config.PAY_TO_SETTING, PAY_TO)

        printed = StringIO()
        with redirect_stdout(printed):
            payment_status()
            price(0.05)
            price(None)
            status()
        output = printed.getvalue()

        self.assertNotIn(SECRET, output)
        for length in (8, 12, 16):  # No partial disclosure either.
            self.assertNotIn(SECRET[:length], output)
        self.assertIn("configured", output)
        self.assertIn("visible-id" if "visible-id" in output else "CDP key id", output)

    def test_status_reports_what_the_node_will_use_not_only_what_is_on_disk(self) -> None:
        """Reading only the file prints "not configured" beside a node that charges fine."""
        from lore.cli import payment_status

        with Store() as store:
            store.set_setting(payment_config.PAY_TO_SETTING, PAY_TO)
            store.set_setting("price_usd", 0.05)
        os.environ["CDP_API_KEY_ID"] = "env-id"
        os.environ["CDP_API_KEY_SECRET"] = SECRET

        printed = StringIO()
        with redirect_stdout(printed):
            payment_status()
        output = printed.getvalue()

        self.assertIn("from the environment", output)
        self.assertNotIn("CDP key secret   not configured", output)
        self.assertIn("Ready to charge", output)
        self.assertNotIn(SECRET, output)

    def test_the_secret_is_captured_with_echo_off_and_never_from_input(self) -> None:
        """An echoing prompt puts the secret on screen and into scrollback."""
        from lore.cli import payment_auth

        prompts: list[str] = []

        def fake_getpass(prompt: str = "") -> str:
            prompts.append(prompt)
            return SECRET if "secret" in prompt.lower() else "key-id-value"

        printed = StringIO()
        with (
            patch("getpass.getpass", fake_getpass),
            patch("builtins.input", side_effect=AssertionError("secrets must not use input()")),
            redirect_stdout(printed),
        ):
            payment_auth()

        self.assertEqual(len(prompts), 2)
        self.assertEqual(credentials.load()[credentials.CDP_KEY_SECRET], SECRET)
        self.assertNotIn(SECRET, printed.getvalue())

    def test_the_buyer_key_uses_the_same_echo_off_path(self) -> None:
        from lore.cli import payment_auth

        printed = StringIO()
        with (
            patch("getpass.getpass", lambda prompt="": "0xbuyerkey"),
            patch("builtins.input", side_effect=AssertionError("secrets must not use input()")),
            redirect_stdout(printed),
        ):
            payment_auth(buyer=True)
        self.assertEqual(credentials.load()[credentials.TEST_BUYER_KEY], "0xbuyerkey")
        self.assertNotIn("0xbuyerkey", printed.getvalue())

    def test_the_payout_address_is_shown_because_it_is_public(self) -> None:
        from lore.cli import payment_payout

        printed = StringIO()
        with redirect_stdout(printed):
            payment_payout(PAY_TO, "base-sepolia")
        self.assertIn(PAY_TO, printed.getvalue())
        self.assertIn("never holds", printed.getvalue())

    def test_setting_a_price_warns_when_it_cannot_be_collected(self) -> None:
        from lore.cli import price

        printed = StringIO()
        with redirect_stdout(printed):
            price(0.05)
        self.assertIn("Not chargeable yet", printed.getvalue())

    def test_free_is_reported_as_an_end_state_not_a_failure(self) -> None:
        from lore.cli import price

        printed = StringIO()
        with redirect_stdout(printed):
            price(0)
        self.assertIn("free", printed.getvalue())
        self.assertNotIn("Not chargeable", printed.getvalue())


@needs_payments
class BuyerHarnessTest(PaymentTestCase):
    """Drive a real socket, a real x402 client, and a real signature.

    The only stand-in is the facilitator. Everything between the buyer's key and
    Lore's publications is the code that will run on a live network.
    """

    def serve(self, payment_gate) -> str:
        server = mcp.build_server("127.0.0.1", 0, None, payment_gate)
        server.RequestHandlerClass.log_message = lambda *_, **__: None  # type: ignore[method-assign]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        return f"http://127.0.0.1:{server.server_address[1]}/mcp"

    def test_a_buyer_is_challenged_then_served_after_paying(self) -> None:
        from eth_account import Account

        from lore.payments.buyer import test_buy

        title = "Zorbulax migration retrospective"
        self.publish(title, "We rolled back at 3am after the quorum flapped.")
        answer_gate, facilitator = self.build_gate(
            0.01, lambda arguments: mcp.call_tool("answer", arguments)
        )
        url = self.serve(answer_gate)

        report = test_buy(
            url,
            "zorbulax",
            Account.create().key.hex(),
            paid_config(),
            watch_for=[title, "quorum"],
        )

        self.assertTrue(report["settled"])
        self.assertEqual(report["transaction"], "0xtestnet")
        self.assertEqual(report["pay_to"], PAY_TO)
        self.assertFalse(report["challenge_disclosed_content"])
        self.assertIn("quorum", " ".join(report["answer"]))
        self.assertEqual((facilitator.verified, facilitator.settled), (1, 1))

    def test_a_leaking_challenge_stops_the_harness_before_it_pays(self) -> None:
        """The check has to be able to fail, or it is decoration."""
        from lore.payments.buyer import leaked_terms

        challenge = {"accepts": [{"description": "Answer about quorum flapping"}]}
        self.assertEqual(leaked_terms(challenge, ["quorum"]), ["quorum"])
        self.assertEqual(leaked_terms(challenge, ["zorbulax"]), [])

    def test_a_free_node_tells_the_harness_it_has_nothing_to_pay_for(self) -> None:
        from eth_account import Account

        from lore.payments.buyer import test_buy

        self.publish("Deployment", "Ship on Fridays only when the rollback is tested.")
        url = self.serve(None)
        with self.assertRaisesRegex(ValueError, "without asking for payment"):
            test_buy(url, "deployment", Account.create().key.hex(), paid_config())

    def test_an_unreachable_node_is_named_rather_than_traced(self) -> None:
        from eth_account import Account

        from lore.payments.buyer import test_buy

        with self.assertRaisesRegex(ValueError, "could not reach the Lore node"):
            test_buy(
                "http://127.0.0.1:9/mcp", "q", Account.create().key.hex(), paid_config()
            )

    def test_a_bad_buyer_key_is_refused_without_echoing_it(self) -> None:
        from lore.payments.buyer import test_buy

        bad = "0xdeadbeef"
        with self.assertRaises(ValueError) as raised:
            test_buy("http://127.0.0.1:9/mcp", "q", bad, paid_config())
        self.assertNotIn(bad, str(raised.exception))


if __name__ == "__main__":
    unittest.main()
