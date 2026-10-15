---
id: CAP-032
title: Connect Letterboxd and Goodreads through their public feeds
priority: P2
effort: S
component: capture
status: ready
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

- [ ] Both appear in `lore sources catalog` and in the Connectors tab.
- [ ] A username, a profile link and a feed link all resolve to one source.
- [ ] Ratings and reviews survive into the kept items; a refresh keeps only
      new entries.
- [ ] Contract tests against recorded feeds.
