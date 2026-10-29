"""Tests for `lore.cloudflare`: the owner's account, read and readied through
Cloudflare's API with wrangler's sign-in (XC-087). Nothing reaches the network."""

from __future__ import annotations

import unittest
from unittest.mock import patch

import hermetic  # noqa: F401  (no test may reach a real Cloudflare account)
from fixtures.cloudflare import ADA, LAB, FakeCloudflare

from lore.cloudflare import Cloudflare, CloudflareError, subdomain_name


class CloudflareTest(unittest.TestCase):
    def _with(self, fake: FakeCloudflare) -> Cloudflare:
        patcher = patch("lore.cloudflare.request.urlopen", fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        return Cloudflare("wrangler-token")

    def test_every_call_carries_wranglers_token(self) -> None:
        fake = FakeCloudflare()
        self._with(fake).accounts()
        self.assertEqual(fake.tokens, {"Bearer wrangler-token"})

    def test_lists_every_account_the_sign_in_can_use(self) -> None:
        found = self._with(FakeCloudflare([ADA, LAB])).accounts()
        self.assertEqual([account.id for account in found], [ADA["id"], LAB["id"]])

    def test_an_account_that_never_had_an_address_has_none(self) -> None:
        cloudflare = self._with(FakeCloudflare(subdomain=None))
        self.assertIsNone(cloudflare.subdomain(ADA["id"]))

    def test_an_address_is_made_and_waited_on(self) -> None:
        fake = FakeCloudflare(subdomain=None)
        made = self._with(fake).register(ADA["id"], "ada-lore")
        self.assertEqual(made, "ada-lore")
        self.assertEqual(
            fake.calls[-1], ("GET", f"/accounts/{ADA['id']}/workers/subdomain", None)
        )

    def test_a_name_someone_else_has_gets_a_number(self) -> None:
        fake = FakeCloudflare(subdomain=None, taken=("ada-lore",))
        self.assertEqual(self._with(fake).register(ADA["id"], "ada-lore"), "ada-lore-2")
        self.assertEqual(fake.made(), ["ada-lore", "ada-lore-2"])

    def test_an_unverified_email_is_told_apart(self) -> None:
        with self.assertRaises(CloudflareError) as refused:
            self._with(FakeCloudflare(unverified=True)).accounts()
        self.assertTrue(refused.exception.unverified)

    def test_any_other_refusal_is_not_an_unverified_email(self) -> None:
        refused = CloudflareError(
            [{"code": 10000, "message": "Authentication error"}], 403
        )
        self.assertFalse(refused.unverified)
        self.assertIn("Authentication error", str(refused))


class SubdomainNameTest(unittest.TestCase):
    def test_from_the_owners_name(self) -> None:
        self.assertEqual(subdomain_name("Ada Lovelace"), "ada-lovelace-lore")

    def test_a_name_with_nothing_usable_gets_a_random_one(self) -> None:
        self.assertRegex(subdomain_name("  ✨ "), r"^lore-[0-9a-f]{6}$")


if __name__ == "__main__":
    unittest.main()
