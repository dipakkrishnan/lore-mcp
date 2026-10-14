---
id: CAP-032
title: Connect Letterboxd and Goodreads through their public feeds
priority: P2
effort: S
component: capture
status: completed
related: [CAP-005, CAP-008, CAP-033, CAP-034]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-10-14
---

## Problem

A lot of what people know shows up as taste: films rated and reviewed, books
shelved and finished. When Lore can already reach it, the owner doesn't have
to write it down to draft from it. Some of it is worth paying for, such as a
critic's ranked list. Most of it is context that makes the owner's drafts
better.

## Proposed approach

Two `Connector` subclasses on the existing feed reader:

- Letterboxd: `letterboxd.com/<user>/rss/` carries diary entries with the
  rating, rewatch flag and review text. The owner types a username or
  profile link.
- Goodreads: the per-shelf RSS (`goodreads.com/review/list_rss/<id>?shelf=read`)
  carries the rating, the review and the date read. The owner pastes a profile
  link, and Lore finds the user id.

Each item keeps the rating and the review; an entry with neither is skipped as
empty. Each connector ships a mark at `assets/<id>.svg` with its provenance.

## Acceptance criteria

- [x] Both appear in `lore sources catalog` and in the Connectors tab.
- [x] A username, a profile link and a feed link all resolve to one source.
- [x] Ratings and reviews survive into the kept items; a refresh keeps only
      new entries.
- [x] Contract tests against recorded feeds.

## Notes

- Both read with `TasteFeed`, a `FeedReader` that overrides `_item`: the kept
  text says what was watched or read, when, and the rating ("Rated it 3.5 out
  of 5."), then the review. An entry with no rating and no review is skipped.
  Entries are keyed by the feed's guid, so a rewatch of one film is its own
  memory.
- Letterboxd's feed also carries the owner's lists (a ranked list is the kind
  of thing worth selling); they are kept as ordinary posts.
- Goodreads has no username in its addresses: a user id, a profile link
  (`/user/show/<id>-name`), a shelf link or the feed link all resolve to one
  source. A vanity link (`goodreads.com/name`) is refused in plain words, since
  resolving it needs a network hop. A feed link's `key` (needed for a private
  profile) is kept, so that spelling is its own source.
- Windows: Letterboxd gives the latest fifty diary entries plus lists,
  Goodreads the hundred books most recently put on the read shelf.
- Marks are Simple Icons 16.32.0 paths (CC0) in each brand's recorded colour.
- `letterboxd` and `goodreads` were added to the usage allowlist; the relay
  counts them once it is redeployed with the new contract.
