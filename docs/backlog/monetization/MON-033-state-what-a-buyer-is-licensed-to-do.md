---
id: MON-033
title: State what a buyer's agent may do with a piece it bought
priority: P2
effort: S
component: monetization
status: in-review
related: [XC-040, MON-028]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-29
updated: 2026-09-29
---

## Problem

A bought piece enters the buyer agent's context and possibly its long-term
memory, and nothing says what the buyer is allowed to do with it. Reusing it
for every future task, sharing it with other users of the same agent, and
republishing it are all unaddressed. Sellers have nothing to point to, and
buyers have no signal.

## Proposed approach

Pick a short default license: personal use by the buyer and the buyer's
agents, with no redistribution. Express it in:

- the JSON-LD for the piece (a `license` link on the Product);
- a line on the piece page and in Checkout;
- a field in the `get` payload.

A seller override can come later.

## Acceptance criteria

- [ ] The piece page, JSON-LD and `get` payload each carry the license.

## Notes

Raised 2026-09-29. It can't be enforced technically, but it sets
expectations. Review the legal wording together with XC-041.
