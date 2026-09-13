"""Tests for lore/feedback.py (XC-028): the shared core behind
`lore report-feedback` and the Desktop app's Report Feedback dialog.

No test in this file makes a real network call. `submit()` is exercised
against a real local HTTP server (matching tests/test_snapshot.py's
`serving()`) so headers, JSON encoding, and status handling are all real;
only the truly network-level failures (DNS/refused/timeout) are patched.
"""

from __future__ import annotations

import json
import threading
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator
from unittest.mock import patch
from urllib.error import URLError

from helpers import LoreTestCase

from lore import feedback
from lore.store import Store

CONTRACT_PATH = (
    Path(__file__).resolve().parent.parent / "contracts" / "feedback_report.json"
)


@contextmanager
def stub_relay(
    status: int, body: object, raw_bodies: list[bytes] | None = None
) -> Iterator[tuple[str, list[dict[str, object]]]]:
    """Serve exactly one canned response and capture the request bodies received.

    Pass `raw_bodies` to also collect the undecoded bytes, for the tests that
    care how the payload was encoded rather than what it says.
    """
    received: list[dict[str, object]] = []
    headers: list[dict[str, str]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            size = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(size)
            headers.append(dict(self.headers.items()))
            if raw_bodies is not None:
                raw_bodies.append(raw)
            received.append(json.loads(raw) if raw else {})
            payload = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/report", received
    finally:
        server.shutdown()
        thread.join(timeout=5)


class ContractTest(unittest.TestCase):
    def test_python_limits_match_the_shared_contract(self) -> None:
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        limits = contract["limits"]
        self.assertEqual(limits["title"]["max"], feedback.MAX_TITLE)
        self.assertEqual(limits["email"]["max"], feedback.MAX_EMAIL)
        self.assertEqual(limits["description"]["max"], feedback.MAX_DESCRIPTION)
        self.assertEqual(limits["body_bytes"], feedback.MAX_BODY_BYTES)
        # The relay counts the same unit pydantic does. Without this, an
        # emoji-heavy description valid here is a 400 there, because
        # JavaScript's String#length counts UTF-16 code units.
        self.assertEqual(contract["length_unit"], "code_points")
        self.assertEqual(contract["report_version"], feedback.REPORT_VERSION)
        self.assertEqual(sorted(contract["sources"]), ["cli", "desktop"])
        self.assertEqual(
            sorted(contract["metadata_fields"]),
            sorted(feedback.ReportMetadata.model_fields),
        )


class BuildTest(LoreTestCase):
    def test_a_well_formed_report_validates(self) -> None:
        report = feedback.build(
            title="Sync silently skips Codex sessions",
            email="me@example.com",
            description="Steps to reproduce...",
            source="cli",
        )
        self.assertEqual(report.title, "Sync silently skips Codex sessions")
        self.assertEqual(report.email, "me@example.com")
        self.assertEqual(report.metadata.source, "cli")
        self.assertEqual(report.metadata.lore_version, feedback.__version__)
        self.assertRegex(report.metadata.install_id, r"^[0-9a-f]{32}$")

    def test_email_is_optional(self) -> None:
        report = feedback.build(
            title="No reply address", email=None, description="details", source="cli"
        )
        self.assertIsNone(report.email)

    def test_whitespace_only_email_becomes_none(self) -> None:
        report = feedback.build(
            title="t", email="   ", description="d", source="desktop"
        )
        self.assertIsNone(report.email)

    def test_control_characters_are_stripped_from_title(self) -> None:
        report = feedback.build(
            title="bad\x00title\twith\x1fcontrol",
            email=None,
            description="d",
            source="cli",
        )
        self.assertNotIn("\x00", report.title)
        self.assertNotIn("\x1f", report.title)

    def test_blank_title_after_cleaning_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            feedback.build(title="   ", email=None, description="d", source="cli")

    def test_blank_description_after_cleaning_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            feedback.build(title="t", email=None, description="\n\n  ", source="cli")

    def test_oversize_title_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            feedback.build(
                title="x" * (feedback.MAX_TITLE + 1),
                email=None,
                description="d",
                source="cli",
            )

    def test_oversize_description_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            feedback.build(
                title="t",
                email=None,
                description="x" * (feedback.MAX_DESCRIPTION + 1),
                source="cli",
            )

    def test_rejected_error_message_names_the_field(self) -> None:
        with self.assertRaisesRegex(ValueError, "^title:"):
            feedback.build(title="", email=None, description="d", source="cli")

    def test_non_string_title_or_description_fails_type_validation(self) -> None:
        # A hand-crafted JSON payload (not a real CLI/Desktop path) could send
        # a non-string; the cleaner passes it through untouched so pydantic's
        # own type check rejects it, rather than crashing inside .translate().
        with self.assertRaises(ValueError):
            feedback.Report.model_validate(
                {
                    "title": 123,
                    "email": None,
                    "description": "d",
                    "metadata": feedback.collect_metadata("cli").model_dump(
                        mode="json"
                    ),
                }
            )
        with self.assertRaises(ValueError):
            feedback.Report.model_validate(
                {
                    "title": "t",
                    "email": None,
                    "description": 123,
                    "metadata": feedback.collect_metadata("cli").model_dump(
                        mode="json"
                    ),
                }
            )

    def test_implausible_emails_are_rejected(self) -> None:
        for bad in (
            "no-at-sign",
            "a@b@c.com",
            "a b@example.com",
            "@example.com",
            "a@nodot",
            "a@.com",
            "a@example.",
        ):
            with self.subTest(email=bad):
                with self.assertRaisesRegex(ValueError, "^email:"):
                    feedback.build(title="t", email=bad, description="d", source="cli")


class InstallIdTest(LoreTestCase):
    def test_mints_once_and_reuses(self) -> None:
        first = feedback.install_id()
        second = feedback.install_id()
        self.assertEqual(first, second)
        self.assertRegex(first, r"^[0-9a-f]{32}$")

    def test_a_corrupt_setting_is_reminted(self) -> None:
        with Store() as store:
            store.set_setting(feedback.INSTALL_ID_SETTING, "not-an-id")
        minted = feedback.install_id()
        self.assertRegex(minted, r"^[0-9a-f]{32}$")
        self.assertNotEqual(minted, "not-an-id")


class MetadataTest(LoreTestCase):
    def test_fields_are_populated(self) -> None:
        metadata = feedback.collect_metadata("desktop")
        self.assertEqual(metadata.source, "desktop")
        self.assertRegex(
            metadata.submitted_at, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"
        )
        self.assertTrue(metadata.platform)
        self.assertTrue(metadata.arch)
        self.assertTrue(metadata.python_version)

    def test_unavailable_platform_facts_fall_back_to_unknown(self) -> None:
        with (
            patch("lore.feedback.platform.system", return_value=""),
            patch("lore.feedback.platform.release", return_value=""),
            patch("lore.feedback.platform.machine", return_value=""),
            patch("lore.feedback.platform.python_version", return_value=""),
        ):
            metadata = feedback.collect_metadata("cli")
        self.assertEqual(metadata.platform, "unknown")
        self.assertEqual(metadata.arch, "unknown")
        self.assertEqual(metadata.python_version, "unknown")


class RelayUrlTest(LoreTestCase):
    def test_no_pinned_relay_refuses_and_says_so(self) -> None:
        """Until a maintainer deploys the relay and pins its address, a build
        must refuse rather than POST somewhere nobody configured."""
        self.assertIsNone(feedback.RELAY_URL)
        with self.assertRaises(ValueError) as caught:
            feedback.relay_url()
        self.assertIn("not wired up", str(caught.exception))
        self.assertFalse(feedback.available())

    def test_a_pinned_relay_is_used_and_reported_available(self) -> None:
        with patch.object(feedback, "RELAY_URL", "https://feedback.example/report"):
            self.assertEqual(feedback.relay_url(), "https://feedback.example/report")
            self.assertTrue(feedback.available())

    def test_a_malformed_override_is_not_available(self) -> None:
        with patch.dict(
            "os.environ", {feedback.RELAY_ENV: "http://example.com/report"}
        ):
            self.assertFalse(feedback.available())

    def test_https_override_is_accepted(self) -> None:
        with patch.dict(
            "os.environ", {feedback.RELAY_ENV: "https://example.com/report"}
        ):
            self.assertEqual(feedback.relay_url(), "https://example.com/report")

    def test_localhost_override_is_accepted_for_tests(self) -> None:
        with patch.dict(
            "os.environ", {feedback.RELAY_ENV: "http://127.0.0.1:9999/report"}
        ):
            self.assertEqual(feedback.relay_url(), "http://127.0.0.1:9999/report")

    def test_a_plain_http_override_is_rejected(self) -> None:
        with patch.dict(
            "os.environ", {feedback.RELAY_ENV: "http://example.com/report"}
        ):
            with self.assertRaises(ValueError):
                feedback.relay_url()


class SpoolTest(LoreTestCase):
    def _report(self) -> feedback.Report:
        return feedback.build(title="t", email="a@b.com", description="d", source="cli")

    def test_writes_a_private_file_before_sending(self) -> None:
        report = self._report()
        path = feedback.spool(report)
        self.assertTrue(path.is_file())
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(feedback.spool_dir().stat().st_mode & 0o777, 0o700)
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(saved["report"]["title"], "t")
        self.assertNotIn("receipt", saved)
        self.assertNotIn("error", saved)

    def test_updating_with_a_receipt_rewrites_the_named_file(self) -> None:
        report = self._report()
        first = feedback.spool(report)
        receipt = feedback.Receipt(ok=True, issue_url="https://x/1", issue_number=1)
        second = feedback.spool(report, path=first, receipt=receipt)
        self.assertEqual(first, second)
        saved = json.loads(second.read_text(encoding="utf-8"))
        self.assertEqual(saved["receipt"]["issue_number"], 1)

    def test_two_reports_in_the_same_second_keep_both_copies(self) -> None:
        """submitted_at has one-second precision and install_id is fixed for
        an installation, so the name has to break the tie itself — PRIVACY.md
        promises a copy of everything sent."""
        first_report = self._report()
        second_report = feedback.build(
            title="second", email=None, description="also mine", source="cli"
        ).model_copy(update={"metadata": first_report.metadata})
        first = feedback.spool(first_report)
        second = feedback.spool(second_report)
        self.assertNotEqual(first, second)
        self.assertEqual(
            json.loads(first.read_text(encoding="utf-8"))["report"]["title"], "t"
        )
        self.assertEqual(
            json.loads(second.read_text(encoding="utf-8"))["report"]["title"], "second"
        )

    def test_running_out_of_same_second_names_raises(self) -> None:
        report = self._report()
        feedback.spool(report)
        with patch.object(feedback, "SPOOL_ATTEMPTS", 1):
            with self.assertRaises(OSError):
                feedback.allocate_spool_path(report)

    def test_updating_with_an_error_records_it(self) -> None:
        report = self._report()
        path = feedback.spool(report, error="offline")
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(saved["error"], "offline")

    def test_pruning_keeps_only_the_newest_files(self) -> None:
        directory = feedback.spool_dir()
        for index in range(feedback.SPOOL_KEEP + 3):
            (directory / f"2020-01-01T00-00-{index:02d}Z-000.json").write_text("{}")
        with patch.object(feedback, "SPOOL_KEEP", 5):
            feedback._prune_spool()
        remaining = sorted(directory.glob("*.json"))
        self.assertEqual(len(remaining), 5)

    def test_pruning_is_a_no_op_under_the_cap(self) -> None:
        directory = feedback.spool_dir()
        (directory / "one.json").write_text("{}")
        feedback._prune_spool()
        self.assertEqual(len(list(directory.glob("*.json"))), 1)


class SubmitTest(LoreTestCase):
    def _report(self) -> feedback.Report:
        return feedback.build(title="t", email="a@b.com", description="d", source="cli")

    def test_a_successful_post_returns_the_receipt_and_sends_the_right_headers(
        self,
    ) -> None:
        with stub_relay(
            201, {"ok": True, "issue_url": "https://x/1", "issue_number": 1}
        ) as (url, received):
            receipt = feedback.submit(self._report(), url=url)
        self.assertTrue(receipt.ok)
        self.assertEqual(receipt.issue_number, 1)
        self.assertEqual(received[0]["title"], "t")

    def test_non_ascii_text_crosses_as_utf8_rather_than_escapes(self) -> None:
        """json.dumps defaults to ensure_ascii=True, which turns every CJK
        character into a six-byte \\uXXXX escape. The relay caps the body in
        bytes, so the escaping alone could make a valid report a 413."""
        description = "同步静默跳过 Codex 会话 🤖🚀"
        raw_bodies: list[bytes] = []
        with stub_relay(
            201,
            {"ok": True, "issue_url": "https://x/1", "issue_number": 1},
            raw_bodies,
        ) as (url, received):
            feedback.submit(
                feedback.build(
                    title="标题",
                    email=None,
                    description=description,
                    source="cli",
                ),
                url=url,
            )
        self.assertEqual(received[0]["description"], description)
        self.assertNotIn(b"\\u", raw_bodies[0])
        self.assertIn(description.encode("utf-8"), raw_bodies[0])

    def test_a_maximal_non_ascii_report_stays_under_the_relays_body_cap(self) -> None:
        """Every field at its limit, in the widest characters UTF-8 has: the
        relay must not be able to 413 something this module accepted."""
        report = feedback.build(
            title="🚀" * feedback.MAX_TITLE,
            email="a" * 60 + "@" + "b" * 60 + ".example",
            description="🚀" * feedback.MAX_DESCRIPTION,
            source="desktop",
        )
        raw_bodies: list[bytes] = []
        with stub_relay(
            201,
            {"ok": True, "issue_url": "https://x/1", "issue_number": 1},
            raw_bodies,
        ) as (url, _received):
            feedback.submit(report, url=url)
        self.assertLess(len(raw_bodies[0]), feedback.MAX_BODY_BYTES)

    def test_extra_fields_on_the_receipt_are_ignored(self) -> None:
        with stub_relay(
            201,
            {
                "ok": True,
                "issue_url": "https://x/1",
                "issue_number": 1,
                "unexpected": "field",
            },
        ) as (url, _received):
            receipt = feedback.submit(self._report(), url=url)
        self.assertEqual(receipt.issue_number, 1)

    def test_400_with_an_error_message_becomes_a_value_error(self) -> None:
        with stub_relay(400, {"error": "title is required"}) as (url, _received):
            with self.assertRaisesRegex(ValueError, "title is required"):
                feedback.submit(self._report(), url=url)

    def test_400_with_a_non_dict_body_still_yields_a_message(self) -> None:
        with stub_relay(400, ["oops"]) as (url, _received):
            with self.assertRaises(ValueError):
                feedback.submit(self._report(), url=url)

    def test_400_with_an_error_field_that_is_not_a_string_falls_back_to_the_body(
        self,
    ) -> None:
        with stub_relay(400, {"error": 123}) as (url, _received):
            with self.assertRaises(ValueError):
                feedback.submit(self._report(), url=url)

    def test_400_with_non_json_body_falls_back_to_raw_text(self) -> None:
        with stub_relay(400, b"plain text failure") as (url, _received):
            with self.assertRaisesRegex(ValueError, "plain text failure"):
                feedback.submit(self._report(), url=url)

    def test_400_with_an_empty_body_says_no_details_given(self) -> None:
        with stub_relay(400, b"") as (url, _received):
            with self.assertRaisesRegex(ValueError, "no details given"):
                feedback.submit(self._report(), url=url)

    def test_429_is_a_rate_limit_os_error(self) -> None:
        with stub_relay(429, {"error": "slow down"}) as (url, _received):
            with self.assertRaisesRegex(OSError, "too many"):
                feedback.submit(self._report(), url=url)

    def test_500_is_an_unavailable_os_error(self) -> None:
        with stub_relay(500, {"error": "boom"}) as (url, _received):
            with self.assertRaisesRegex(OSError, "unavailable"):
                feedback.submit(self._report(), url=url)

    def test_a_200_with_an_unreadable_body_is_a_value_error(self) -> None:
        with stub_relay(201, {"not": "a receipt"}) as (url, _received):
            with self.assertRaisesRegex(ValueError, "unreadable"):
                feedback.submit(self._report(), url=url)

    def test_unreachable_host_is_an_os_error(self) -> None:
        with patch(
            "lore.feedback.urllib.request.urlopen", side_effect=URLError("refused")
        ):
            with self.assertRaisesRegex(OSError, "could not reach"):
                feedback.submit(self._report(), url="https://example.invalid/report")

    def test_timeout_is_an_os_error(self) -> None:
        with patch("lore.feedback.urllib.request.urlopen", side_effect=TimeoutError()):
            with self.assertRaisesRegex(OSError, "timed out"):
                feedback.submit(self._report(), url="https://example.invalid/report")


class ReportFeedbackTest(LoreTestCase):
    def test_success_spools_the_receipt_and_returns_it(self) -> None:
        with stub_relay(
            201, {"ok": True, "issue_url": "https://x/9", "issue_number": 9}
        ) as (url, _received):
            with patch.dict("os.environ", {feedback.RELAY_ENV: url}):
                receipt = feedback.report_feedback(
                    title="t", email="a@b.com", description="d", source="cli"
                )
        self.assertEqual(receipt.issue_number, 9)
        [spooled] = list(feedback.spool_dir().glob("*.json"))
        saved = json.loads(spooled.read_text(encoding="utf-8"))
        self.assertEqual(saved["receipt"]["issue_number"], 9)

    def test_a_relay_outage_names_the_spool_path_in_the_error(self) -> None:
        with stub_relay(500, {"error": "boom"}) as (url, _received):
            with patch.dict("os.environ", {feedback.RELAY_ENV: url}):
                with self.assertRaises(OSError) as caught:
                    feedback.report_feedback(
                        title="t", email=None, description="d", source="cli"
                    )
        self.assertIn(str(feedback.spool_dir()), str(caught.exception))
        [spooled] = list(feedback.spool_dir().glob("*.json"))
        saved = json.loads(spooled.read_text(encoding="utf-8"))
        self.assertIn("error", saved)

    def test_a_relay_rejection_is_spooled_and_reraised(self) -> None:
        with stub_relay(400, {"error": "bad input"}) as (url, _received):
            with patch.dict("os.environ", {feedback.RELAY_ENV: url}):
                with self.assertRaisesRegex(ValueError, "bad input"):
                    feedback.report_feedback(
                        title="t", email=None, description="d", source="cli"
                    )
        [spooled] = list(feedback.spool_dir().glob("*.json"))
        saved = json.loads(spooled.read_text(encoding="utf-8"))
        self.assertIn("bad input", saved["error"])

    def test_a_build_failure_never_reaches_the_network(self) -> None:
        with patch("lore.feedback.submit") as submit:
            with self.assertRaises(ValueError):
                feedback.report_feedback(
                    title="", email=None, description="d", source="cli"
                )
        submit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
