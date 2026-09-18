---
id: CAP-005
title: Read any feed the owner writes to
priority: P1
effort: S
component: capture
status: in-review
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

- [ ] Pasting a Substack URL, a Ghost or Medium URL, a Bluesky handle, or a
      Mastodon address each shows a preview and imports the owner's own
      posts as private memories linking to the post URL.
- [ ] Reposts, replies, and truncated paid posts are skipped and counted.
- [ ] A feed that cannot be reached ends in a named state with a retry.
- [ ] Nothing imported is published without the usual approval.

## Notes

Medium's feed caps at about ten recent posts; the full backfill is the
export zip (`CAP-006` pattern). Bluesky's feed is not an archive; a full
one needs PDS resolution and CAR parsing, out of scope. Reddit's `.json`
endpoints are gone (403 since about May 2026), so Reddit is not a feed.
