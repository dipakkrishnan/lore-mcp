"""Tests for `lore.cloudflare`: the owner's account, read and readied through
Cloudflare's API with wrangler's sign-in (XC-087). Nothing reaches the network."""

from __future__ import annotations

import unittest
from unittest.mock import call, patch

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

    # XC-110: the refusal and retry paths, so lore/cloudflare.py meets the floor.

    def test_a_refusal_that_is_not_json_is_still_a_refusal(self) -> None:
        with self.assertRaises(CloudflareError) as refused:
            self._with(FakeCloudflare(garbled=True)).accounts()
        self.assertEqual(refused.exception.codes, set())
        self.assertIn("(502)", str(refused.exception))

    def test_a_second_page_of_accounts_is_read_too(self) -> None:
        fake = FakeCloudflare([ADA, LAB], per_page=1)
        found = self._with(fake).accounts()
        self.assertEqual([account.id for account in found], [ADA["id"], LAB["id"]])
        self.assertEqual(
            [path for _, path, _ in fake.calls],
            ["/accounts?per_page=50&page=1", "/accounts?per_page=50&page=2"],
        )

    def test_a_subdomain_refusal_other_than_none_yet_is_raised(self) -> None:
        fake = FakeCloudflare(refused=(10000, "Authentication error"))
        with self.assertRaises(CloudflareError) as refused:
            self._with(fake).subdomain(ADA["id"])
        self.assertEqual(refused.exception.codes, {10000})

    def test_a_register_refusal_other_than_taken_is_raised_not_retried(self) -> None:
        fake = FakeCloudflare(refused=(10000, "Authentication error"))
        with self.assertRaises(CloudflareError) as refused:
            self._with(fake).register(ADA["id"], "ada-lore")
        self.assertEqual(refused.exception.codes, {10000})
        self.assertEqual(fake.made(), ["ada-lore"])

    def test_a_name_cloudflare_reports_late_is_waited_for(self) -> None:
        fake = FakeCloudflare(subdomain=None, late=1)
        with patch("lore.cloudflare.time.sleep") as sleep:
            made = self._with(fake).register(ADA["id"], "ada-lore")
        self.assertEqual(made, "ada-lore")
        self.assertEqual(sleep.call_args_list, [call(2)])
        self.assertEqual([method for method, _, _ in fake.calls], ["PUT", "GET", "GET"])

    def test_a_name_never_reported_is_still_the_one_made(self) -> None:
        fake = FakeCloudflare(subdomain=None, late=99)
        with patch("lore.cloudflare.time.sleep") as sleep:
            made = self._with(fake).register(ADA["id"], "ada-lore", waits=2)
        self.assertEqual(made, "ada-lore")
        self.assertEqual(sleep.call_count, 2)

    def test_every_name_taken_is_a_refusal_naming_it(self) -> None:
        fake = FakeCloudflare(
            subdomain=None,
            taken=(
                "ada-lore",
                "ada-lore-2",
                "ada-lore-3",
                "ada-lore-4",
                "ada-lore-abc123",
            ),
        )
        with (
            patch("lore.cloudflare.secrets.token_hex", return_value="abc123"),
            self.assertRaises(CloudflareError) as refused,
        ):
            self._with(fake).register(ADA["id"], "ada-lore")
        self.assertEqual(refused.exception.codes, {10031})
        self.assertIn("every name tried was taken", str(refused.exception))
        self.assertEqual(len(fake.made()), 5)

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
