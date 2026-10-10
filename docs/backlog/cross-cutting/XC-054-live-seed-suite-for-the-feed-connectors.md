---
id: XC-054
title: Live seed suite for the feed connectors (blog, Substack, Medium, Bluesky)
priority: P3
effort: M
component: cross-cutting
status: in-review
related: [XC-048, XC-049, XC-050, CAP-018, CAP-019, XC-008, XC-056]
blockers: [XC-049]
dependencies: ["The four fictional seed accounts stay published (see support/seed/manifest.json accounts)"]
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

Five vendor surfaces can drift with no alarm (R-03): Cloudflare Pages
headers and redirects, Substack's feed path and paywall phrasing, Medium's
`generator` string and ten-story window, Bluesky's `feedViewPost` shape
and public API rate limits, and each site's willingness to answer Lore's
user agent. The recordings pin what was true on 2026-09-30; only a real
fetch can say whether it still is. Nothing runs one. The seed accounts
exist for exactly this and are not used by any automation.

## Proposed approach

One opt-in file per the `XC-048` rules, guarded by `XC-049`, using the
manifest as the only source of locators and expected counts.

### Files

- add `tests/test_live_feeds.py`
- change `.github/workflows/tests.yml` only if `XC-048`'s
  `python-live-seed` job needs a longer timeout

### Test design

`setUpClass`: `liveguard.seed_home()`; skip the whole class unless
`liveguard.enabled()`. Each connector is one test so a single outage
fails one line, not the file.

For `c in (blog, substack, medium, bluesky)`, `locator =
liveguard.seed_locator(c)`:

1. `test_live_<c>_preview_matches_the_manifest`:
   `sources_module.preview(locator, "feed")` (the reader is built from
   the connector's `locate`, so call
   `Source.owner(locator, kind="feed", connector=c).reader()` directly and
   count with `reader.keeps`) → `kept == manifest.sources[c].expected.kept`
   and `skipped == expected.dropped`; state `connected`.
   Feed lag tolerance: retry up to 3 times with 20 s sleeps only when the
   count is *lower* than expected; a higher count is a hard failure (a
   stranger posted, or a stretch story landed without a manifest update).
2. `test_live_<c>_connect_and_read_again`: `cli.main(["sources",
   "connect", c, locator, "--json"])` in the temp home →
   `imported == expected.kept`; `read` → all `unchanged`; every kept
   canary from the manifest returns one hit from the new source
   (reuse `XC-051`'s canary walk as a helper function if it is factored
   out; otherwise inline it).
3. `test_live_<c>_answers_lore_with_the_expected_headers` (blog only):
   `urllib.request` with `FeedReader.agent` → status 200,
   `content-type` starts with `application/xml` or `application/rss+xml`;
   a request for `/posts/<slug>.html` follows a 308 to `/posts/<slug>`
   (F-bl-02). Record the observed values in the assertion message, not
   in a file.
4. `test_live_recordings_have_not_drifted`: `liveguard.drift(c, tmp)` for
   each connector; an empty list passes; a non-empty list **fails with
   the list of changed URLs** and the instruction to re-record through
   `record.py --check` + `hygiene_check.py`. This is the drift alarm.
5. `test_live_bluesky_label_is_what_the_profile_shows` (R-08): the
   reader's `label` after `probe()` equals either the manifest `label`
   or `@<handle>`; assert which and print it, so the open question in
   the map gets an answer on every run.
6. `test_live_seeded_items_are_still_there` (W-22 live presence): every
   manifest item for the four connectors with `expected == kept` has its
   canary in the fetched feed bytes; dropped/excluded ones may or may not.

### Non-scope

Hosted apps (`XC-055`), publishing or deleting anything on the seed
accounts (never), Medium's ten-story rollover (needs md-05..11 published;
tracked in the Notes of `XC-056`).

## Acceptance criteria

- [ ] `tests/test_live_feeds.py` is skipped by default and runs under
      `LORE_LIVE_SEED=1` with a temp `LORE_HOME` only (refuses otherwise,
      through `liveguard`).
- [ ] Each of the four connectors has its own preview/connect/read tests
      asserting the manifest's `expected` counts and canaries.
- [ ] A drift in any committed recording fails one clearly named test that
      lists the changed request URLs.
- [ ] The `python-live-seed` workflow job runs this file green once by
      manual dispatch (paste the run URL in `## Notes`).
- [ ] No handle or site name appears in the test source; locators come
      from `liveguard.seed_locator`.
- [ ] `uv run python -m unittest discover -s tests` (default, skipped),
      ruff check, ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-05, W-06, W-07, W-08 (live rows), W-19 (feed lag), W-22 (live
presence), W-25 (counts, canaries, drift); R-03, R-08, R-09 (Medium and
Bluesky items dated the seeding day; assert `dated` is not None, not a
value).

Flakiness/safety: retries only on under-count; 20 s reader timeout
already bounds each fetch; the suite is never a PR gate. Public reads
only, no credentials of any kind. Bluesky's public API rate limit was
not hit during seeding (ASSUMED); if a 429 appears, the test must report
it as "rate limited", not as a regression (see `CAP-023` for the 429
mapping).
