---
id: CAP-008
title: Connect Medium, Bluesky and any blog feed
priority: P1
effort: S
component: capture
status: completed
related: [CAP-005, CAP-003, STO-003]
blockers: []
dependencies: ["CAP-005 for FeedReader"]
github_issue: null
created: 2026-09-27
updated: 2026-09-27
---

## Problem

`FeedReader` (`CAP-005`) already reads Medium, Bluesky and any RSS, Atom or
JSON feed, but the catalog offers only Substack. A writer on Medium, Bluesky,
Ghost, WordPress, Beehiiv or a personal blog has nowhere to click, and the
Substack field quietly takes a Bluesky handle and labels it Substack.

## Proposed approach

Three `Connector` subclasses next to `Substack`, each with a mark: Medium
(a `@name` becomes `medium.com/feed/@name`), Bluesky (a handle, bare name or
profile link), and "Blog or newsletter" (any site or feed address). Each
connector takes only its own kind of input, through a small `FeedReader`
subclass that overrides `locate`; Substack and the blog connector refuse a
handle. Mastodon and podcasts stay out: few target writers, and nothing asks.

## Acceptance criteria

- [x] The catalog lists Medium, Bluesky and Blog or newsletter, each with a
      bundled mark and a plain placeholder.
- [x] `@name`, `medium.com/@name` and `name.medium.com` all connect Medium.
- [x] `name`, `name.bsky.social` and a `bsky.app/profile/…` link all connect
      Bluesky; a web address or Mastodon address is refused before any read.
- [x] Substack and Blog or newsletter refuse a handle.
- [x] The `connectors` edge scenario connects Medium and a blog from fixtures
      and sees Bluesky refuse a web address.

## Notes

Medium's feed holds only the ten most recent stories; a full backfill is the
Medium export zip, not built. Checked against live feeds on Sep 27: `@ev` on
Medium (10 stories), `bsky.app` on Bluesky (198 posts read), ghost.org/blog
and simonwillison.net as blogs. Bluesky has no fixture in the edge scenario
because its API host is fixed; the unit test serves `bluesky.json` instead.
