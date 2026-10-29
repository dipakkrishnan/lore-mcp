"""Tests for `lore.cloudflare`: the owner's account, read and readied through
Cloudflare's API with wrangler's sign-in (XC-087). Nothing reaches the network."""

from __future__ import annotations

import json
import unittest
from collections.abc import Callable
from email.message import Message
from io import BytesIO
from typing import Any
from unittest import mock
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import hermetic  # noqa: F401  (no test may reach a real Cloudflare account)
from fixtures.cloudflare import ADA, LAB, FakeCloudflare, _Answer

from lore.cloudflare import Cloudflare, CloudflareError, subdomain_name


class _Case(unittest.TestCase):
    def _with(self, fake: Callable[..., object]) -> Cloudflare:
        patcher = patch("lore.cloudflare.request.urlopen", fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        return Cloudflare("wrangler-token")


class CloudflareTest(_Case):
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


class _Paged:
    """Accounts spread over pages, with `result_info` as given. Refuses a page
    out of range or a repeat, so a loop that never advances fails fast."""

    def __init__(self, pages: list[list[dict[str, str]]], info: object) -> None:
        self.pages = pages
        self.info = info
        self.asked: list[int] = []

    def __call__(self, request: Any, timeout: float | None = None) -> _Answer:
        page = int(parse_qs(urlsplit(request.full_url).query)["page"][0])
        if not 1 <= page <= len(self.pages) or page in self.asked:
            raise AssertionError(f"asked for page {page} after {self.asked}")
        self.asked.append(page)
        envelope: dict[str, object] = {"success": True, "result": self.pages[page - 1]}
        if self.info is not None:
            envelope["result_info"] = self.info
        return _Answer(json.dumps(envelope).encode())


class _Slow(FakeCloudflare):
    """Cloudflare that answers `lag` checks with "no address" after making one."""

    def __init__(self, lag: int) -> None:
        super().__init__(subdomain=None)
        self.lag = lag

    def __call__(self, request: Any, timeout: float | None = None) -> _Answer:
        if request.get_method() == "GET" and self.made() and self.lag > 0:
            self.lag -= 1
            made, self.subdomain = self.subdomain, None
            try:
                return super().__call__(request, timeout)
            finally:
                self.subdomain = made
        return super().__call__(request, timeout)

    def checks(self) -> int:
        return sum(1 for method, _, _ in self.calls if method == "GET")


def _answering(status: int, body: bytes) -> Callable[..., _Answer]:
    """A Cloudflare whose every answer has this status and body."""

    def answer(request: Any, timeout: float | None = None) -> _Answer:
        if status >= 400:
            raise HTTPError(
                request.full_url, status, "refused", Message(), BytesIO(body)
            )
        reply = _Answer(body)
        reply.status = status
        return reply

    return answer


class PagingTest(_Case):
    def test_every_page_of_accounts_is_read_in_order(self) -> None:
        third = {"id": "ab" * 16, "name": "Third"}
        paged = _Paged([[ADA], [LAB], [third]], {"page": 1, "total_pages": 3})
        found = self._with(paged).accounts()
        self.assertEqual([a.id for a in found], [ADA["id"], LAB["id"], third["id"]])
        self.assertEqual(paged.asked, [1, 2, 3])

    def test_an_answer_without_page_info_is_one_page(self) -> None:
        paged = _Paged([[ADA], [LAB]], None)
        self.assertEqual([a.id for a in self._with(paged).accounts()], [ADA["id"]])
        self.assertEqual(paged.asked, [1])

    def test_a_page_count_that_isnt_a_number_is_one_page(self) -> None:
        paged = _Paged([[ADA], [LAB]], {"total_pages": "2"})
        self.assertEqual([a.id for a in self._with(paged).accounts()], [ADA["id"]])
        self.assertEqual(paged.asked, [1])


class SubdomainTest(_Case):
    def test_a_refusal_other_than_no_address_is_raised(self) -> None:
        cloudflare = self._with(FakeCloudflare(unverified=True))
        with self.assertRaises(CloudflareError) as refused:
            cloudflare.subdomain(ADA["id"])
        self.assertEqual(refused.exception.codes, {10034})
        self.assertTrue(refused.exception.unverified)

    def test_an_empty_address_is_none(self) -> None:
        self.assertIsNone(self._with(FakeCloudflare(subdomain="")).subdomain(ADA["id"]))

    def test_an_answer_without_a_result_is_none(self) -> None:
        empty = _answering(200, b'{"success": true, "result": null}')
        self.assertIsNone(self._with(empty).subdomain(ADA["id"]))


class RegisterTest(_Case):
    def setUp(self) -> None:
        patcher = patch("lore.cloudflare.time.sleep")
        self.slept = patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_refusal_other_than_taken_stops_at_the_first_name(self) -> None:
        fake = FakeCloudflare(unverified=True)
        with self.assertRaises(CloudflareError) as refused:
            self._with(fake).register(ADA["id"], "ada-lore")
        self.assertEqual(refused.exception.codes, {10034})
        self.assertEqual(fake.made(), ["ada-lore"])

    def test_when_every_name_is_taken_it_says_so(self) -> None:
        names = [
            "ada-lore",
            "ada-lore-2",
            "ada-lore-3",
            "ada-lore-4",
            "ada-lore-c0ffee",
        ]
        fake = FakeCloudflare(subdomain=None, taken=tuple(names))
        with patch("lore.cloudflare.secrets.token_hex", return_value="c0ffee"):
            with self.assertRaises(CloudflareError) as refused:
                self._with(fake).register(ADA["id"], "ada-lore")
        self.assertEqual(fake.made(), names)
        self.assertEqual(refused.exception.codes, {10031})
        self.assertIn("(409)", str(refused.exception))
        self.assertNotIn("GET", [method for method, _, _ in fake.calls])

    def test_it_waits_until_cloudflare_reports_the_address(self) -> None:
        fake = _Slow(lag=2)
        self.assertEqual(self._with(fake).register(ADA["id"], "ada-lore"), "ada-lore")
        self.assertEqual(fake.checks(), 3)
        self.assertEqual(self.slept.call_args_list, [mock.call(2)] * 2)

    def test_it_stops_waiting_and_keeps_the_name_it_made(self) -> None:
        fake = _Slow(lag=99)
        made = self._with(fake).register(ADA["id"], "ada-lore", waits=3)
        self.assertEqual(made, "ada-lore")
        self.assertEqual(fake.checks(), 3)
        self.assertEqual(self.slept.call_args_list, [mock.call(2)] * 3)

    def test_no_waits_means_no_check(self) -> None:
        fake = _Slow(lag=99)
        made = self._with(fake).register(ADA["id"], "ada-lore", waits=0)
        self.assertEqual(made, "ada-lore")
        self.assertEqual(fake.checks(), 0)
        self.slept.assert_not_called()


class RefusalTest(_Case):
    def _refused(self, status: int, body: bytes) -> CloudflareError:
        cloudflare = self._with(_answering(status, body))
        with self.assertRaises(CloudflareError) as refused:
            cloudflare.accounts()
        return refused.exception

    def test_a_refusal_that_isnt_json_keeps_its_status(self) -> None:
        refused = self._refused(502, b"<html><body>Bad gateway</body></html>")
        self.assertEqual(refused.codes, set())
        self.assertIn("(502)", str(refused))
        self.assertFalse(refused.unverified)

    def test_a_refusal_that_isnt_an_object_has_no_codes(self) -> None:
        refused = self._refused(500, b"[]")
        self.assertEqual(refused.codes, set())
        self.assertIn("(500)", str(refused))

    def test_an_ok_status_that_reports_failure_is_a_refusal(self) -> None:
        body = b'{"success": false, "errors": [{"code": 9109, "message": "Invalid"}]}'
        refused = self._refused(200, body)
        self.assertEqual(refused.codes, {9109})
        self.assertIn("(200): Invalid", str(refused))

    def test_errors_that_arent_a_list_are_ignored(self) -> None:
        refused = self._refused(400, b'{"success": false, "errors": null}')
        self.assertEqual(refused.codes, set())
        self.assertIn("(400)", str(refused))


class SubdomainNameTest(unittest.TestCase):
    def test_from_the_owners_name(self) -> None:
        self.assertEqual(subdomain_name("Ada Lovelace"), "ada-lovelace-lore")

    def test_a_name_with_nothing_usable_gets_a_random_one(self) -> None:
        self.assertRegex(subdomain_name("  ✨ "), r"^lore-[0-9a-f]{6}$")


if __name__ == "__main__":
    unittest.main()
