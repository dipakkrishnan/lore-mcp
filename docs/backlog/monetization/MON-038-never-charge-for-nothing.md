---
id: MON-038
title: Never charge an agent for nothing, and mark unanswered answers owed back
priority: P1
effort: S
component: monetization
status: in-review
related: [MON-030, MON-037, XC-039]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-04
updated: 2026-10-04
---

## Problem

An agent can pay and get nothing in two ways. `get`'s own description said a
just-revoked id "can still be billed". And `answer` settles when the ticket is
created, so a question that is later refused or fails has been paid for, with
no refund and nothing telling the owner.

## Proposed approach

- `get`: `agents/x402` (0.23) settles only when the handler's result is not an
  error, and `get` returns an error for an id that isn't for sale. A revoked
  id is therefore never charged; pin it with a paid-path test and fix the
  description, in the Worker, `lore/mcp.py` and `contracts/mcp_tools.json`.
- `answer`: x402 pays the owner's own wallet directly, and Lore holds no key
  to it, so an automatic on-chain refund isn't possible. Mark the sale
  `refund_owed` when the answer ends refused or failed (SQLite triggers,
  whichever of the sale and the job's end is written last), show it in
  `lore node sales` and the desktop Sales list with the payer to refund, and
  say so plainly in the tool descriptions.

## Acceptance criteria

- [x] A paid `get` for an id that isn't for sale never reaches `/settle` and
      records no sale.
- [x] A refused or failed paid answer is marked owed back, in either write
      order; a completed one and a publication are not.
- [x] The seller sees the owed refund and whom to pay; the descriptions say
      refunds are the owner's, not automatic.

## Notes

Settling an answer only after it completes would avoid the refund entirely,
but needs our own facilitator call outside `agents/x402`, with the signed
authorization held until the job ends (it expires after `maxTimeoutSeconds`,
300). Revisit if refunds owed turn out to be common.
