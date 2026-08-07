# Demo: an agent buys knowledge from another person's agent, live

The public demo for the launch post. One take, under three minutes, three
panes on screen. A buyer's Claude discovers a stranger's lore node, decides a
publication is worth the price, pays real USDC over x402, and the settlement
lands on Base — visible on-chain before the narration finishes.

The moment that makes it magic: **no human touches a wallet during the take.**
The owner already priced and deployed; the buyer's agent already holds a
funded signer. Everything on screen is two agents transacting.

## The three panes

```
┌─────────────────────────────┬─────────────────────────────┐
│  PANE 1 — Buyer's Claude    │  PANE 2 — Live transaction  │
│  (Claude Code or Desktop)   │  feed (terminal or browser) │
│                             │                             │
│  discover → weigh teaser    │  402 challenge → signed     │
│  → approve $0.01 → get      │  payment → settlement tx    │
│                             │                             │
├─────────────────────────────┴─────────────────────────────┤
│  PANE 3 — Basescan: seller wallet, auto-refreshing.       │
│  The USDC transfer appears here, block-timestamped.       │
└───────────────────────────────────────────────────────────┘
```

- **Pane 1** is the story: a real Claude session, prompted with something like
  *"I'm debugging a failed product launch. dipak.lore has lore on this —
  see if anything is worth buying."* The audience watches the agent call
  `discover`, read teasers, reason about whether $0.01 is worth it, and call
  `get`.
- **Pane 2** is the proof of mechanism: the x402 exchange itself. The 402
  challenge (price, network, pay-to address), the signed payment payload, and
  the settlement receipt (`_meta["x402/payment-response"]`) with the
  transaction hash.
- **Pane 3** is the proof of settlement: the seller's address on Basescan
  (`sepolia.basescan.org` for rehearsal, `basescan.org` on launch). USDC in,
  from the buyer's address, in the same take.

## Beat sheet (~2:30)

| Time | Beat | On screen |
|------|------|-----------|
| 0:00 | Setup line: "This is my agent's memory. I priced it. My laptop is closed." | Pane 3 shows seller wallet, zero recent activity |
| 0:15 | Buyer prompt goes in | Pane 1: prompt + `discover` call fires |
| 0:30 | Agent reads the catalog | Pane 1: topic tree with teasers; narrate that teasers are the free tier |
| 0:50 | Agent picks one and hits the paywall | Pane 2: 402 challenge — price, USDC, Base, pay-to address |
| 1:10 | Payment | Pane 2: signed payload → settlement receipt with tx hash |
| 1:25 | The content arrives | Pane 1: full publication in the conversation; agent summarizes it against the buyer's problem |
| 1:45 | Settlement on-chain | Pane 3: refresh → the USDC transfer, hash matching Pane 2 |
| 2:00 | Kicker: "Every agent is about to have a wallet. Every person has lore worth paying for." | Zoom on the tx: buyer addr → seller addr, $0.01 |

The hash appearing in the receipt (Pane 2) and then on Basescan (Pane 3) is
the single most convincing cut in the video — rehearse that handoff.

## What exists today vs. what the demo needs

Working now, proven live on Base Sepolia (2026-08-01):

- Seller side end to end: the `lore-publish` skill drafts candidates → the
  owner approves with `lore publication review <file>` → `lore price` →
  `lore node deploy` → `lore push` puts the approved set on the node. The
  Worker serves `discover` free and `get` behind x402.
- The full payment exchange — but driven by `scripts/pay.ts`, a standalone
  script, not an agent (Pane 2's plumbing exists; Pane 1's does not).

The one build item is **MON-007**: the buyer-side signer, packaged so a stock
Claude client can pay. The ecosystem was surveyed (2026-08-03) and the
"local paying MCP bridge" pattern is the industry-standard answer for
Claude-class chat clients — MCPay and Coinbase's own CDP MCP-server docs both
ship it — but nothing off the shelf proxies a remote *MCP* server (they
bridge to paid REST APIs), so we build the thin version ourselves: a stdio
MCP server that connects to the lore node, wraps the connection with
`withX402Client` from `agents/x402` (already in the dependency tree, already
proven by `pay.ts` against this exact Worker), and re-exposes `discover` and
`get` as ordinary tools. The model sees "payment required" → "paid" as tool
results; the key never enters context. Buyer setup collapses to:

```sh
claude mcp add lore-buyer -- npm --prefix /path/to/lore-mcp/bridge run start -- --node https://<node>/mcp
```

Key custody, in order of demo-worthiness: the self-provisioning throwaway key
(`pay.ts`'s `.buyer.env` pattern, fine for Sepolia rehearsal) or a
CDP-managed wallet via `CdpX402Client` for the mainnet take — no raw private
key on disk at all, which is itself a line worth narrating.

Pane 2 then falls out for free: the signer server logs each challenge,
payment, and receipt to stderr — the live feed is `tail -f` on that log with
a pretty-printer, no extra infra.

## Prep checklist

- [ ] MON-007 signer MCP server working against a live node (the only code)
- [ ] Seller node deployed with 3–5 genuinely interesting publications —
      teasers carry the demo; write them for an audience, not a test
- [ ] Buyer wallet funded (faucet USDC for rehearsal; a few real dollars on
      mainnet for the take)
- [ ] Basescan tab pinned on the seller address; rehearse the refresh timing
      (Base settles in seconds — don't let the reveal beat the narration)
- [ ] Two full rehearsals on Sepolia, then the recorded take on mainnet
      (mainnet cutover = MON-005 — itself blocked on MON-004 revocation
      propagation, so clear that first) so the kicker is "that was real money"
- [ ] Buyer prompt written down, not improvised — the agent's visible
      reasoning about *whether the teaser is worth $0.01* is a scripted beat;
      re-roll the take if it skips the deliberation

## Failure modes to rehearse around

- Empty catalog → `pay.ts`-style guard already exists; make sure the node has
  content pushed before the take (`lore push`).
- Facilitator latency on mainnet (CDP) — time the gap between payment and
  receipt in rehearsal so the narration covers it.
- Basescan indexing lag — have the direct tx URL ready to paste rather than
  waiting on the address page to refresh.
