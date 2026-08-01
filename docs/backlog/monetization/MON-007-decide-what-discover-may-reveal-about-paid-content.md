---
id: MON-007
title: Decide what discover may reveal about paid content
status: ready
effort: S
impact: M
blockers: []
dependencies: [MON-003]
created: 2026-08-01
updated: 2026-08-01
---

## Problem

`discover` is free and unauthenticated, and it searches an FTS5 index that
includes publication **content**. It returns only titles and topics, but
`can_help` is a per-token true/false over the body, so an unpaid caller can ask
"does the word W appear in this person's paid text?" for any W in a dictionary.

This is the deliberate residual after PR #48 closed the severe version: matching
was `LIKE '%term%'`, which let a caller walk `ove` → `oven` one character at a
time and reconstruct the paid body without ever calling `answer`. Whole-token
FTS5 matching killed character extension. What remains is word-membership.

Found by a buyer-proxy agent driving the deployed node during the launch
end-to-end test, not by review.

## Proposed approach

Pick one, explicitly, and write down which leak budget it spends:

1. **Keep body indexing** (today). Best recall — `discover` finds publications
   whose title does not contain the buyer's words. Costs a word-membership
   oracle.
2. **Index title + topic only.** Shuts the oracle completely; `discover` can
   then reveal nothing it does not already print. Costs recall: a publication
   about launch failures whose title says "beta retrospective" stops matching
   "launch".
3. **Index an owner-approved teaser field.** Full recall control in the owner's
   hands, at the cost of another thing to write at approval time.

MCP-001 records two leak budgets (private shape; published value — a claim's
title can BE the claim). This decision belongs against the second one.

## Acceptance criteria

- [ ] A written decision naming which of the three the node does and why
- [ ] The chosen behavior asserted by a test, not by inspection
- [ ] If body indexing stays, the disclosure string `discover` returns says that
      queries are matched against content, so buyers and owners both know

## Notes

Whatever is chosen must hold on both surfaces: `lore/store.py`'s
`search_publications` and `lore/node/src/index.ts` share these semantics
deliberately, and MCP-002 tracks keeping the two from drifting.
