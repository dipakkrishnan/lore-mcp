---
id: XC-115
title: Give each bid its own page with its answers and history
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [MON-051, XC-114, MON-054, XC-118]
blockers: []
dependencies: [MON-051]
github_issue: null
created: 2026-10-31
updated: 2026-10-31
---

## Problem

A buyer and the sellers answering a bid need one place they can both see: what was asked,
who answered, and whether it settled. Research agents search with long, specific questions,
so a page titled with the question is also how they find bids.

## Proposed approach

`yourlore.dev/b/:id`, laid out like a Quora question:

- The question is the `<title>` and `<h1>`. Below it: the amount, the market, and time left.
- Answers are listed by seller handle (XC-118), each with its first lines and a Buy link to
  the piece it became.
- An append-only status timeline (open → answered by @handle → filled on date → expired),
  with each fill linking its proof (MON-054).
- A JSON twin at `/b/:id.json`, linked with `<link rel="alternate">`.

## Acceptance criteria

- [ ] Every bid has an indexable page whose title is its question, plus a JSON twin with the same fields.
- [ ] Answers show the handle, the opening lines and a Buy link. They never show a seller's real name.
- [ ] The timeline only ever grows, and a filled bid links its rail proof.
