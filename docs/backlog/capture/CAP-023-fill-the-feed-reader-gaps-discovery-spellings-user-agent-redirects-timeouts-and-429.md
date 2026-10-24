---
id: CAP-023
title: Fill the feed reader gaps (discovery, Medium spellings, user agent, redirects, timeout, 429, empty feed)
priority: P2
effort: M
component: capture
status: in-review
related: [CAP-005, CAP-008, CAP-018, CAP-020, CAP-026, XC-054]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

`tests/test_feed.py` is thorough on parsing and thin on the edges the
seed run touched: Cloudflare Pages answers `/x.html` with a 308
(F-bl-02) and nothing tests that `fetch` follows one; the blog feed was
found only through a `<link rel=alternate>` and relative hrefs / the
`application/feed+json` type are not asserted in discovery; the
user-agent string `Lore/<version> (+https://yourlore.dev)`
(`sources.py:637`) that the seed sites were checked against is asserted
nowhere; `robots.txt` `Disallow: /` on the seed site is ignored by design
and undocumented; a 429 becomes `HTTPError → answered → "Couldn't find
posts at that address."`, which is misleading and unpinned; the 20 s
timeout has no test (the edge `/slow` case is a cancel test); adding an
empty feed is accepted as `nothing_found` in `Registry.add` but only
preview is tested; and a feed item whose content changes under the same
link is only tested for folders (`test_sources.py:145`). Medium's six
locator spellings are tested three at a time.

## Proposed approach

### Files

- change `tests/test_feed.py`
- change `lore/sources.py` only for the 429 message (below); everything
  else is tests

### Test design

1. `test_discovery_follows_relative_and_json_feed_links`: `site.html`
   variant with `<link rel="alternate" type="application/feed+json"
   href="feeds/main.json">` → the candidate asked is
   `urljoin(site, "feeds/main.json")` and the JSON Feed is parsed.
2. `test_all_six_medium_spellings_map_to_two_locators`: `@user`,
   `medium.com/@user`, `https://medium.com/@user/`, `user` (bare),
   `user.medium.com`, `https://user.medium.com/feed` → the first four give
   `https://medium.com/feed/@user` label `@user`; the last two give
   `https://user.medium.com/feed` label `user.medium.com` — and the two
   groups are different sources (name differs). Note: a bare `user`
   without `@` or `.` is currently treated as… (check `:887-890`; pin
   whatever it does and say so).
3. `test_the_user_agent_names_lore_and_its_site`: patch
   `urllib.request.urlopen` to capture the `Request`; assert
   `request.get_header("User-agent") == f"Lore/{__version__} (+https://yourlore.dev)"`
   and `timeout == 20` was passed.
4. `test_robots_is_never_fetched`: a site whose `robots.txt` says
   `Disallow: /` — the URLs asked never include `/robots.txt` and the
   feed is imported; docstring: Lore reads the owner's own site at their
   request.
5. `test_a_permanent_redirect_is_followed` (F-bl-02): a real
   `ThreadingHTTPServer` on `127.0.0.1:0` answering `308` with `Location:
   /feed.xml` for `/feed.xml.html`… simpler: `/` → 308 → `/index`, `/index`
   serves the corpus index, `/feed.xml` serves the feed; connect with the
   root URL → 5 kept (this exercises the real `fetch`, not the patch).
6. `test_a_rate_limit_is_reported_as_such` — **behaviour change**: an
   `HTTPError(429)` from the site (or from Bluesky's public API) should
   set state `unreachable` with `trouble` `"<label> is busy. Try again in
   a few minutes."` instead of `"Couldn't find posts at that address."`.
   Failing test first; implement by catching `HTTPError` with `code ==
   429` in `posts` (`:680`) and recording a `busy` flag `trouble` reads.
   Keep 404 → "Couldn't find …" (`:339`).
7. `test_a_slow_site_times_out_without_hanging`: patch
   `FeedReader.timeout = 0.2` and serve from a handler that sleeps 1 s →
   `probe()` is `unreachable` within 2 s (assert with `time.monotonic`).
8. `test_adding_an_empty_feed_is_accepted_as_nothing_found`: RSS with a
   channel and no items → `Registry.add` returns state `nothing_found`,
   `imported 0`, and the source is in `owned` (not refused like
   `unreachable`).
9. `test_a_changed_body_under_the_same_link_is_an_update`: first read
   with `rss.xml`, second with a copy whose first item's `content:encoded`
   differs → `updated 1`, memory content replaced, and a publication
   citing it is flagged (reuse the flagging assertion from
   `test_sources.py:161`).
10. `test_re_reading_a_feed_fetches_once` (perf tag): the second `read`
    makes exactly the same number of fetches as the first (one for a
    direct feed, two for a site) and hashes every item (`unchanged ==
    kept`).

## Acceptance criteria

- [ ] Tests 1-5 and 7-10 exist and pass; test 6 fails before the 429
      message change and passes after.
- [ ] The 429 wording is the only change under `lore/`; `docs/connectors.md`
      lists it with the other states' texts.
- [ ] Tests 5 and 7 use a `127.0.0.1` server bound to port 0 and finish
      in under 5 s each.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-06 (6 spellings), W-08 (relative/json discovery, robots, UA,
308), W-14 (feed content change → updated; perf fetch count), W-19 (429,
timeout, empty-feed add), C-10, C-11 `MediumFeed`, C-18, C-19, C-25;
F-bl-02, R-03.

Flakiness/safety: the timeout test uses a sub-second patched timeout;
the redirect server is local. No test reaches a real site.
