---
id: CAP-005
title: Read any feed the owner writes to
priority: P1
effort: S
component: capture
status: completed
related: [CAP-003, STO-003, ONB-007, APP-120]
blockers: []
dependencies: ["STO-003 for the source kind and state"]
github_issue: null
created: 2026-09-17
updated: 2026-09-17
---

## Problem

`CAP-003` names Substack's public `/feed` as the free path to an owner's
posts, but the same mechanism covers far more: every Ghost site, Medium
(`medium.com/feed/@user`), any blog with RSS or Atom, and, with one lookup
call each, Bluesky and Mastodon through their public APIs. Building it as
"the Substack connector" leaves the general case on the table for no
saving.

## Proposed approach

The `feed` kind from `STO-003`. The owner pastes a URL or handle; Lore
resolves it on blur and shows what it found (publication title, post count,
most recent date) before connecting. Resolution order: a direct feed URL;
a site URL with feed autodiscovery (`<link rel="alternate">`, then `/feed`,
`/rss/`, `/atom.xml`, `/feed.json`); a Bluesky handle via
`app.bsky.feed.getAuthorFeed` on `public.api.bsky.app`; a Mastodon
`@user@instance` via `/api/v1/accounts/lookup` then `/statuses`. Full text
comes from `content:encoded` where present. Paid Substack posts arrive
truncated and are skipped with the count saying so. Fetch with a real user
agent at human pace and treat a 403 as "couldn't reach that feed", not a
bug.

## Acceptance criteria

- [x] Pasting a Substack URL, a Ghost or Medium URL, a Bluesky handle, or a
      Mastodon address each shows a preview and imports the owner's own
      posts as private memories linking to the post URL.
- [x] Reposts, replies, and truncated paid posts are skipped and counted.
- [x] A feed that cannot be reached ends in a named state with a retry.
- [x] Nothing imported is published without the usual approval.

## Notes

Medium's feed caps at about ten recent posts; the full backfill is the
export zip (`CAP-006` pattern). Bluesky's feed is not an archive; a full
one needs PDS resolution and CAR parsing, out of scope. Reddit's `.json`
endpoints are gone (403 since about May 2026), so Reddit is not a feed.

Built as `FeedReader` in `lore/sources.py` and `--feed` in `lore sources
preview|add` — the Python side only. What the owner pastes into is the app's
source catalog row, which is `APP-120`/`APP-122`; until then the preview is
`lore sources preview --feed URL --json`, which now carries a `label` (the
publication title) so the app can show what it found before connecting.
Folder previews carry the same key, from the folder's basename.

A feed that cannot be reached previews as `state: "unreachable"` with a count
of 0, and `add` refuses it (exit 2, `lore: can't reach <what you typed>`), so
the retry is re-running the same command; the app's retry affordance rides on
that state. Imports go through `scan`/`store.put` exactly as a folder does, so
a post is a private memory and publication still needs the owner.

How a paid Substack post actually looks (checked against a real feed, Astral
Codex Ten, Sep 17): a fully paid post's `content:encoded` is the literal string
`Read more` — nine characters, so the sentence floor drops it before any
paywall rule does. A partially paywalled post is the free opening followed by a
trailing `Read more` paragraph, which is what `FeedReader.paywall` matches
(along with the older "This post is for paid subscribers" prompt). On 19 free
ACX posts it fired zero times.

Bluesky's `getAuthorFeed` can open on a repost, so the publication title has to
come from the first entry that is *not* reposted or the label ends up being
whoever the owner last boosted (`@bsky.app` previewed as "The A.V. Club" before
that fix). Most of what Bluesky skips is not reposts but the 40-character
sentence floor: `@bsky.app` previews as 88 kept, 110 skipped.

Two contract deviations, both small and both worth reconciling with `APP-120`
and `CAP-006`: `preview` gained the `"label"` key for every kind, and `Reader`
gained a `key(item)` seam because `_import` identified a memory by
`Path(source_path).resolve()`, which for a URL resolves against the current
working directory and would have made a re-read from a different directory a
second copy. `FeedReader` returns the post URL unchanged.

Not built here: Medium backfill (the export zip, `CAP-006`), a feed refresh
schedule (reads happen on `lore sources read`/`sync`), and any HTML beyond
paragraphs and line breaks — images, embeds and links become their text.

App side, 2026-09-17, on branch `app-catalog-feed-export`. "A newsletter or
blog" is the second entry in Settings → Where memories come from → Add a
source, said as "Substack, Ghost, Medium, or any site with a feed. Bluesky and
Mastodon by handle." Connect opens one address field (placeholder
`yourname.substack.com`) that resolves on blur or Enter through `sources
preview --feed`, says "Checking…" while it looks, and then shows the
publication title, the post count and the date range under the field. Only a
`connected` preview un-greys Connect, which sends the same Last 12 months /
Everything window a folder gets. `unreachable` reads "Lore couldn't reach that.
Check the address and try again." and `nothing_found` "That feed has nothing to
read yet." A connected row reads "Reads your own posts, not your feed."; an
unreachable one offers "Try again", which re-previews the address where it
stands and re-reads it, rather than making the owner retype it.

One gap worth its own item: `sources add` takes `--label`, but the app does not
pass one, so a feed's row is named from its locator (`yourname.substack.com`)
even though the preview it just showed knew the publication title. The edge
scenario passes `--label` when it seeds, which is why its row reads "Notes on
Systems" and not an address.
