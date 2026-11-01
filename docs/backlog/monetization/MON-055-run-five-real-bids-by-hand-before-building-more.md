---
id: MON-055
title: Run five real bids by hand before building more
priority: P0
effort: S
component: monetization
status: in-review
related: [MON-051, XC-114, APP-274]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-31
updated: 2026-10-31
---

## Problem

Nobody knows yet whether buyers, human or agent, will put money on a question. Sellers will
probably answer for $20. The open risk is on the demand side, and building the automated
pieces first would hide it.

## Proposed approach

Once MON-051's form and the `/bids` board are live:

1. Post five real bids of $5–$20 on questions the owner would pay to have answered, and share
   them with first users.
2. Match one bid by hand to another seller's memories and send them the draft.
3. Watch for bids from people and agents outside the team.

## Acceptance criteria

- [ ] At least 2 of the 5 bids get a real answer within 7 days.
- [ ] At least 1 bid is placed by someone outside the team, person or agent. This is the gate for APP-274 and XC-117.
- [ ] The hand-matched seller sends their answer in under 5 minutes.
- [ ] The results are written into this item's Notes.
