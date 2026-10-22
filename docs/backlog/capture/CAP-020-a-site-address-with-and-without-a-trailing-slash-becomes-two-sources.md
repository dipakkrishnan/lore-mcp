---
id: CAP-020
title: "Bug: a site address with and without a trailing slash becomes two sources"
priority: P1
effort: S
component: capture
status: in-review
related: [CAP-005, CAP-008, CAP-018, STO-003, CLI-010]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

`Reader.name()` promises "every spelling of one place is one source"
(`lore/sources.py:179-182`) and digests the locator. `FeedReader.locate`
(`:663-672`) keeps what was typed after adding `https://`, so
`https://tidewell-notes.pages.dev` and `https://tidewell-notes.pages.dev/`
digest to `blog-f601edab` and `blog-2d95eeb6` (verified offline, R-06):
an owner who connects the site twice with a slash in between gets two
sources and every post imported twice. `MediumFeed.locate` already
normalises (`rstrip("/")`, `:888`); `BlueskyFeed` strips too; only
`SiteFeed` (Substack, Blog) does not. The promise holds for handles and
folders (`test_sources.py:306`) and is untested for sites.

## Proposed approach

Failing test first, then normalise in `FeedReader.locate` for the
site-URL branch.

### Files

- change `lore/sources.py` (`FeedReader.locate`)
- change `tests/test_feed.py`
- change `docs/connectors.md` if it states the spelling rule (add "a
  trailing slash, and the scheme's default port, are not a different
  place")

### Behaviour

In `FeedReader.locate`, after building `url`: parse with `urlsplit`;
lower-case the host; drop a trailing `/` when the path is `/` or ends
with `/` (keep the query, keep a path like `/writing/` as `/writing` —
`test_feed.py:116` asserts `source_path` keeps the fetched URL, which is
`item.source_path`, not the locator, so it is unaffected; verify); drop
`:443` for https and `:80` for http; rebuild with `urlunsplit`. The
label (`netloc`) is the normalised host.

### Test design (`tests/test_feed.py`)

1. `test_a_trailing_slash_and_case_do_not_make_a_second_source` (fails
   first): for `SiteFeed` and each of `("https://notes.example.com",
   "https://notes.example.com/", "NOTES.example.com", "https://notes.example.com:443/")`,
   `Source.owner(x, kind="feed", connector="blog").reader().name()` is the
   same string; the stored `locator` is `https://notes.example.com`.
2. `test_a_path_is_still_part_of_the_place`:
   `https://ghost.example.com/writing` and `https://ghost.example.com`
   remain different names; `.../writing/` equals `.../writing`.
3. `test_connecting_the_slash_spelling_after_the_bare_one_is_a_re_read`:
   `Registry.add(bare)` then `Registry.add(slash)` with `serving({...})`
   → second call returns the same `name`, `owned` has one entry, memory
   count unchanged (the idempotent re-add path at `:1458-1461`).
4. Existing locator table (`test_feed.py:57`) is updated where it pinned
   a trailing slash being kept; if `test_feed.py:320/356` assert digests
   for specific spellings, update those values and say so in the test.

### Migration note

A source connected before this change with a slash keeps its stored
`name` (the registry keys by stored name, not by recomputing), so no
existing library changes; only new connects normalise. State this in the
PR and in `## Notes` here after implementation.

## Acceptance criteria

- [ ] Test 1 fails on current `main` (two names) and passes after the
      change; tests 2-3 pass.
- [ ] `SiteFeed`, `MediumFeed` and `BlueskyFeed` all produce one name per
      place across the spellings listed; `FeedLocatorTest` documents the
      full table.
- [ ] No existing test's expected count or key changes except the ones
      that pinned the slash (called out in the diff).
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-05 (locator spellings, trailing-slash identity), C-03 `name`,
C-10 `locate`, C-11; R-06.

Flakiness/safety: pure string handling; `serving()` stub for test 3.
