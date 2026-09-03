---
id: XC-020
title: Link the store to its payout address on Base
priority: P2
effort: S
component: cross-cutting
status: completed
related: [APP-001, MON-004, XC-019, MON-018]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-09-02
---

## Problem

The Store header says "Live, answering on Base" and Settings says "Live on
Base", but the owner has no way from the app to see the account that money
lands in. The payout address exists only as the Worker secret `LORE_WALLET`
(`lore deploy --wallet`); it is not persisted locally and the manifest does
not carry it, so the app cannot build a Basescan link today. The Cloudflare
link needs no new data and ships separately (derived from the worker
hostname).

## Proposed approach

Surface the address from the node itself rather than storing a second copy:
the snapshot's live probe already talks to the Worker, and every paid `get`
answers 402 with x402 `accepts[].payTo`. Read that once per `desktop-state`,
expose it as `node.live.payout`, and let the app render a quiet "Payouts on
Base ↗" link next to the address (Basescan for `eip155:8453`, Sepolia
Basescan for `eip155:84532`), plus a "Payouts" row in Settings showing the
truncated address. Keep it a link, not a balance — balances need an RPC
call and a chain-specific formatter the app should not own.

## Acceptance criteria

- [x] `lore desktop-state` reports `node.live.payout` as the address the
      node's `discover` advertises, or `null` when the node is unreachable.
- [x] Store header and Settings show a link to the payout address on the
      correct Basescan host for the live network; no link when unknown.
- [x] The probe adds at most one request to `desktop-state` and is covered by
      the existing unreachable-node test shape.

## Notes

Raised 2026-08-23 while dogfooding: "it doesn't link me to Base or to
Cloudflare to see my worker should I so choose." The Cloudflare half landed
as a chore (worker name = first label of the `workers.dev` host →
`dash.cloudflare.com/?to=/:account/workers/services/view/<name>`).

**Prioritization pass 2026-08-26:** No blockers, small effort, concrete AC with the exact data source (`payTo` from the node's 402) named. Promoted `in-review` → `ready`.

**Completed 2026-09-02** with MON-018: the address comes from `discover`
rather than a 402, so the existing probe carries it with no extra request.
