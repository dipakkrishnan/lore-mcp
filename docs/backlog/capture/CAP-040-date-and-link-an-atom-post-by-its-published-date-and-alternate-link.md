---
id: CAP-040
title: Date and link an Atom post by its published date and alternate link, whatever order the feed writes them in
priority: P2
effort: S
component: capture
status: in-review
related: [CAP-005, CAP-008, CAP-018, CAP-020, CAP-023]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-27
updated: 2026-10-27
---

## Problem

`FeedReader._item` (`lore/sources.py`) reads an entry's date with
`_field(entry, "pubDate", "published", "updated", "date")` and its link with
`_field(entry, "link")`. `_field` returns the first child *in document order*
whose tag is any of the names. The tuple is not a priority list, and `rel` is
never looked at. That causes two problems:

- **The wrong date.** WordPress's Atom feed (`/feed/atom/`) writes `<updated>`
  before `<published>`. A post written in 2023 and edited on 2026-10-20 is
  imported dated `2026-10-20`. `Store.put` only uses `dated` when it inserts a
  row, so the memory keeps the wrong date for good. The same thing happens
  when an RSS item carries `atom:updated` before `pubDate`, because namespace
  prefixes are stripped.
- **The wrong link.** Blogger's Atom feed, which is the first feed a blogspot
  page advertises, writes two `rel="replies"` links, then `rel="edit"`, then
  `rel="self"`, and only then `rel="alternate"`. Every Blogger post is imported
  with the comments feed as its `source_path`, for example
  `https://x.blogspot.com/feeds/2/comments/default`, and with that URL as its
  key. With comments turned off, the first link is `edit`/`self`, which is
  still wrong. That link is the provenance the owner, and any buyer of a piece
  built on it, follows back to the post.

Both reproduce on feafd45 by patching `FeedReader.fetch` with a
WordPress-order and a Blogger-order entry.
`test_an_atom_entry_is_linked_by_its_alternate_href` passes only because
`tests/fixtures/feeds/atom.xml` has a single link.

## Proposed approach

- Give the date lookup a real priority: `published`, then `pubDate`, then
  `date`, then `updated`, whatever their order in the document.
- Read an Atom link by `rel`: `alternate`, where a link with no `rel` counts
  as `alternate` (RFC 4287). Fall back to the first link only if no alternate
  exists.
- Choose a key strategy before changing `source_path`. Today the key is the
  first link, and `Store.put` matches on `source_key` alone. If the key
  changes, every Blogger post re-reads as a new memory and the old one is
  never removed. Options:
  - (a) Key Atom entries by `<id>`. This is stable, and the `ponytail`
    comment in `_item` already asks for it, but it changes keys for every
    Atom feed, so it needs a migration.
  - (b) Keep the old first-link key and change only `source_path`.
  - (c) Rewrite `source_key` for existing rows once.

## Acceptance criteria

- [ ] An Atom entry with `<updated>` before `<published>` is dated by
      `<published>`. An entry with only `<updated>` is still dated by it. An
      RSS item with `atom:updated` before `pubDate` is dated by `pubDate`. The
      existing feed tests are unchanged.
- [ ] An Atom entry whose `rel="alternate"` link follows `replies`, `edit` and
      `self` links gets the alternate href as `source_path`. A link without
      `rel` is treated as `alternate`.
- [ ] A Blogger-order feed that was imported before the fix and is read again
      after it adds no duplicate memory. Whatever key strategy is chosen is
      stated in the PR.
- [ ] A source with `since` set skips an old post that was edited recently.
      Today the edit date gets it past the `since` filter.
- [ ] Tests in `tests/test_feed.py` use a WordPress-order fixture and a
      Blogger-order fixture.

## Notes

Filed from the 2026-10-27 ideation pass (lore-worker).

Reach: Jekyll (jekyll-feed), Ghost and Hugo (RSS), and Substack and Medium
(RSS with `pubDate` first) are unaffected. WordPress is hit only when the
owner pastes `/feed/atom/`: the site advertises RSS2 at `/feed/`, which is
the first guess. Blogger is hit by default, which arguably makes the link
half P1.

Two limits of the fix:

- **The date fix is forward-only.** The update path in `Store.put` never
  touches `created_at`, so memories already imported from a WordPress Atom
  feed stay misdated unless a repair is added.
- **Option (b) doesn't repair existing memories.** `Store.put` returns
  `unchanged` before writing `source_path` whenever the content fingerprint
  matches, so Blogger memories imported before the fix keep the comments URL.
  A repair is needed if those should be corrected.

The body choice (`encoded`/`content`/`description`/`summary`) is unaffected:
its loop already runs over the names in priority order. `TasteFeed`,
Letterboxd and Goodreads only call `_field` with single names, so they are
unaffected too.
