---
name: lore-enable-payments
description: Set up payments for a Lore node, so other agents pay to call `answer`. Walks the owner to a self-custody payout address, a price, and a proven test-network payment against their deployed node — in whichever order they choose. Use when the user says "enable payments on Lore", "monetize my lore", "charge for answers", "get paid when agents use my Lore", or picks the Monetize branch after onboarding.
---

# Enabling payments

This skill configures a payment rail. It does not earn anything. The owner can finish
every step and never receive a cent — earning happens later, when some other agent
calls `answer` and pays for it. Say that plainly if they seem to expect otherwise; do
not sell the outcome.

**Free is a first-class end state.** An owner who stops at `lore price 0`
has not failed at anything. A Lore that is never monetized has already paid for
itself through private recall. Do not treat any step here as a funnel.

Deployment itself — the Cloudflare account, the Worker, the smoke check — belongs to
the `lore-deploy-node` skill. This one decides what the node charges and where the
money lands, and proves a payment against the deployed node.

## 1. Pick the path

Read `lore status` first. Then ask one question — with AskUserQuestion when the agent
has it, in plain conversation otherwise (Codex will simply ask in text; that is fine).
Recommend based on state:

- **Active publications exist → recommend content-first.** They have something worth
  selling; price and deployment are in service of it.
  - *Sell what's published* — continue to step 2.
  - *Rails first* — prove a test payment before anything else; step 2, then straight
    to deploy and the test buy.
- **Zero publications → recommend rails-first.** There is nothing to sell yet, and
  the rails can be proven with nothing at stake.
  - *Rails first* — wallet, price, deploy, test buy, publish later.
  - *Publish first* — route them to the publishing flow and resume here after.

Either answer runs the same steps in a different order. This skill is resumable:
every step reads its state from `lore status` and the deployed node, so if a session
dies, run it again and continue from the first thing not yet configured. Never re-ask
for something already set.

## 2. Show the whole cost first

Before asking for anything, tell the owner everything this takes:

| What | Why | Secret? |
|---|---|---|
| A self-custody **payout address** on Base | Where buyers' USDC lands | No — public by design |
| A **deployed node** (`lore-deploy-node`, free tier) | Something has to serve and charge | No |
| A **price** per answer, in USD | What the gate charges | No |
| A **throwaway test-buyer wallet**, faucet-funded | Something has to *pay* the proof transaction | Its key is secret; it never enters this conversation |

On the test network all of this is free — faucet funds are play money. Then say this
once, plainly:

> The address is yours alone. Lore never holds, custodies, or can recover these funds.
> You are receiving cryptocurrency into a wallet you control.

Do not offer tax or regulatory advice at any point, including if asked directly. Say
it is outside what you can advise on.

## 3. The payout address

**Ask first whether they already have an EVM wallet.** MetaMask, Rainbow, Rabby,
Coinbase Wallet, or a hardware wallet all work — the requirement is an address on Base
that they control and that will not change. If they have one, copy the address and go.

If they do not, point them at **Coinbase Wallet** — the self-custody app at
`coinbase.com/wallet`, not the Coinbase exchange app. The difference matters: an
exchange deposit address may rotate, and x402 settles to whatever address is
configured, so payments would keep succeeding into an account that is no longer
watched, with no error anywhere. Self-custody, for that stated reason.

During wallet setup the app shows a **recovery phrase**. Never ask for that
recovery phrase, and never accept the recovery phrase if they paste it — that
phrase is the wallet, and nothing legitimate in this flow will ever need it.
If the recovery phrase appears in the conversation anyway, tell them to treat
that wallet as compromised and start a fresh one.

The only thing this skill ever needs from the wallet is the **public address** (`0x` +
40 hex characters). That is safe to paste anywhere.

## 4. Price

```sh
lore price 0.01
```

Any amount works; `lore price 0` is free and a supported place to stop, not a failure.
The price is advertised by the node; nothing enforces it until the node is deployed.

## 5. Deploy

Run the `lore-deploy-node` skill: it handles the Cloudflare account, sets the payout
address as the node's one payment secret, deploys, and smoke-checks the result.

On return, **ask the owner for the node's URL** — with AskUserQuestion when available,
plainly otherwise — rather than assuming it survived in context. The deploy may have
happened minutes ago in this conversation or last week in another one; asking makes
those the same case. The smoke check, not memory, answers whether the node is live.

## 6. Prove one payment on the test network

Something has to pay the node once, so the owner trusts the rail before real money is
near it. Use a **throwaway buyer wallet, never the payout wallet** — a node paying
itself proves nothing.

1. Create a second, throwaway wallet (a fresh account in the same wallet app is fine).
2. Fund it from a Base Sepolia USDC faucet — Circle's faucet at `faucet.circle.com`
   works. This is play money.
3. In `worker/`: `cp .buyer.env.example .buyer.env`, then have the owner edit
   `.buyer.env` **themselves** in their editor and fill in the buyer key there. The
   key must never be pasted into this conversation — anything pasted here lands in
   agent transcripts, the very files Lore's synthesis later reads.
4. Run the capped buyer:

```sh
npm run pay -- https://<their-subdomain>.workers.dev/mcp
```

It pays at most $0.01 test USDC and prints the settlement receipt. If it settles, the
whole rail — challenge, signature, facilitator, payout — is proven. If it fails, stop
and fix before going further; a node that challenges every buyer and can never settle
is worse than a free one.

## 7. Mainnet, later — not part of this skill

Real money is a separate, deliberate step, taken only after the owner's publications
are being served from the edge and a two-person paid test has settled. It requires
all of:

- at least one active publication — a real buyer must never pay real USDC for an
  empty answer;
- an **explicit** confirmation from the owner that they are switching to real money;
- Coinbase Developer Platform API keys (from `portal.cdp.coinbase.com`), set as
  Worker secrets with `npx wrangler secret put` — they live in Cloudflare's vault,
  never on this machine and never in this conversation. The free test-network
  facilitator needs no keys at all; CDP is the only facilitator that settles Base
  mainnet.

If the owner asks to go to mainnet now, say it is gated on the above and leave the
node on the test network.
