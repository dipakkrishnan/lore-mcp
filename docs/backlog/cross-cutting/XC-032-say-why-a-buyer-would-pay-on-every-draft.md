---
id: XC-032
title: Say why a buyer would pay on every draft
priority: P2
effort: M
component: cross-cutting
status: in-review
related: [APP-117, APP-046, MON-018, XC-002]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-14
updated: 2026-09-14
---

## Problem

An owner approving a draft has no signal about whether anyone would buy it.
Zane asked for "some sort of rating of my lore as I'm making it, 67%
quality/likelihood to sell". A percentage would be invented: the ledger holds
one sale, and there is no model of buyer demand to score against. What Lore
does know is the three tests from the buyer thesis that separate the
publications that sold from the ones that read like essays: it is not
already in the model (post-cutoff or too specific to be on the public web),
it changes a decision an agent is about to make, and it is firsthand, dated,
and from a named person.

## Proposed approach

Make the drafting agent answer those three tests for every candidate and
show the answers on the card. The publish skill adds one field per test to
each candidate, a sentence each or "no" ("Buyers can't get this elsewhere
because …", "Changes what an agent does when …", "Firsthand: … on <date>").
`lore publication draft` accepts and stores them; the desktop approval card
and the CLI review prompt render them under the teaser. A candidate that
fails a test is still shown, with the failing line worded plainly, so the
owner can fix it or skip it. No number, no percent. If sold counts later give
real evidence, that is `MON-018` territory and it joins the card as a fact.

## Acceptance criteria

- [ ] Every draft candidate carries the three answers, and the card shows
      them before Approve.
- [ ] A candidate whose evidence is public and undated says so on its own
      line rather than being silently dropped.
- [ ] The CLI review prompt shows the same three lines.
- [ ] No screen shows a likelihood-to-sell number.

## Notes

Spans the publish skill (`plugins/lore/skills/lore-publish`), the
publication draft schema in Python, and the desktop card, hence
cross-cutting. The tests are stated in the "Lore Buyer Thesis" artifact of
2026-09-06.
