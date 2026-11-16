---
id: CAP-041
title: Keep a JSON Feed whose ids are numbers or whose items have a null or wrong-typed field
priority: P3
effort: S
component: capture
status: completed
related: [CAP-005, CAP-008, CAP-023]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-27
updated: 2026-11-14
---

## Problem

`FeedReader._json_feed` (`lore/sources.py`) validates the whole body as one
`JsonFeed`, and `FeedPost.id` is a `str`. Pydantic v2 does not coerce a number
to a string, so either of these fails validation for the whole body:

- a feed whose ids are numbers (`"id": 1001`), which JSON Feed 1.1 says a
  reader must coerce to a string;
- a single item with `"title": null`, or a feed-level `"title": null`.

When validation fails, `_json_feed` returns `None` ("not a feed"), discovery
falls through to its guesses, and the owner is told "Couldn't find posts at
that address." for a feed that is valid apart from that one field. RSS and
Atom handle a bad entry differently: they count it in `self.errors` and import
the rest.

Both cases reproduce on feafd45 by patching `FeedReader.fetch`. Each returns
`State.UNREACHABLE` with no posts.

## Proposed approach

- Coerce a numeric `id` to a string.
- Treat `null` as the field's default.
- Validate items one at a time, counting failures in `errors`.
- Keep a shape check, such as a `version` or `items` array, so that arbitrary
  JSON still returns `None` and discovery keeps working.

Mastodon also parses statuses with `FeedPost`
(`TypeAdapter(list[FeedPost])`) and pages on `statuses[-1].id`, so any change
to `FeedPost` must keep Mastodon's behaviour.

## Acceptance criteria

- [x] A JSON Feed item with `"id": 1001` imports, keyed by its `url` (or by
      `"1001"` when it has no url).
- [x] An item with `"title": null` imports, titled from its first line. A
      feed-level `"title": null` falls back to the source's label.
- [x] An item that still can't be read is counted in `errors` and the other
      items import.
- [x] A feed where every item fails returns `[]` with `errors` set, not
      `None`.
- [x] A JSON body that isn't a JSON Feed still returns `None`, so discovery
      goes on to the next candidate.
- [x] New tests in `tests/test_feed.py` pass, and the existing Mastodon and
      JSON Feed tests stay green.

## Notes

Filed from the 2026-10-27 ideation pass (lore-worker). CAP-023 test 1 only
asserts that a JSON Feed is *discovered*, not how it is validated.

**Prioritization (2026-11-12):** Priority P3 (was P2). Promoted to ready:
unblocked, criteria checkable, and the premise checked against the code.

**Done (2026-11-14):** `_json_feed` now checks only the envelope (a JSON
object with an `items` array) and validates each item with `FeedPost` on its
own; an item that fails is counted in `errors` and the rest import, so a feed
whose every item fails is `[]` (nothing found), not `None`. `FeedPost` reads a
null text field as `""` and a numeric `id` as its string (JSON Feed 1.1); a
feed-level `title` that is null or not a string leaves the source's label.
Side effects worth knowing: a body like `{"items": [1, 2]}` now stops
discovery as an empty feed instead of falling through to the guesses (what
the fourth criterion asks), and a Mastodon status with `"url": null` now
imports keyed by its id instead of failing its page (`AliasChoices` takes the
present-but-null `url`, not `uri`). Left as they were: an item with neither
`url` nor `id` is still keyed by `""`, and `MediumFeed`'s generator check
still does not apply to a JSON body.
