"""Tests for the `feed` source kind — blogs, newsletters, Bluesky, Mastodon.

Every fetch is answered from `fixtures/feeds/`, because what this reader is
worth is what it makes of a response, not that it can make one. The fixtures
are trimmed copies of real responses, including their double-escaped HTML.
"""

from __future__ import annotations

import json
import os
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from helpers import LoreTestCase, captured

from lore import cli
from lore import sources as sources_module
from lore.sources import FeedReader, Source
from lore.store import Store

FIXTURES = Path(__file__).parent / "fixtures/feeds"


def serving(routes: dict[str, str]):
    """Answer `FeedReader.fetch` from fixtures, by first matching URL fragment.

    A route with no fixture name, and any URL no route matches, is a 404.
    """

    def fetch(self: FeedReader, url: str) -> bytes:
        for fragment, name in routes.items():
            if fragment in url:
                if not name:
                    break
                return (FIXTURES / name).read_bytes()
        raise OSError(f"nothing at {url}")

    return patch.object(FeedReader, "fetch", fetch)


def reader(locator: str) -> FeedReader:
    found = Source.owner(locator, kind="feed").reader()
    assert isinstance(found, FeedReader)
    return found


def preview(locator: str) -> dict[str, object]:
    return sources_module.preview(locator, "feed")


class FeedLocatorTest(unittest.TestCase):
    def test_a_url_a_bare_host_and_two_kinds_of_handle(self) -> None:
        for typed, expected in (
            ("https://notes.example.com/feed", "https://notes.example.com/feed"),
            ("notes.example.com", "https://notes.example.com"),
            ("@writer.bsky.social", "@writer.bsky.social"),
            ("writer.bsky.social", "@writer.bsky.social"),
            ("@bsky.app", "@bsky.app"),
            ("@writer@hachyderm.io", "@writer@hachyderm.io"),
        ):
            with self.subTest(typed=typed):
                self.assertEqual(FeedReader.locate(typed)[0], expected)

    def test_the_label_falls_back_to_the_host_or_the_handle(self) -> None:
        self.assertEqual(
            FeedReader.locate("https://notes.example.com/feed")[1], "notes.example.com"
        )
        self.assertEqual(
            FeedReader.locate("writer.bsky.social")[1], "@writer.bsky.social"
        )

    def test_one_handle_typed_two_ways_is_one_source(self) -> None:
        bare = Source.owner("writer.bsky.social", kind="feed")
        at = Source.owner("@writer.bsky.social", kind="feed")
        self.assertEqual(bare.reader().name(), at.reader().name())
        self.assertTrue(bare.reader().name().startswith("feed-"))
        self.assertEqual(bare.kind, "feed")


class FeedReadTest(unittest.TestCase):
    def test_an_rss_feed_imports_its_full_text_not_its_summary(self) -> None:
        with serving({"": "rss.xml"}):
            found = preview("https://notes.example.com/feed")
            posts = list(reader("https://notes.example.com/feed").items())
        self.assertEqual(
            found,
            {
                "label": "Notes on Systems",
                "count": 1,
                "from": "2026-09-02",
                "to": "2026-09-02",
                "skipped": 1,
                "state": "connected",
            },
        )
        self.assertEqual(posts[0].title, "What I learned shipping a queue")
        self.assertEqual(posts[0].source_path, "https://notes.example.com/queue")
        # Paragraphs and line breaks survive; scripts, tags, and the double
        # escaping a feed puts on its entities do not.
        self.assertEqual(
            posts[0].content,
            "Back pressure is a product decision & not only an engineering one."
            "\n\nThe queue\nis the contract.",
        )

    def test_an_atom_entry_is_linked_by_its_alternate_href(self) -> None:
        with serving({"": "atom.xml"}):
            found = preview("https://ghost.example.com/atom")
            post = next(reader("https://ghost.example.com/atom").items())
        self.assertEqual(found["label"], "Ghost of a Blog")
        self.assertEqual(post.source_path, "https://ghost.example.com/writing/")
        self.assertEqual(post.dated, "2026-08-11")
        self.assertEqual(
            post.content, "Writing it down is how you find out whether you knew it."
        )
        # An empty <title> is no title: the first line stands in for it.
        self.assertEqual(post.title, post.content)

    def test_a_json_feed_titles_an_untitled_item_from_its_first_line(self) -> None:
        with serving({"": "feed.json"}):
            found = preview("https://micro.example.com/feed.json")
            posts = list(reader("https://micro.example.com/feed.json").items())
        self.assertEqual(found["count"], 2)
        self.assertEqual(
            posts[0].content, "Latency is a feature when it buys a better answer."
        )
        self.assertEqual(posts[1].title, posts[1].content)
        # An unparseable date is not a reason to drop the post.
        self.assertIsNone(posts[1].dated)
        self.assertEqual(found["to"], "2026-07-04")

    def test_malformed_social_data_is_unreachable_and_skip_is_per_item(self) -> None:
        with patch.object(FeedReader, "fetch", return_value=b'{"feed":[{"post":42}]}'):
            self.assertEqual(preview("@writer.bsky.social")["state"], "unreachable")
        payload = {
            "items": [
                {
                    "url": "https://example.com/post",
                    "content_text": "This post is for paid subscribers only. Subscribe to read.",
                },
                {
                    "url": "https://example.com/post",
                    "content_text": "A public version with a complete lesson that the owner wrote.",
                },
            ]
        }
        with patch.object(
            FeedReader, "fetch", return_value=json.dumps(payload).encode()
        ):
            found = preview("https://example.com/feed.json")
        self.assertEqual((found["count"], found["skipped"]), (1, 1))

    def test_a_paid_substack_post_is_skipped_and_counted(self) -> None:
        # Both truncations Substack serves: the free opening cut off with
        # "Read more", and the older subscribers-only prompt.
        with serving({"": "substack.xml"}):
            found = preview("https://writer.substack.com/feed")
            reading = reader("https://writer.substack.com/feed")
            kept = [post for post in reading.items() if reading.keeps(post)]
        self.assertEqual((found["count"], found["skipped"]), (1, 2))
        self.assertEqual(
            [post.title for post in kept], ["The market for private context"]
        )

    def test_bluesky_pages_and_skips_reposts_and_replies(self) -> None:
        routes = {"cursor=": "bluesky-2.json", "getAuthorFeed": "bluesky.json"}
        with serving(routes):
            found = preview("@writer.bsky.social")
            reading = reader("@writer.bsky.social")
            kept = [post for post in reading.items() if reading.keeps(post)]
        # The feed opens on a repost, which is neither the owner's memory nor
        # the name of their account.
        self.assertEqual(found["label"], "The Writer")
        self.assertEqual((found["count"], found["skipped"]), (1, 2))
        self.assertEqual(
            kept[0].source_path,
            "https://bsky.app/profile/writer.bsky.social/post/3lpost1",
        )
        self.assertEqual(kept[0].title, kept[0].content)
        self.assertEqual(kept[0].dated, "2026-09-10")

    def test_a_mastodon_address_is_looked_up_then_read(self) -> None:
        routes = {
            "lookup": "mastodon-account.json",
            "statuses": "mastodon-statuses.json",
        }
        with serving(routes):
            found = preview("@writer@hachyderm.io")
            posts = list(reader("@writer@hachyderm.io").items())
        self.assertEqual(found["label"], "The Writer")
        self.assertEqual((found["count"], found["skipped"]), (1, 1))
        self.assertEqual(
            posts[0].content,
            "An instance is a landlord, which is the part people learn late.",
        )
        self.assertEqual(posts[0].source_path, "https://hachyderm.io/@writer/111222333")

    def test_a_site_url_resolves_through_the_feed_it_advertises(self) -> None:
        with serving({"rss.xml": "rss.xml", "": "site.html"}):
            self.assertEqual(preview("notes.example.com")["label"], "Notes on Systems")

    def test_a_site_that_advertises_nothing_is_guessed_at(self) -> None:
        # `/feed` 404s, `/rss/` is the site again, `/atom.xml` is the feed.
        with serving({"/feed": "", "atom.xml": "atom.xml", "": "bare.html"}):
            self.assertEqual(preview("ghost.example.com")["label"], "Ghost of a Blog")

    def test_a_feed_that_never_stops_paging_stops_at_five_pages(self) -> None:
        with serving({"getAuthorFeed": "bluesky.json"}):
            self.assertEqual(preview("@writer.bsky.social")["count"], 5)
        routes = {"lookup": "mastodon-account.json", "": "mastodon-statuses.json"}
        with serving(routes), patch.object(FeedReader, "limit", 2):
            self.assertEqual(preview("@writer@hachyderm.io")["count"], 5)

    def test_the_states_that_are_not_connected(self) -> None:
        with serving({"": "empty.xml"}):
            self.assertEqual(preview("quiet.example.com")["state"], "nothing_found")
        # Nothing that answers is a feed, however well-formed it is: the
        # guesses run out and the source is unreachable rather than empty.
        for body in ("bare.html", "sitemap.xml", "mastodon-statuses.json"):
            with self.subTest(body=body), serving({"": body}):
                self.assertEqual(preview("html.example.com")["state"], "unreachable")
        with serving({}):
            found = preview("gone.example.com")
        self.assertEqual(found["state"], "unreachable")
        self.assertEqual(found["count"], 0)
        self.assertEqual(found["label"], "gone.example.com")

    def test_a_feed_with_a_dtd_entity_bomb_is_unreachable_not_a_hang(self) -> None:
        # `fromstring` is `defusedxml`'s, not the stdlib's: a feed carrying
        # its own DTD entity expansion (the "billion laughs" shape) must be
        # refused during parse, not expanded in memory. This exercises the
        # refusal end to end, not just that parsing raises.
        with serving({"": "entity-bomb.xml"}):
            self.assertEqual(preview("bomb.example.com")["state"], "unreachable")


class FeedImportTest(LoreTestCase):
    def test_guid_and_anonymous_rss_items_do_not_overwrite_each_other(self) -> None:
        body = """<rss><channel><title>Notes</title>
          <item><guid>first</guid><description>First full lesson from an RSS item without a link.</description></item>
          <item><guid>second</guid><description>Second full lesson from an RSS item without a link.</description></item>
          <item><description>Third full lesson from an RSS item without an identity.</description></item>
          <item><description>Fourth full lesson from an RSS item without an identity.</description></item>
        </channel></rss>""".encode()
        with patch.object(FeedReader, "fetch", return_value=body), Store() as store:
            registry = sources_module.Registry(store)
            entry = registry.add("https://notes.example.com/rss", kind="feed")
            self.assertEqual(entry["imported"], 4)
            paths = [memory.source_path for memory in store.search("full lesson")]
            self.assertEqual(len(set(paths)), 4)
            report = registry.read([str(entry["name"])])[0]
            self.assertEqual((report["added"], report["unchanged"]), (0, 4))

    def test_a_feed_is_added_read_and_re_read_from_anywhere(self) -> None:
        with serving({"": "rss.xml"}), Store() as store:
            entry = sources_module.Registry(store).add(
                "https://notes.example.com/feed", kind="feed"
            )
            self.assertEqual(entry["kind"], "feed")
            self.assertEqual(entry["label"], "notes.example.com")
            self.assertEqual(entry["locator"], "https://notes.example.com/feed")
            self.assertEqual(entry["state"], "connected")
            self.assertEqual(entry["imported"], 1)
            memory = store.search("back pressure")[0]
            self.assertEqual(memory.source_path, "https://notes.example.com/queue")
            # A post is identified by its URL, so where the CLI happened to be
            # run from cannot turn a re-read into a second copy.
            self.addCleanup(os.chdir, os.getcwd())
            os.chdir(self.tmp.name)
            self.assertEqual(sources_module.Registry(store).read()[0]["unchanged"], 1)
            self.assertEqual(store.counts()["private"], 1)

    def test_a_feed_that_cannot_be_reached_is_not_added(self) -> None:
        with serving({}), Store() as store:
            with self.assertRaises(sources_module.SourceError):
                sources_module.Registry(store).add("gone.example.com", kind="feed")
            self.assertEqual(
                [e for e in sources_module.Registry(store).entries() if e["owned"]], []
            )

    def test_a_label_the_owner_gave_wins_over_the_publication_title(self) -> None:
        with serving({"": "rss.xml"}), Store() as store:
            entry = sources_module.Registry(store).add(
                "notes.example.com", "My blog", kind="feed"
            )
            self.assertEqual(entry["label"], "My blog")


class FeedCommandTest(LoreTestCase):
    def json_command(self, *argv: str) -> object:
        with captured() as output:
            self.assertEqual(cli.main([*argv, "--json"]), 0)
        return json.loads(output.getvalue())

    def test_a_feed_can_be_previewed_added_and_listed(self) -> None:
        with serving({"": "rss.xml"}):
            found = self.json_command(
                "sources", "preview", "--feed", "https://notes.example.com/feed"
            )
            self.assertEqual(found["label"], "Notes on Systems")
            self.assertEqual(found["count"], 1)
            added = self.json_command(
                "sources", "add", "--feed", "https://notes.example.com/feed"
            )
        listed = self.json_command("sources", "list")
        self.assertEqual(listed[-1]["name"], added["name"])
        self.assertEqual(listed[-1]["kind"], "feed")

    def test_an_unreachable_feed_exits_two_with_one_line(self) -> None:
        with (
            serving({}),
            captured(),
            patch("sys.stderr", new_callable=StringIO) as stderr,
        ):
            self.assertEqual(
                cli.main(["sources", "add", "--feed", "gone.example.com"]), 2
            )
        self.assertEqual(stderr.getvalue(), "lore: can't reach gone.example.com\n")

    def test_a_folder_preview_is_labelled_too(self) -> None:
        root = Path(self.tmp.name) / "vault"
        root.mkdir()
        (root / "note.md").write_text(
            "# Note\n\nA note long enough to be a memory here."
        )
        self.assertEqual(
            self.json_command("sources", "preview", "--folder", str(root))["label"],
            "vault",
        )


if __name__ == "__main__":
    unittest.main()
