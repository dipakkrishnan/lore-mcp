"""Table tests for `deploy.deploy_preconditions` (XC-105): the first reason a
deploy must not start, from plain data. No store, no npm, no Cloudflare;
`tests/test_deploy.py` keeps the deploy chain itself as the component tier."""

from __future__ import annotations

import math
import unittest

import hermetic  # noqa: F401  (no test may reach a real Cloudflare account)

from lore import deploy

WALLET = "0x" + "ab" * 20


def refusal(**overrides: object) -> ValueError | OSError | None:
    arguments: dict[str, object] = {
        "wallet": WALLET,
        "network": None,
        "inbox_only": False,
        "npm_found": True,
        "configured_price": 0.37,
        "already_selling": False,
        "chosen": None,
        "reconnecting": False,
    }
    arguments |= overrides
    wallet = arguments.pop("wallet")
    network = arguments.pop("network")
    return deploy.deploy_preconditions(wallet, network, **arguments)  # type: ignore[arg-type]


class DeployPreconditionsTest(unittest.TestCase):
    def test_a_full_deploy_with_everything_in_place_is_not_refused(self) -> None:
        self.assertIsNone(refusal())
        self.assertIsNone(refusal(wallet=None, network="real"))
        self.assertIsNone(refusal(wallet=None, network=None))

    def test_inbox_only_takes_no_payout_address_or_network(self) -> None:
        for wallet, network in ((WALLET, None), (None, "test"), (WALLET, "real")):
            with self.subTest(wallet=wallet, network=network):
                refused = refusal(wallet=wallet, network=network, inbox_only=True)
                self.assertIsInstance(refused, ValueError)
                self.assertIn("--inbox-only", str(refused))

    def test_a_wallet_must_be_an_evm_address(self) -> None:
        for wallet in ("0x123", "ab" * 21, "0x" + "zz" * 20):
            with self.subTest(wallet=wallet):
                refused = refusal(wallet=wallet)
                self.assertIsInstance(refused, ValueError)
                self.assertIn("public EVM address", str(refused))

    def test_without_node_the_refusal_is_an_oserror_naming_nodejs(self) -> None:
        refused = refusal(npm_found=False)
        self.assertIsInstance(refused, OSError)
        self.assertEqual(str(refused), deploy.NEEDS_NODE)

    def test_the_arguments_are_judged_before_the_toolchain(self) -> None:
        refused = refusal(wallet="0x123", npm_found=False)
        self.assertIsInstance(refused, ValueError)

    def test_reconnecting_an_existing_store_needs_the_full_setup(self) -> None:
        for chosen, refused in ((None, True), (True, True), (False, False)):
            with self.subTest(chosen=chosen):
                found = refusal(
                    wallet=None,
                    inbox_only=True,
                    reconnecting=True,
                    chosen=chosen,
                    configured_price=None,
                )
                if refused:
                    self.assertIsInstance(found, ValueError)
                    self.assertIn("reconnecting an existing store", str(found))
                else:
                    self.assertIsNone(found)

    def test_reconnecting_only_matters_to_an_inbox_only_deploy(self) -> None:
        self.assertIsNone(refusal(reconnecting=True))

    def test_inbox_only_needs_no_price_until_the_store_sells(self) -> None:
        for price in (None, 0, "free", math.nan, 1e-9):
            with self.subTest(price=price):
                self.assertIsNone(
                    refusal(wallet=None, inbox_only=True, configured_price=price)
                )

    def test_inbox_only_on_a_selling_store_keeps_a_price_it_can_charge(self) -> None:
        self.assertIsNone(refusal(wallet=None, inbox_only=True, already_selling=True))
        refused = refusal(
            wallet=None, inbox_only=True, already_selling=True, configured_price=0
        )
        self.assertIsInstance(refused, ValueError)
        self.assertIn("publications are free", str(refused))

    def test_a_full_deploy_needs_a_price_the_node_can_charge(self) -> None:
        cases: tuple[tuple[object, str], ...] = (
            (None, "no publication price is set"),
            (True, "must be a number"),
            ("0.5", "must be a number"),
            (math.inf, "must be a number"),
            (math.nan, "must be a number"),
            (0, "publications are free"),
            (0.0, "publications are free"),
            (1e-9, "must be a number of at least $0.000001"),
            (-1, "must be a number of at least $0.000001"),
        )
        for price, words in cases:
            with self.subTest(price=price):
                refused = refusal(configured_price=price)
                self.assertIsInstance(refused, ValueError)
                self.assertIn(words, str(refused))
        for price in (deploy.MINIMUM_PRICE, 0.01, 3, 1e6):
            with self.subTest(price=price):
                self.assertIsNone(refusal(configured_price=price))


class PriceTest(unittest.TestCase):
    def test_a_valid_price_is_the_configured_one_as_a_float(self) -> None:
        self.assertEqual(deploy._valid_price(3), 3.0)
        self.assertIsInstance(deploy._valid_price(3), float)
        self.assertEqual(deploy._valid_price(0.37), 0.37)

    def test_an_invalid_price_raises_what_the_preconditions_return(self) -> None:
        with self.assertRaisesRegex(ValueError, "no publication price is set"):
            deploy._valid_price(None)
        with self.assertRaisesRegex(ValueError, "publications are free"):
            deploy._valid_price(0)

    def test_priced_is_the_price_the_node_can_charge_else_none(self) -> None:
        for configured, priced in (
            (0.37, 0.37),
            (2, 2.0),
            (0, None),
            (None, None),
            (True, None),
            ("1", None),
            (math.inf, None),
            (1e-9, None),
        ):
            with self.subTest(configured=configured):
                self.assertEqual(deploy._priced(configured), priced)


if __name__ == "__main__":
    unittest.main()
