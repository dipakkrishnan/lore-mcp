"""Tests for `lore.store` — retention, search, and the publications table.

The invariant under test throughout: a status expresses retention only. Nothing
here makes a memory externally readable; only a publication does that.
"""

from __future__ import annotations

import json
import sqlite3
import stat
import unittest
from pathlib import Path

from helpers import LoreTestCase

from lore.store import (
    STATUSES,
    Memory,
    Publication,
    PublicationKind,
    Status,
    Store,
    new_public_id,
    valid_public_id,
)


class StoreLifecycleTest(LoreTestCase):
    def test_the_database_and_its_directory_are_owner_only(self) -> None:
        with Store() as store:
            self.assertEqual(stat.S_IMODE(store.path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(store.path.parent.stat().st_mode), 0o700)

    def test_an_explicit_path_is_used_verbatim(self) -> None:
        # `lore node deploy` and future tooling open a store by path; only the
        # default (~/.lore) location owns the directory mode.
        path = Path(self.tmp.name) / "elsewhere/custom.db"
        with Store(path) as store:
            self.assertEqual(store.path, path)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_close_is_idempotent_through_the_context_manager(self) -> None:
        store = Store()
        with store:
            store.counts()
        with self.assertRaises(sqlite3.ProgrammingError):
            store.counts()

    def test_legacy_database_is_normalized_on_open(self) -> None:
        # A database created before the retention-only model holds rows in
        # statuses `Status` now rejects. CREATE TABLE IF NOT EXISTS leaves the
        # old table in place, so without normalization any search touching such
        # a row crashes with a validation error — and there is no CLI remedy,
        # because reclassifying needs an id and ids come from search.
        self.lore_home.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.lore_home / "lore.db")
        db.executescript(
            """
            CREATE TABLE memories (
                id INTEGER PRIMARY KEY, source TEXT NOT NULL,
                origin TEXT NOT NULL DEFAULT 'native', source_path TEXT NOT NULL,
                source_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
                title TEXT NOT NULL, content TEXT NOT NULL,
                project TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','private','external','discarded')),
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE VIRTUAL TABLE memories_fts USING fts5(
                title, content, project,
                content='memories', content_rowid='id',
                tokenize='unicode61 remove_diacritics 2');
            CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid,title,content,project)
                VALUES (new.id,new.title,new.content,new.project); END;
            """
        )
        for index, legacy in enumerate(("pending", "external", "private", "discarded")):
            db.execute(
                """INSERT INTO memories(source,origin,source_path,source_key,
                   fingerprint,title,content,status,created_at,updated_at)
                   VALUES ('codex','native',?,?,?,?,?,?,'2026-07-01','2026-07-01')""",
                (
                    f"p{index}",
                    f"k{index}",
                    f"f{index}",
                    f"Lesson {legacy}",
                    "a lesson body",
                    legacy,
                ),
            )
        db.commit()
        db.close()
        with Store() as store:
            counts = store.counts()
            # pending and external became plain private rows; discarded survived.
            self.assertEqual(counts["private"], 3)
            self.assertEqual(counts["discarded"], 1)
            # Unfiltered search maps every row through the Status enum — the
            # crash this migration prevents. All four must validate.
            found = store.search("lesson")
            self.assertEqual(len(found), 4)
            self.assertEqual(
                {m.status for m in found}, {Status.PRIVATE, Status.DISCARDED}
            )


class RetentionTest(LoreTestCase):
    def test_disclosure_is_not_a_memory_status(self) -> None:
        # `external` and `pending` are gone: retention is the only thing a status
        # expresses, and neither one can be set or queried any more.
        self.assertEqual(STATUSES, ("private", "discarded"))
        memory_id = self.seed_memory("A lesson")
        with Store() as store:
            for retired in ("external", "pending"):
                with self.assertRaisesRegex(ValueError, "invalid status"):
                    store.set_status(memory_id, retired)
                with self.assertRaisesRegex(ValueError, "invalid status"):
                    store.search("lesson", status=retired)

    def test_new_imports_default_to_private(self) -> None:
        with Store() as store:
            store.put(
                source="test",
                origin="native",
                source_path="fresh",
                source_key="fresh",
                fingerprint="fresh",
                title="Fresh import",
                content="a freshly imported memory",
            )
            self.assertIs(store.search("Fresh")[0].status, Status.PRIVATE)
            self.assertNotIn("pending", store.counts())

    def test_setting_a_status_on_a_missing_memory_is_an_error(self) -> None:
        with Store() as store:
            with self.assertRaisesRegex(ValueError, "memory not found"):
                store.set_status(999, "private")

    def test_put_reports_added_updated_and_unchanged(self) -> None:
        fields = {
            "source": "test",
            "origin": "native",
            "source_path": "p",
            "source_key": "k",
            "title": "Lesson",
            "content": "a body",
        }
        with Store() as store:
            self.assertEqual(store.put(fingerprint="one", **fields), "added")
            self.assertEqual(store.put(fingerprint="one", **fields), "unchanged")
            self.assertEqual(store.put(fingerprint="two", **fields), "updated")
            self.assertEqual(store.counts()["private"], 1)

    def test_counts_and_source_counts_group_what_they_say(self) -> None:
        self.seed_memory("Kept lesson", "private")
        self.seed_memory("Dropped lesson", "discarded")
        with Store() as store:
            self.assertEqual(store.counts(), {"private": 1, "discarded": 1})
            self.assertEqual(store.source_counts(), {"test": 2})


class SearchTest(LoreTestCase):
    def test_search_filters_orders_and_limits(self) -> None:
        self.seed_memory("Alpha lesson")
        self.seed_memory("Beta lesson")
        self.seed_memory("Gamma lesson", "discarded")
        with Store() as store:
            self.assertEqual(len(store.search("")), 3)
            self.assertEqual(len(store.search("", status="private")), 2)
            self.assertEqual(len(store.search("lesson", status="discarded")), 1)
            self.assertEqual(len(store.search("lesson", limit=1)), 1)
            # limit=0 means "no ceiling", not "no results".
            self.assertEqual(len(store.search("lesson", limit=0)), 3)

    def test_a_query_with_no_word_characters_matches_nothing(self) -> None:
        # `!!!` is not a search for everything: it tokenizes to nothing, and
        # handing FTS5 an empty MATCH would be a syntax error.
        self.seed_memory("Alpha lesson")
        with Store() as store:
            self.assertEqual(store.search("!!! ???"), [])

    def test_a_quoted_query_cannot_break_out_of_the_match_expression(self) -> None:
        self.seed_memory("Alpha lesson")
        with Store() as store:
            self.assertEqual(store.search('lesson" OR "'), [])
            self.assertEqual(len(store.search('"lesson"')), 1)

    def test_search_rejects_a_negative_limit_and_an_unknown_status(self) -> None:
        with Store() as store:
            with self.assertRaisesRegex(ValueError, "limit"):
                store.search("anything", limit=-1)
            with self.assertRaisesRegex(ValueError, "invalid status"):
                store.search("anything", status="nonsense")


class SettingsTest(LoreTestCase):
    def test_settings_round_trip_json_and_default_when_absent(self) -> None:
        with Store() as store:
            self.assertIsNone(store.setting("price_usd"))
            self.assertEqual(store.setting("sources", []), [])
            store.set_setting("sources", ["claude", "codex"])
            store.set_setting("price_usd", 1.5)
            self.assertEqual(store.setting("sources"), ["claude", "codex"])
            self.assertEqual(store.setting("price_usd"), 1.5)
            store.set_setting("sources", [])  # replace, not append
            self.assertEqual(store.setting("sources"), [])

    def test_a_non_finite_setting_is_refused(self) -> None:
        # NaN would round-trip as invalid JSON that no other reader can parse.
        with Store() as store:
            with self.assertRaises(ValueError):
                store.set_setting("price_usd", float("nan"))


class PublicationTest(LoreTestCase):
    """Publications are the only externally-readable rows, so every guard on
    creating one is a guard on what a stranger's agent can be sold."""

    def setUp(self) -> None:
        super().setUp()
        self.memory_id = self.seed_memory("Pricing lesson")

    def publish(self, **overrides: object) -> int:
        with Store() as store:
            return store.add_publication(
                **{
                    "title": "Pricing claim",
                    "content": "a bounded claim about pricing agent APIs",
                    "topic": "pricing",
                    "provenance": [self.memory_id],
                }
                | overrides
            )

    def test_publications_add_list_revoke(self) -> None:
        pid = self.publish()
        with Store() as store:
            active = store.list_publications(active_only=True)
            self.assertEqual(len(active), 1)
            self.assertIs(active[0].kind, PublicationKind.CLAIM)
            self.assertEqual(active[0].provenance, [self.memory_id])
            self.assertEqual(active[0].topic, "pricing")
            # public_id is minted at publish time: an opaque token, distinct
            # from the owner-only sequential id.
            self.assertEqual(len(active[0].public_id), 24)
            self.assertTrue(valid_public_id(active[0].public_id))
            doc_id = store.add_publication(
                title="Doc",
                content="verbatim",
                topic="docs",
                kind=PublicationKind.CONTENT,
                provenance=[self.memory_id],
            )
            self.assertGreater(doc_id, 0)
            revoked_public_id = next(
                p.public_id for p in store.list_publications() if p.id == pid
            )
            store.revoke_publication(pid)
            self.assertEqual(
                [p.id for p in store.list_publications(active_only=True)], [doc_id]
            )
            self.assertEqual(len(store.list_publications()), 2)  # revoked still listed
            with self.assertRaisesRegex(ValueError, "not found"):
                store.get_publication(revoked_public_id)  # revoked is not fetchable

    def test_publication_kind_accepts_a_plain_string_and_rejects_anything_else(
        self,
    ) -> None:
        # `lore publication apply` passes raw strings from a drafted candidate
        # file; the enum normalizes them and rejects anything else.
        self.publish(kind="content")
        with Store() as store:
            self.assertIs(store.list_publications()[0].kind, PublicationKind.CONTENT)
            with self.assertRaisesRegex(ValueError, "claim.*content"):
                store.add_publication(
                    title="Bad",
                    content="x",
                    topic="t",
                    kind="secret",
                    provenance=[self.memory_id],
                )

    def test_title_content_and_topic_must_all_carry_text(self) -> None:
        # The topic is externally visible wherever discovery groups by it, so an
        # empty one is a publication no buyer can be shown honestly.
        for field in ("title", "content", "topic"):
            for empty in ("", "   "):
                with self.subTest(field=field, value=empty):
                    with self.assertRaisesRegex(ValueError, "at least 1 character"):
                        self.publish(**{field: empty})
            with self.subTest(field=field, value=None):
                with self.assertRaisesRegex(ValueError, "valid string"):
                    self.publish(**{field: None})

    def test_text_is_stored_stripped(self) -> None:
        self.publish(title="  Pricing claim  ", topic="  pricing  ")
        with Store() as store:
            saved = store.list_publications()[0]
            self.assertEqual(saved.title, "Pricing claim")
            self.assertEqual(saved.topic, "pricing")

    def test_provenance_must_be_real_memory_ids(self) -> None:
        # A publication with no traceable source cannot be checked by the owner
        # who has to stand behind it.
        for provenance, message in (
            (None, "valid list"),
            ([], "at least 1 item"),
            ("1,2", "valid list"),
            ([True], "valid integer"),
            (["1"], "valid integer"),
            ([999], "unknown memories"),
            ([None], "valid integer"),
        ):
            with self.subTest(provenance=provenance):
                with self.assertRaisesRegex(ValueError, message):
                    self.publish(provenance=provenance)

    def test_missing_memories_reports_only_the_absent_ids_in_order(self) -> None:
        other = self.seed_memory("Second lesson")
        with Store() as store:
            self.assertEqual(store.missing_memories([self.memory_id, other]), [])
            self.assertEqual(
                store.missing_memories([901, self.memory_id, 900]), [901, 900]
            )
            self.assertEqual(store.missing_memories([]), [])

    def test_flagging_and_re_approval_act_on_one_publication_only(self) -> None:
        other = self.seed_memory("Unrelated lesson")
        derived = self.publish()
        unrelated = self.publish(title="Other claim", provenance=[other])
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
            self.assertEqual([p.id for p in store.stale_publications()], [derived])
            by_id = {p.id: p for p in store.list_publications()}
            self.assertIsNotNone(by_id[derived].source_changed_at)
            self.assertIsNone(by_id[unrelated].source_changed_at)
            # Flagged is not revoked: the approved text stays externally readable.
            self.assertIn(
                derived, [p.id for p in store.list_publications(active_only=True)]
            )
            store.clear_publication_flag(derived)
            self.assertEqual(store.stale_publications(), [])

    def test_a_revoked_publication_is_never_flagged(self) -> None:
        pid = self.publish()
        with Store() as store:
            store.revoke_publication(pid)
            store.put(
                source="test",
                origin="native",
                source_path="Pricing lesson",
                source_key="Pricing lesson",
                fingerprint="changed",
                title="Pricing lesson",
                content="a changed body",
            )
            self.assertEqual(store.stale_publications(), [])

    def test_acting_on_a_missing_publication_is_an_error(self) -> None:
        with Store() as store:
            with self.assertRaisesRegex(ValueError, "publication not found"):
                store.clear_publication_flag(404)
            with self.assertRaisesRegex(ValueError, "publication not found"):
                store.revoke_publication(404)

    def test_get_publication_is_the_only_paid_read_path(self) -> None:
        pid = self.publish(teaser="an ad")
        with Store() as store:
            public_id = next(
                p.public_id for p in store.list_publications() if p.id == pid
            )
            fetched = store.get_publication(public_id)
            self.assertEqual(fetched.id, pid)
            self.assertEqual(fetched.title, "Pricing claim")
            with self.assertRaisesRegex(ValueError, "invalid publication id"):
                store.get_publication("not-a-valid-id")
            with self.assertRaisesRegex(ValueError, "not found"):
                store.get_publication(new_public_id())  # well-formed, never minted

    def test_manifest_renders_only_advertised_publications(self) -> None:
        # The manifest is the whole free surface: teasers grouped by topic,
        # never content or title. A publication without a teaser was never
        # given an advertisement, so it must not render at all.
        memory_id = self.memory_id
        with Store() as store:
            advertised = store.add_publication(
                title="Lab conversion results",
                content="Replacing two lecture hours with a graded lab raised median scores.",
                topic="course design",
                teaser="What happened to median scores when lectures became a graded lab",
                provenance=[memory_id],
            )
            store.add_publication(
                title="Unadvertised claim",
                content="secret-ish detail",
                topic="course design",
                provenance=[memory_id],
            )
            manifest = store.manifest()
            advertised_public = next(
                p for p in store.list_publications() if p.id == advertised
            )
        self.assertEqual(manifest["publication_count"], 1)
        entries = manifest["topics"]["course design"]
        self.assertEqual(
            [set(entry) for entry in entries], [{"id", "teaser", "kind", "updated_at"}]
        )
        # Buyer-facing ids are the opaque tokens, never the sequential row ids:
        # a sequence would advertise every withdrawal as a visible gap.
        self.assertEqual(entries[0]["id"], advertised_public.public_id)
        self.assertNotEqual(entries[0]["id"], advertised)
        # Freshness is day-precision only; full timestamps reveal the owner's
        # approval-session structure.
        self.assertEqual(len(entries[0]["updated_at"]), 10)
        text = json.dumps(manifest)
        self.assertNotIn("Lab conversion results", text)  # titles are paid
        self.assertNotIn("raised median scores", text)  # content is paid
        self.assertNotIn("Unadvertised", text)

    def test_manifest_is_byte_identical_under_private_row_changes(self) -> None:
        # MCP-001 AC 2: everything a buyer observes derives exclusively from
        # owner-approved fields of active publications. The invariant holds
        # today because manifest() touches one table — this pins it, so a
        # future join against memories (a count, a freshness signal) fails
        # loudly instead of leaking the private library's shape.
        memory_id = self.memory_id
        with Store() as store:
            store.add_publication(
                title="Stable claim",
                content="the paid content",
                topic="stability",
                teaser="What stayed true across changes",
                provenance=[memory_id],
            )
            before = json.dumps(store.manifest(), sort_keys=True)

            # Add a private row.
            store.put(
                source="test",
                origin="native",
                source_path="new.md",
                source_key="new.md",
                fingerprint="v1",
                title="Newly private",
                content="never disclosed",
            )
            # Edit one (changed fingerprint re-puts and flags publications).
            store.put(
                source="test",
                origin="native",
                source_path="new.md",
                source_key="new.md",
                fingerprint="v2",
                title="Newly private",
                content="edited, still never disclosed",
            )
            # Discard one.
            store.set_status(memory_id, "discarded")

            after = json.dumps(store.manifest(), sort_keys=True)
        self.assertEqual(before, after)


class PublicationMigrationTest(LoreTestCase):
    def test_the_topic_and_teaser_columns_are_added_to_databases_created_before_them(
        self,
    ) -> None:
        # CREATE TABLE IF NOT EXISTS never alters, so a database from before the
        # topic/teaser/public_id columns keeps the old shape and every
        # publication read crashes without this migration.
        self.lore_home.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.lore_home / "lore.db")
        db.execute(
            """CREATE TABLE publications (
                   id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
                   kind TEXT NOT NULL DEFAULT 'claim', provenance TEXT NOT NULL DEFAULT '[]',
                   active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL, source_changed_at TEXT)"""
        )
        db.execute(
            "INSERT INTO publications(title,content,provenance,created_at,updated_at) "
            "VALUES ('Old','old text','[1]','2026-07-01','2026-07-01')"
        )
        db.commit()
        db.close()
        with Store() as store:
            memory_id = self.seed_memory("Migration evidence")
            new_id = store.add_publication(
                title="New",
                content="new text",
                topic="migrated",
                teaser="an advertisement",
                provenance=[memory_id],
            )
            by_title = {p.title: p for p in store.list_publications()}
            self.assertEqual(by_title["Old"].topic, "")
            self.assertEqual(by_title["Old"].teaser, "")
            self.assertEqual(by_title["New"].topic, "migrated")
            self.assertEqual(by_title["New"].teaser, "an advertisement")
            # public_id is minted for new rows and backfilled for legacy ones,
            # and the two never collide.
            self.assertEqual(len(by_title["Old"].public_id), 24)
            self.assertEqual(len(by_title["New"].public_id), 24)
            self.assertNotEqual(by_title["Old"].public_id, by_title["New"].public_id)
            self.assertGreater(new_id, 0)


class PublicIdTest(unittest.TestCase):
    def test_a_damaged_public_id_fails_the_checksum(self) -> None:
        public_id = new_public_id()
        self.assertTrue(valid_public_id(public_id))
        damaged = ("0" if public_id[0] != "0" else "1") + public_id[1:]
        self.assertFalse(valid_public_id(damaged))
        self.assertFalse(valid_public_id("not-hex-at-all"))
        self.assertFalse(valid_public_id(public_id[:-1]))  # wrong length


class ModelTest(unittest.TestCase):
    def test_the_enums_render_as_their_wire_values(self) -> None:
        # They are written into SQL and JSON payloads; `Status.PRIVATE` would be
        # a silent corruption of both.
        self.assertEqual(f"{Status.PRIVATE}", "private")
        self.assertEqual(f"{PublicationKind.CONTENT}", "content")

    def test_models_are_frozen(self) -> None:
        memory = Memory(
            id=1,
            source="test",
            origin="native",
            title="t",
            content="c",
            project="",
            status="private",
            source_path="",
            updated_at="now",
        )
        with self.assertRaises(ValueError):
            memory.title = "changed"  # type: ignore[misc]

    def test_from_row_decodes_what_sqlite_stores(self) -> None:
        db = sqlite3.connect(":memory:")
        db.row_factory = sqlite3.Row
        db.execute(
            "CREATE TABLE publications (id INTEGER, title TEXT, content TEXT, kind TEXT, "
            "provenance TEXT, active INTEGER, created_at TEXT, updated_at TEXT, "
            "source_changed_at TEXT)"
        )
        db.execute(
            "INSERT INTO publications VALUES (1,'T','C','claim',?,1,'now','now',NULL)",
            (json.dumps([7, 8]),),
        )
        row = db.execute("SELECT * FROM publications").fetchone()
        publication = Publication.from_row(row)
        self.assertEqual(publication.provenance, [7, 8])
        self.assertIs(publication.kind, PublicationKind.CLAIM)
        db.close()


if __name__ == "__main__":
    unittest.main()
