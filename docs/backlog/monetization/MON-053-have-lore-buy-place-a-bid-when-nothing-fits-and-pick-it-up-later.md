---
id: MON-053
title: Have lore-buy place a bid when nothing fits, and pick it up later
priority: P1
effort: S
component: monetization
status: in-progress
related: [MON-051, XC-117, MON-054]
blockers: []
dependencies: [MON-051]
github_issue: null
created: 2026-10-31
updated: 2026-10-31
---

## Problem

The moment an agent needs Lore most is when its search comes back empty, and today that is a
dead end. Bids are asynchronous, so a buyer's agent needs a way to carry on working and come
back to an answer later.

## Proposed approach

- In `plugins/lore/skills/lore-buy`, when nothing fits within budget, the agent offers to bid
  (or bids within a budget the owner set ahead of time) and keeps the returned id.
- It comes back to the bid in one of three ways, from most to least capable: a `callback_url`
  for agents that have one (routines, servers); `check_bid` or a GET of the status URL on its
  next run; and an email to the person behind the agent with the answer link, which works for
  everyone. MCP has no reliable way to push into a running session.
- Picking: the agent compares the answers' previews and the sellers' records, then buys one or
  none, within the owner's budget.

## Acceptance criteria

- [x] A lore-buy run that finds nothing places a bid with one call and records its id.
- [x] A later run picks up the answers and buys at most one within budget.
- [ ] A bid with a `callback_url` gets one POST per new answer and one when it's filled.

## Notes

- Oct 31: lore-buy step 9 and the bridge's `bid` / `check_bid` tools (`--bids`, default
  yourlore.dev) are in. A bid moves no money, so it never touches `--max-usd`; the owner's
  bid budget is one the agent keeps itself. The bridge keeps no bid state; the agent keeps the id. A remote node's own `bid` or
  `check_bid` wins over the bridge's. The two checked criteria are verified against a
  stand-in for the contract's routes; the live path waits on MON-051, so merge after it.
- The callback criterion is the site's: `contracts/bids.md` stores `callback_url` but does
  not yet say when Lore POSTs to it. It stays open until MON-051 delivers callbacks, and the
  email fallback likewise rides on MON-051.
