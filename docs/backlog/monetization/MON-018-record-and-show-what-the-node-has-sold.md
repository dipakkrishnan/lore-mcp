---
id: MON-018
title: Record every settled sale on the node and show it in the app
priority: P1
effort: M
component: monetization
status: in-review
related: [XC-020, MON-013, APP-055, MCP-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-02
updated: 2026-09-02
---

## Problem

Nothing recorded a paid call. The Worker kept no ledger, the desktop's
Sales card was fixed copy, and the only receipts were on Basescan and in the
buyer's terminal. The core seller question, "what are people buying and for
how much", had no code behind it (edge audit finding 1).

## Proposed approach

`agents/x402` settles a payment after the paid tool's handler returns and
leaves the receipt in the result's metadata, so the handler never sees the
transaction. Wrap the registered tool once instead and insert one `sales`
row when the receipt says success: kind (publication or answer), item id,
title at sale time, price, network, payer, transaction hash, timestamp. The
table is created in the Worker's init and survives a push, which replaces
only the publications and settings tables. Both paid tools go through the
same wrap.

Read it back with `lore node sales`, which runs the same `wrangler d1
execute` the push uses under the owner's Cloudflare login. The desktop
reads it through its own IPC when For Sale opens, not inside
`desktop-state`, and renders count, total, last sale, one row per sale with
an icon-only link to the transaction on Basescan, and a sold count on each
For Sale row. The payout address rides on the node's `discover` output so
the existing probe carries it (closes XC-020).

## Acceptance criteria

- [x] A settled `get` writes one `sales` row carrying the facilitator's
      transaction hash and payer; a failed settlement writes none.
- [x] `lore node sales` prints the ledger, as text or `--json`.
- [x] For Sale shows the ledger with a per-sale Basescan link and a sold
      count per publication; without a store it says there are no sales
      yet and probes nothing.
- [x] `desktop-state` reports `node.live.payout`, and the app links it on
      For Sale and Settings on the right Basescan host for the network.

## Notes

A node deployed before this records from its next redeploy; there is no
in-app affordance for the missing table since the only node is the
maintainer's. The public storefront shows nothing about sales.
