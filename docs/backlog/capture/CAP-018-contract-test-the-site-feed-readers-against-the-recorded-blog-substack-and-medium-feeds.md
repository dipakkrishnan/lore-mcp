---
id: CAP-018
title: Contract-test the site feed readers against the recorded blog, Substack and Medium feeds
priority: P1
effort: M
component: capture
status: in-review
related: [CAP-005, CAP-008, XC-050, XC-054, CAP-020, CAP-023, XC-048]
blockers: [XC-048]
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

Three real feeds were recorded exactly as Lore fetched them
(`tests/fixtures/live/{blog,substack,medium}/`, each with `meta.json`
giving the fetch order), and no test parses them. The unit tests use
trimmed copies under `fixtures/feeds/`, so the things only the real
answers show are unasserted: Substack's feed lives at `/feed` and titles
the publication "tidewell lore" (F-ss-02); the blog's feed is reached
only through `<link rel=alternate href="/feed.xml">` because `/feed.xml`
is not in the guesses list; Medium appends an "Originally published at"
footer to every story (F-md-01), dates all four stories on the import day
(R-09) and double-escapes `content:encoded`; the connect label is the
host while preview shows the site title (F-bl-01). Every one of these can
change upstream, and today the first sign would be an owner's count
being wrong.

## Proposed approach

One contract file per the `XC-048` rules that builds each reader with the
recorded locator and answers `fetch` from the recording (through
`XC-050`'s `recorded_feed()` if merged; otherwise an inline patch that maps
`meta.json` `url_or_tool` → file, which is ten lines).

### Files

- add `tests/test_contract_feeds.py`

### Test design

Helper: `read(connector) -> (reader, kept, dropped)` builds
`Source.owner(meta["locator"], kind="feed", connector=connector).reader()`,
calls `probe()`, then partitions `items()` with `reader.keeps`.

Blog (`live/blog`, manifest expected 6 / 5 / 1):

1. `test_blog_counts_and_keys`: found 6, kept 5, dropped 1; kept keys
   (`item.key`) are `/posts/<slug>.html` links for
   `why-the-route-is-the-product`, `raising-the-price-without-losing-anyone`,
   `routes-ramps-van-life`, `the-first-forty-never-asked-for-calendar-sync`,
   `how-tidewell-started`; the dropped one is the short note.
2. `test_blog_discovery_went_through_the_advertised_link`: the patched
   fetch records the URLs asked; they are exactly
   `[locator, locator + "/feed.xml"]` in that order — no guess was tried.
   Also `_Html(01-index.html).links == ["/feed.xml"]`.
3. `test_blog_per_item_bodies`: bl-03 title `Routes & ramps: <van> life 🚐`
   (entities decoded); bl-04 content equals its `<description>` text
   (fallback); bl-05 content has no `<script>`/`<style>` text (take the
   strings from the corpus file); bl-01 content keeps list items as lines.
4. `test_blog_dates_are_the_posts_own`: `dated` values are exactly the
   manifest `dated` for bl-01..05 (`2026-05-06`, `2026-08-06`,
   `2026-06-18`, `2026-07-09`, `2026-02-20`).
5. `test_blog_labels`: `reader.label == "Tidewell Notes"` (site title, what
   preview shows) and `reader.locate(locator)[1]` is the host (what
   connect stores): F-bl-01 pinned as behaviour.

Substack (`live/substack`, expected 5 / 4 / 1):

6. `test_substack_counts_titles_and_dates`: 5 found, 4 kept, 1 dropped
   (`Housekeeping`); kept titles are ss-01..04's manifest titles; dates
   `2026-04-25`, `2026-08-12`, `2026-05-15`, `2026-06-29` (importer kept
   original dates, F-ss-01); keys are `…/p/<slug>` links.
7. `test_substack_feed_is_found_at_feed`: fetch order is
   `[locator, locator + "/feed"]`; `reader.label == "tidewell lore"`
   (F-ss-02; the manifest's `label: Tidewell Notes` is the *planned* value
   — assert the recording and leave a comment).
8. `test_substack_no_post_is_paywalled`: `dropped` contains no item whose
   content matches `FeedReader.paywall` (documents that the seed has no
   paid post; the regex itself is unit-tested in `test_feed.py:158`).

Medium (`live/medium`, expected 4 / 4 / 0):

9. `test_medium_counts_keys_and_footer`: 4 kept, 0 dropped; keys match
   `medium.com/@…/<slug>-<hex id>`; every content ends with a line
   containing `Originally published at` (F-md-01). Decide and pin: **keep**
   the footer (it is the owner's published text; stripping vendor
   footers is a separate product question).
10. `test_medium_dates_are_the_import_day`: all four `dated ==
    "2026-09-30"` (R-09). Comment: synthesis ordering will see them as
    simultaneous.
11. `test_medium_generator_gate_passes_on_the_real_feed`: `_field(channel,
    "generator") == "Medium"` on the recording (the string the gate at
    `sources.py:753` depends on).
12. `test_medium_double_escaped_html_decodes_once`: no `&amp;lt;` or `&lt;p&gt;`
    residue in any content; a `<p>` from the story is a newline, not text.

## Acceptance criteria

- [ ] `tests/test_contract_feeds.py` reads only `tests/fixtures/live/{blog,
      substack,medium}/**` and covers tests 1-12 with the counts above.
- [ ] Fetch order is asserted for blog and substack (no guesses were needed).
- [ ] Changing any recorded feed's `generator`, a `pubDate`, or the
      Substack `<title>` fails a named test.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-05 (contract rows: 5/4/1, label, keys, dates; index advertises
`/feed`), W-06 (4/4/0, footer, import-day dates, double-escaping,
generator), W-08 (6/5/1 per item, entities, description fallback,
script/style silenced), C-10, C-11, C-18, C-20 `_date`/`_field`;
F-bl-01, F-ss-01, F-ss-02, F-md-01, R-03, R-09.

Flakiness/safety: file-only. Recordings are scrubbed (`owner` replaces
the account holder's name in Medium's channel title, F-md-02); assert
`reader.label` for Medium against the scrubbed value in the file, not
against a name.

Sequencing: blocked by `XC-048` (file prefix). `CAP-020` (trailing-slash
identity) changes `locate`, not counts; `XC-054` re-runs these
expectations live.
