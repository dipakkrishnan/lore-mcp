"""Tests for the publication bundle — the copy a deployed node serves.

The first group is the important one. A bundle leaves the owner's machine, so the
question these tests answer is not "does export work" but "can anything the owner
did not approve end up in the copy".
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from lore import bundle as bundle_module
from lore.bundle import (
    DEFAULT_MAX_AGE_DAYS,
    SCHEMA_VERSION,
    BundleExpired,
    BundlePublication,
    BundleReader,
    BundleUnreadable,
    digest,
    export,
)
from lore.search import fts5_available, match_expression
from lore.store import PublicationKind, Store

# A string that exists only in a private memory. If it appears anywhere in a
# bundle, something leaked.
PRIVATE_CANARY = "zzcanaryzz-unlisted-salary-figure-8675309"


def publication_rows(store: Store) -> list[BundlePublication]:
    """Project the library's active publications into bundle rows.

    Mirrors what `lore.deploy` will do, kept here so these tests pin the column
    selection independently of the deploy flow.
    """
    return [
        BundlePublication(
            id=item.id,
            title=item.title,
            content=item.content,
            kind=str(item.kind),
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in store.list_publications(active_only=True)
    ]


class BundleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        os.environ["LORE_HOME"] = str(self.root / "lore")
        self.store = Store(self.root / "lore.db")
        self.destination = self.root / "bundle.db"

    def tearDown(self) -> None:
        self.store.close()
        self.tmp.cleanup()

    def seed(self) -> dict[str, int]:
        """Build a library with a private memory and a mix of publications."""
        self.store.put(
            source="claude",
            origin="native",
            source_path="/tmp/private.md",
            source_key="private-1",
            fingerprint="f1",
            title="Compensation notes",
            content=f"Owner's private note: {PRIVATE_CANARY}",
            project="personal",
        )
        active = self.store.add_publication(
            title="Consensus tradeoffs",
            content="consensus consensus consensus raft paxos",
            kind=PublicationKind.CLAIM,
            topic="distributed-systems",
            provenance=[1],
        )
        long_match = self.store.add_publication(
            title="Networking notes",
            content=(
                "a long note about routing, switching, congestion control and "
                "queueing where consensus appears exactly once among many words"
            ),
            kind=PublicationKind.CLAIM,
            topic="networking",
            provenance=[1],
        )
        # Carries a diacritic, so the parity and folding assertions have teeth
        # rather than comparing two empty result sets.
        diacritic = self.store.add_publication(
            title="Café habits",
            content="I review best over a café latté in the afternoon",
            kind=PublicationKind.CONTENT,
            topic="lifestyle",
            provenance=[1],
        )
        # Revoked, and its text contains the canary. If revocation filtering ever
        # breaks, the raw-bytes test below catches it.
        revoked = self.store.add_publication(
            title="Revoked claim",
            content=f"this mentions {PRIVATE_CANARY} and was withdrawn",
            kind=PublicationKind.CONTENT,
            topic="withdrawn",
            provenance=[1],
        )
        self.store.revoke_publication(revoked)
        self.store.set_setting("price_usd", 0.25)
        return {
            "active": active,
            "long_match": long_match,
            "diacritic": diacritic,
            "revoked": revoked,
        }

    # ---------------------------------------------------------------- contents

    def test_bundle_contains_no_private_memory_text_anywhere(self) -> None:
        """The strongest form of the invariant: scan the raw bytes.

        Column-level assertions can pass while a private string rides along in a
        free page or an FTS segment, so this checks the file itself.
        """
        self.seed()
        export(
            publication_rows(self.store), price_usd=0.25, destination=self.destination
        )
        raw = self.destination.read_bytes()
        self.assertNotIn(PRIVATE_CANARY.encode(), raw)
        self.assertNotIn(b"Compensation notes", raw)

    def test_bundle_schema_omits_provenance_and_source_changed_at(self) -> None:
        """Absent from the schema, not merely unpopulated."""
        self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        db = sqlite3.connect(self.destination)
        columns = {row[1] for row in db.execute("PRAGMA table_info(publications)")}
        db.close()
        self.assertEqual(
            columns, {"id", "title", "content", "kind", "created_at", "updated_at"}
        )
        self.assertNotIn("provenance", columns)
        self.assertNotIn("source_changed_at", columns)

    def test_bundle_has_no_memories_table_of_any_kind(self) -> None:
        self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        db = sqlite3.connect(self.destination)
        tables = {
            row[0]
            for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        db.close()
        self.assertNotIn("memories", tables)
        self.assertNotIn("memories_fts", tables)
        self.assertNotIn("settings", tables)
        self.assertIn("publications", tables)

    def test_revoked_publications_do_not_cross_over(self) -> None:
        ids = self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        with BundleReader(self.destination) as reader:
            exported = {row.id for row in reader.search_publications("", limit=0)}
        self.assertIn(ids["active"], exported)
        self.assertNotIn(ids["revoked"], exported)

    def test_flagged_but_active_publications_still_cross_over(self) -> None:
        """A stale-source flag is an owner-facing review signal, not a revocation.

        The published text is still exactly what the owner approved, so it keeps
        being served until they decide otherwise.
        """
        ids = self.seed()
        self.store.put(
            source="claude",
            origin="native",
            source_path="/tmp/private.md",
            source_key="private-1",
            fingerprint="f2-changed",
            title="Compensation notes",
            content=f"revised private note: {PRIVATE_CANARY}",
            project="personal",
        )
        self.assertTrue(
            self.store.stale_publications(), "expected a flagged publication"
        )
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        with BundleReader(self.destination) as reader:
            exported = {row.id for row in reader.search_publications("", limit=0)}
        self.assertIn(ids["active"], exported)

    def test_only_price_crosses_over_from_settings(self) -> None:
        self.seed()
        self.store.set_setting("sources", ["claude", "codex"])
        self.store.set_setting("deployment", {"endpoint": "https://example.invalid"})
        export(
            publication_rows(self.store), price_usd=0.25, destination=self.destination
        )
        with BundleReader(self.destination) as reader:
            self.assertEqual(reader.setting("price_usd"), 0.25)
            self.assertIsNone(reader.setting("sources"))
            self.assertIsNone(reader.setting("deployment"))
        self.assertNotIn(b"example.invalid", self.destination.read_bytes())

    # ------------------------------------------------------------------ digest

    def test_digest_is_stable_across_identical_exports(self) -> None:
        """Two exports of the same library must agree, or drift is meaningless."""
        self.seed()
        rows = publication_rows(self.store)
        first = export(rows, price_usd=0.25, destination=self.root / "a.db")
        second = export(rows, price_usd=0.25, destination=self.root / "b.db")
        self.assertEqual(first.digest, second.digest)

    def test_digest_ignores_build_time_but_not_content(self) -> None:
        self.seed()
        rows = publication_rows(self.store)
        early = export(
            rows,
            price_usd=0.25,
            destination=self.root / "early.db",
            built_at="2020-01-01T00:00:00+00:00",
        )
        late = export(rows, price_usd=0.25, destination=self.root / "late.db")
        self.assertNotEqual(early.built_at, late.built_at)
        self.assertEqual(early.digest, late.digest)

    def test_digest_changes_when_the_library_or_price_changes(self) -> None:
        ids = self.seed()
        rows = publication_rows(self.store)
        baseline = digest(rows, 0.25)

        self.assertNotEqual(baseline, digest(rows, 0.50), "price must be covered")
        self.assertNotEqual(
            baseline, digest(rows[:-1], 0.25), "removal must be covered"
        )

        self.store.revoke_publication(ids["active"])
        self.assertNotEqual(
            baseline,
            digest(publication_rows(self.store), 0.25),
            "revocation must count",
        )

    def test_digest_is_independent_of_row_order(self) -> None:
        self.seed()
        rows = publication_rows(self.store)
        self.assertEqual(digest(rows, None), digest(list(reversed(rows)), None))

    def test_recorded_digest_matches_the_bundles_own_metadata(self) -> None:
        """Drift must be detectable without opening a network connection."""
        self.seed()
        info = export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        with BundleReader(self.destination) as reader:
            self.assertEqual(reader.digest, info.digest)
        self.assertEqual(digest(publication_rows(self.store), None), info.digest)

    # -------------------------------------------------------------------- age

    def test_default_max_age_is_seven_days_and_is_recorded(self) -> None:
        self.seed()
        info = export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        self.assertEqual(info.max_age_days, DEFAULT_MAX_AGE_DAYS)
        self.assertEqual(DEFAULT_MAX_AGE_DAYS, 7.0)
        with BundleReader(self.destination) as reader:
            self.assertEqual(reader.max_age_days, 7.0)

    def test_expired_bundle_refuses_to_answer_and_returns_no_content(self) -> None:
        """Fail closed: the bound exists only to cap revocation latency."""
        self.seed()
        built = datetime(2026, 1, 1, tzinfo=timezone.utc)
        export(
            publication_rows(self.store),
            price_usd=None,
            destination=self.destination,
            max_age_days=7.0,
            built_at=built.isoformat(),
        )
        reader = BundleReader(
            self.destination, now=built + timedelta(days=7, seconds=1)
        )
        self.addCleanup(reader.close)
        self.assertTrue(reader.expired)
        with self.assertRaises(BundleExpired):
            reader.search_publications("consensus")
        with self.assertRaises(BundleExpired):
            reader.search_publications("")

    def test_bundle_inside_the_bound_answers_normally(self) -> None:
        self.seed()
        built = datetime(2026, 1, 1, tzinfo=timezone.utc)
        export(
            publication_rows(self.store),
            price_usd=None,
            destination=self.destination,
            max_age_days=7.0,
            built_at=built.isoformat(),
        )
        # Exactly at the bound is still serveable; past it is not.
        reader = BundleReader(self.destination, now=built + timedelta(days=7))
        self.addCleanup(reader.close)
        self.assertFalse(reader.expired)
        self.assertTrue(reader.search_publications("consensus"))

    def test_max_age_can_be_disabled_for_a_set_and_forget_node(self) -> None:
        self.seed()
        built = datetime(2020, 1, 1, tzinfo=timezone.utc)
        info = export(
            publication_rows(self.store),
            price_usd=None,
            destination=self.destination,
            max_age_days=None,
            built_at=built.isoformat(),
        )
        self.assertIsNone(info.max_age_days)
        with BundleReader(self.destination) as reader:
            self.assertIsNone(reader.max_age_days)
            self.assertFalse(reader.expired)
            self.assertTrue(reader.search_publications("consensus"))

    def test_zero_or_negative_max_age_is_rejected(self) -> None:
        self.seed()
        for value in (0, -1):
            with self.assertRaises(ValueError):
                export(
                    publication_rows(self.store),
                    price_usd=None,
                    destination=self.destination,
                    max_age_days=value,
                )

    # ----------------------------------------------------------------- search

    def test_bm25_ranks_a_focused_match_above_a_passing_mention(self) -> None:
        ids = self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        with BundleReader(self.destination) as reader:
            ranked = [
                row.id for row in reader.search_publications("consensus", limit=5)
            ]
        self.assertEqual(ranked, [ids["active"], ids["long_match"]])

    def test_diacritics_fold_in_the_bundle_as_they_do_locally(self) -> None:
        """`remove_diacritics 2` must survive the export.

        If the tokenizer option were dropped, `cafe` would stop matching `café`
        and the deployed node would quietly answer fewer queries than the local
        one — a divergence no error would report.
        """
        ids = self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        with BundleReader(self.destination) as reader:
            for query in ("cafe", "café", "latte"):
                with self.subTest(query=query):
                    self.assertEqual(
                        [row.id for row in reader.search_publications(query)],
                        [ids["diacritic"]],
                    )

    def test_query_with_no_searchable_terms_returns_nothing(self) -> None:
        self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        with BundleReader(self.destination) as reader:
            self.assertEqual(reader.search_publications("!!! ???"), [])
        self.assertIsNone(match_expression("!!! ???"))

    def test_negative_limit_is_rejected(self) -> None:
        self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        with BundleReader(self.destination) as reader, self.assertRaises(ValueError):
            reader.search_publications("consensus", limit=-1)

    # ------------------------------------------------------------- robustness

    def test_bundle_declares_a_journal_mode_every_sqlite_build_can_read(self) -> None:
        """Pins the invariant, not a behavior that varies by SQLite build.

        A WAL bundle copied without its -wal sidecar opens read-only on SQLite
        3.40 and 3.53 but fails on 3.51, so testing "can it be read here" would
        pass or fail depending on which interpreter ran it. The file header is the
        portable statement: bytes 18 and 19 are the write and read format
        versions, and 1/1 means any build can read it. See
        docs/fts5-lambda-runtime-spike.md.
        """
        self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        header = self.destination.read_bytes()[18:20]
        self.assertEqual(tuple(header), (1, 1), "bundle must not be in WAL mode (2/2)")
        db = sqlite3.connect(self.destination)
        self.addCleanup(db.close)
        self.assertEqual(db.execute("PRAGMA journal_mode").fetchone()[0], "delete")

    def test_bundle_opens_read_only_after_being_copied_alone(self) -> None:
        """The production shape: one file uploaded, no journal sidecars.

        A WAL-mode database copied without its -wal file can fail to open
        read-only, so the exporter must not leave the bundle in WAL mode.
        """
        self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        self.assertEqual(
            sorted(p.name for p in self.root.glob("bundle.db-*")),
            [],
            "a bundle must not need journal sidecars to be readable",
        )
        copied = self.root / "uploaded.db"
        copied.write_bytes(self.destination.read_bytes())
        with BundleReader(copied) as reader:
            self.assertTrue(reader.search_publications("consensus"))

    def test_export_rebuilds_rather_than_accumulating(self) -> None:
        """Re-exporting must not leave a previously-active row behind."""
        ids = self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        self.store.revoke_publication(ids["active"])
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        with BundleReader(self.destination) as reader:
            remaining = {row.id for row in reader.search_publications("", limit=0)}
        self.assertNotIn(ids["active"], remaining)
        self.assertNotIn(
            b"consensus consensus consensus", self.destination.read_bytes()
        )

    def test_empty_library_exports_an_empty_bundle(self) -> None:
        """Refusing to deploy an empty library belongs to preflight, not here."""
        info = export([], price_usd=None, destination=self.destination)
        self.assertEqual(info.publication_count, 0)
        with BundleReader(self.destination) as reader:
            self.assertEqual(reader.search_publications("anything"), [])

    def test_bundle_is_owner_readable_only(self) -> None:
        self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o600)

    def test_schema_version_mismatch_is_refused(self) -> None:
        """A future bundle format must not be served by an older reader."""
        self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        db = sqlite3.connect(self.destination)
        db.execute(
            "UPDATE meta SET value=? WHERE key='schema_version'",
            (json.dumps(SCHEMA_VERSION + 1),),
        )
        db.commit()
        db.close()
        with self.assertRaises(BundleUnreadable):
            BundleReader(self.destination)

    def test_missing_bundle_reports_a_diagnosable_error(self) -> None:
        with self.assertRaises(BundleUnreadable):
            BundleReader(self.root / "absent.db")

    def test_runtime_without_fts5_is_named_as_the_cause(self) -> None:
        """The raw SQLite error says `malformed database schema`, naming neither
        FTS5 nor the runtime. See docs/fts5-lambda-runtime-spike.md."""
        self.seed()
        export(
            publication_rows(self.store), price_usd=None, destination=self.destination
        )
        original = bundle_module.fts5_available
        bundle_module.fts5_available = lambda: False
        self.addCleanup(setattr, bundle_module, "fts5_available", original)
        with self.assertRaises(BundleUnreadable) as caught:
            BundleReader(self.destination)
        self.assertIn("FTS5", str(caught.exception))

    def test_this_runtime_has_fts5(self) -> None:
        """Guards the floor: Lore requires Python 3.12+ for exactly this reason."""
        self.assertTrue(fts5_available())


if __name__ == "__main__":
    unittest.main()
