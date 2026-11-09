---
id: CAP-041
title: Keep a JSON Feed whose ids are numbers or whose items have a null or wrong-typed field
priority: P2
effort: S
component: capture
status: in-review
related: [CAP-005, CAP-008, CAP-023]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-27
updated: 2026-10-27
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

- [ ] A JSON Feed item with `"id": 1001` imports, keyed by its `url` (or by
      `"1001"` when it has no url).
- [ ] An item with `"title": null` imports, titled from its first line. A
      feed-level `"title": null` falls back to the source's label.
- [ ] An item that still can't be read is counted in `errors` and the other
      items import.
- [ ] A feed where every item fails returns `[]` with `errors` set, not
      `None`.
- [ ] A JSON body that isn't a JSON Feed still returns `None`, so discovery
      goes on to the next candidate.
- [ ] New tests in `tests/test_feed.py` pass, and the existing Mastodon and
      JSON Feed tests stay green.

## Notes

Filed from the 2026-10-27 ideation pass (lore-worker). CAP-023 test 1 only
asserts that a JSON Feed is *discovered*, not how it is validated.
