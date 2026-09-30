---
id: CAP-019
title: Contract-test the Bluesky reader against the recorded author feed, its request URL and its label
priority: P1
effort: S
component: capture
status: in-review
related: [CAP-008, CAP-018, XC-050, XC-054, CAP-023, XC-048]
blockers: [XC-048]
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

`tests/fixtures/live/bluesky/01-app-bsky-feed.json` is one real
`getAuthorFeed` page for the seed account (DID scrubbed, F-bs-02): 7
entries — 6 posts and 1 repost; the reply (bs-07) never arrives because
of the server-side `posts_no_replies` filter. Verified offline: the reader
keeps 5 and drops 2 (the repost, and the 23-character post), and the
recording's `displayName` is `""`, so the label stays `@<handle>` — not
the "Priya @ Tidewell" the manifest expects (R-08). None of that is
asserted, `test_feed.py`'s Bluesky routes match by URL fragment so the
`filter=posts_no_replies&limit=40` query is never checked, and
`BlueskyPost`'s `AliasPath("post","record",…)` paths are validated
against a hand-written fixture, not the current `feedViewPost` shape.

## Proposed approach

### Files

- add `tests/test_contract_bluesky.py`
- change `tests/test_feed.py` (request-URL assertion; two lines in the
  existing paging test)

### Test design (`tests/test_contract_bluesky.py`)

Build the reader from `meta.json`'s `locator` (`@<handle>`, used only via
the file, never spelled in the test) and answer `fetch` from the recording
on exact URL match, recording every URL asked.

1. `test_the_request_is_the_public_author_feed_without_replies`: the one
   URL asked equals
   `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=<handle>&filter=posts_no_replies&limit=40`
   where `<handle>` is `meta.locator.lstrip("@")`; parse with `urlsplit`
   and compare the query dict, so parameter order is not pinned.
2. `test_counts_and_what_was_dropped`: found 7, kept 5, dropped 2; the
   dropped entries are one with `reason` present (repost of bs-02, same
   text as a kept post) and one whose text is under 40 characters (bs-06);
   no entry has `record.reply` (the server filtered it — pin as
   *observed*, with a comment that a reply arriving would also be
   dropped by `sources.py:815-818`).
3. `test_every_kept_post_has_its_canary_and_key`: canaries bs-01..05 each
   appear in exactly one kept item; each key is
   `https://bsky.app/profile/<handle>/post/<rkey>` where `<rkey>` matches
   the `remote.id` tail in `manifest.json` (`3mwqe2lgj5o2t` etc.).
4. `test_the_label_is_the_handle_when_the_display_name_is_empty` (R-08):
   `reader.label == "@" + handle`; comment that the manifest `label` is the
   planned display name and `XC-054` reports the live value.
5. `test_the_alias_paths_exist_in_the_current_feed_view_post_shape`: for
   every `BlueskyPost` field with an `AliasPath`, walk the path in the first
   raw `feed[0]` dict and assert it resolves (`post.record.text`,
   `post.record.createdAt`, `post.uri`, `post.author.handle`,
   `post.author.displayName`, `reason`, `post.record.reply`); also assert
   `reason["$type"] == "app.bsky.feed.defs#reasonRepost"` on the repost
   entry, since the reader keys off `reason` presence only.
6. `test_dates_are_the_seeding_day` (R-09): every kept `dated ==
   "2026-09-30"`.
7. `test_a_facet_link_and_a_tag_survive_as_text`: bs-04's content contains
   the blog URL text and `#mobilegrooming`; bs-05's content contains
   `<angle>` and `🚐` verbatim (not HTML-decoded away).

`tests/test_feed.py`

8. In the existing paging test (`:212`), assert the second fetch URL
   contains `cursor=` with the first page's cursor URL-quoted, and both
   contain `filter=posts_no_replies` and `limit=40`.

## Acceptance criteria

- [ ] `tests/test_contract_bluesky.py` reads only
      `tests/fixtures/live/bluesky/**` and `support/seed/manifest.json`,
      covers tests 1-7, and never spells the handle.
- [ ] The request query is asserted as a dict (`actor`, `filter`, `limit`)
      in both the contract and the paging test.
- [ ] Removing `filter=posts_no_replies` from `sources.py:801-804` fails
      test 1 and test 8.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-07 (request URL shape, recorded 7/5/2, label with empty
displayName, `AliasPath` contract, dating), C-09, C-10 `_bluesky`/`_post`,
C-11 `BlueskyFeed`; F-bs-01, F-bs-02, R-03, R-08, R-09.

Flakiness/safety: file-only; the DID in the recording is
`did:plc:REDACTED` and must stay that way — never assert on it.
