---
id: MON-026
title: Adopt the Machine Payments Protocol on the node, in three cuts
priority: P2
effort: L
component: monetization
status: in-review
related: [MON-005, MON-007, MON-009, MON-024, MON-025, XC-022, XC-024]
blockers: []
dependencies: ["Decision: which cut to launch with", "Tempo testnet (Moderato) reachable from the Worker"]
github_issue: null
created: 2026-09-15
updated: 2026-09-15
---

## Problem

Every buyer of a Lore publication needs a funded USDC wallet on Base, and
every seller who switches to real money needs a Coinbase Developer Platform
account and two API secrets, because the node's paid tools are x402 tools
settled through Coinbase's facilitator (`lore/node/src/network.ts`,
`lore/node/src/index.ts`). Zane, the first trial user, stalled at the wallet
step and never met a buyer; the buyer thesis assumes agents that already
hold a wallet, and the bridge exists only to hand one to Claude. The
Machine Payments Protocol (MPP) is the other HTTP 402 standard, now with
first-class support in the same Cloudflare Agents SDK the node already uses,
and it carries two things x402 does not: a card method (Stripe Shared
Payment Tokens) that needs no wallet at all, and a session intent that lets
a buyer approve one spend limit and then buy many publications without a
signature and a prompt per `get`. Epic #25 planned MPP as the launch rail
and closed without running its spike; the monetization README still says
so, which is stale.

## Proposed approach

Three cuts, each independently shippable, in order of cost.

**Cut 1 — MPP wire, same rail.** Keep USDC on Base and the CDP facilitator.
Issue MPP challenges from the Worker via `mppx`'s `evm.charge` with the
x402 facilitator config, which serves MPP and x402 buyers from one endpoint.
No buyer changes, no new secrets. Establishes the `Mppx.create` +
`Transport.mcpSdk()` shape inside `McpAgent` and the receipt decoding in
`sales.ts`. The migration bridge for everything after.

**Cut 2 — Tempo rail.** Settle on Tempo stablecoins (mainnet chain 4217,
Moderato testnet 42431, pathUSD `0x20c0…0000`). No facilitator: the Worker
broadcasts the transfer itself, and `feePayer: true` sponsors the fee so the
buyer needs no gas token. The CDP account, its two secrets, and the
1,000 tx/month cap disappear; one generated `MPP_SECRET_KEY` replaces them.
Real-money switch becomes a confirmation and a network flip. Requires a
server-owned replay store (Durable Object storage or D1), a mock Tempo RPC
in place of `test/facilitator.ts`, and the same eight fail-closed cases in
`paid-path.test.ts` re-pinned. Buyer side: the bridge swaps
`withX402Client` for `McpClient.wrap` from `mppx/mcp/client`; the key
provisioning is unchanged since both take a viem account. Owner side:
`deploy.py` secrets and network map, desktop network labels and explorer
links, the enable-payments skill's steps 6 and 7, and every doc naming USDC
or Base.

**Cut 3 — Stripe card method.** Add `stripe.spt.charge()` as a second
method so a buyer's agent pays with a Shared Payment Token from Stripe's
Link agent wallet, with no key file, no faucet, and no bridge process; the
same payment link also serves a human in a browser, turning the storefront
into an actual store. Needs a seller Stripe account and profile id, and
Stripe holds the funds, which cuts against the "Lore never holds it" line.
SPTs have a $0.50 minimum, so at the current $0.01 publication price the
method is excluded from the challenge; it applies to the answer tier and to
any bundle pricing `MON-009` decides. Opt-in per seller, never the default.

Sessions (`tempo.session`) are a fourth step after cut 2, not in this item.

## Acceptance criteria

- [ ] Cut 1: an unchanged x402 bridge buyer and an MPP client both complete
      a paid `get` against the same deployed node, and the two invariants
      (challenge discloses no content; paid payload equals free payload)
      still pass.
- [ ] Cut 2: a fresh node deploys to Tempo testnet with no CDP credentials,
      a throwaway buyer settles a `get` funded only by the Tempo faucet, and
      the sale row lands with a Tempo transaction hash. Mainnet stays opt-in
      and fails closed without `LORE_NETWORK` spelled out.
- [ ] Cut 2: a replayed credential is rejected by the node's own store, with
      no facilitator in the path.
- [ ] Cut 3: a Claude Code buyer with the Link agent wallet skill and no
      crypto wallet buys an answer-tier result in Stripe test mode; a browser
      opening the same link reaches a checkout page.
- [ ] The monetization README no longer calls MPP "the launch rail" and
      records which cut shipped.

## Notes

Sized against the code on 2026-09-15: cut 1 about three days, cut 2 about
two weeks of one person plus the human-gated mainnet test, cut 3 a few days
of code plus the Stripe account decision. The spike from issue #20 should
run first, one day on a branch against Moderato, since the Cloudflare docs
show the Durable Object shape but nothing here has exercised it.

Cut 2 alone does not improve buyer UX; Tempo onramps are younger than USDC
on Base (bridges: Across, Stargate as USDC.e, Relay; Tempo Wallet has a fiat
onramp). The buyer-facing gains are cut 3 and sessions. Cut 2's seller gain
is the shorter real-money switch. Cut 2 does not fix the wallet gate either;
that stays `MON-025`.

Open question for cut 3: Tempo's MPP Credits (card, Apple Pay, Google Pay
at wallet.tempo.xyz, prepaid, spent by the agent) settle to the seller in
USDC.e on Tempo at the seller's own address, so they may give the no-wallet
buyer without Stripe custody. They are accepted only at services listed in
the MPP directory and proxied by Tempo; what proxying requires of the node
is unverified as of filing. If it is a listing plus a header, credits beat
Stripe SPTs for Lore and cut 3 should be re-scoped around them.

Reference points: Cloudflare "Accept payments with MPP" and "Pay from the
Agents SDK"; mpp.dev Tempo charge and Stripe charge; Stripe "Monetize your
MCP server"; PR #40's comment table for what dissolves into the platform.
