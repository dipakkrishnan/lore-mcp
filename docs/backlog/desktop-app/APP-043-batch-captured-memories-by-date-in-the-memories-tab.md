---
id: APP-043
title: Batch captured memories by date in the Memories tab
priority: P2
effort: M
component: desktop-app
status: ideation
related: []
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/171
created: 2026-09-01
updated: 2026-09-01
---

## Problem

The Memories tab lists captured memories with no date grouping — issue #171
asks for them to be bucketed by date (weekly to start, with day/week/month
configurable later) so a long capture history is scannable, plus a way to
see the bucket boundary while scrolling. The issue also raises an open
question — whether the memories page needs a more advanced search — and
floats a further future want (label/metadata-based filtering) that it
explicitly scopes out of the first pass.

## Proposed approach

Default-by-week bucketing with a day/week/month toggle deferred, and a
scroll-position date indicator, look like a reasonably scoped first slice.
The issue's own open question ("should there be a more advanced search
feature") is explicitly unresolved in the issue text itself and needs an
answer before that part is buildable — this item should stay scoped to
bucketing/grouping only; search is a separate concern that shouldn't block
it. Metadata-based labelling/filtering is explicitly "future iterations" per
the issue and is out of scope here entirely.

## Acceptance criteria

- [ ] TBD — the bucketing slice (default weekly grouping + scroll-position
      indicator) could plausibly be spec'd today, but leaving this in
      `ideation` rather than writing acceptance criteria unilaterally: the
      issue bundles three asks (bucketing, scroll indicator, search) of
      different sizes and open-ness, and `agents/ideation.md` step 3 flags
      that as a split candidate. A follow-up pass should decide whether to
      split this into a scoped bucketing item now and separate items for
      search and metadata filtering later, rather than writing criteria that
      quietly resolve the issue's own open question.

## Notes

Cataloged from GitHub issue #171 ("Captured memory filtering and sorting").
Full issue text bundles: (1) default weekly bucketing with a future
day/week/month toggle, (2) a scroll-position date indicator, (3) an
explicitly open question about advanced search, (4) explicitly-future
metadata labelling/filtering. Left in `ideation` rather than splitting
unilaterally, since (3) is the issue author's own open question and (4) is
their own "future iterations" note — resolving scope here would be
inventing an answer, not reading one off the issue.
