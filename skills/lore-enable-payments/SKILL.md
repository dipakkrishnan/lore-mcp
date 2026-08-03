---
name: lore-enable-payments
description: Set up a paid Lore node end to end, so other agents pay to call `get`. Walks the owner to a self-custody payout address, a price, a deployed Cloudflare Worker, and a proven test-network payment — in whichever order they choose. Use when the user says "enable payments on Lore", "monetize my lore", "charge for answers", "deploy my lore node", "put my lore online", or picks the Monetize branch after onboarding.
---

# Enabling payments

This skill configures a payment rail. It does not earn anything — earning happens
later, when some other agent calls `get` and pays for it. Say that plainly if
the owner seems to expect otherwise; do not sell the outcome.

**Free is a first-class end state.** An owner who stops at `lore price 0`
has not failed at anything; a Lore that is never monetized has already paid for
itself through private recall. Do not treat any step here as a funnel.

The deployed node serves the owner's **approved publications** — nothing else
exists at the edge. With zero publications the rail still proves end to end, but the
catalog is empty and there is nothing to buy; that is why mainnet is gated on
having at least one.

## How to drive — read this first

The owner should never have to figure out where to go or what comes next. You are
the guide; the skill is your script.

- **One step at a time.** One line on what this step is for, do it or open it,
  confirm it worked, move on. Never paste the flow as a wall of steps.
- **You run the commands.** Every shell command here is yours to execute, not to
  quote. The owner personally does two things: log in to Cloudflare, and click
  around their own wallet app and faucet pages.
- **Announce, then open.** Before any browser step, say in one sentence what the
  page is and what the owner will do there — then use the host's browser control
  when available, otherwise the platform's URL opener. Never spring a tab on
  someone mid-thought, and never open a page you haven't framed.
- **Defer at decision points.** Price, path order, wallet choice, stopping early —
  ask one question with a recommendation and take the owner's answer. Mechanics
  are yours; decisions are theirs.
- **Verify from state, never by asking.** `npx wrangler whoami`, `lore status`,
  and the chain itself. Resume from the first thing not configured; never re-ask
  for something already set. User-reported success is not evidence — faucets and
  wallet apps report wrong-network sends as success. When in doubt about any
  address, its truth is `https://sepolia.basescan.org/address/<addr>`.
- **Interactive logins run in the owner's session.** In Claude Code have them type
  `! npx wrangler login`; elsewhere they run it in their own shell. You never see
  credentials either way.
- **Two wallets, two roles — say which, every time.** Conflating them is the most
  common owner error. Show this once early, and name the role every time an
  address changes hands:

  | Wallet | Who holds the key | Role |
  |---|---|---|
  | **Payout** | The owner, in their wallet app | *Receives* every payment; set as `LORE_WALLET` |
  | **Buyer** (throwaway) | `~/.lore/node/.buyer.env`, self-generated | *Pays* the one test transaction |

## 1. Pick the path

Read `lore status`, then ask one question:

- **Active publications exist → recommend content-first**: they have something
  worth selling; price and deployment serve it.
- **Zero publications → recommend rails-first**: wallet, price, deploy, test buy,
  publish later. Or *publish first* — route to the `lore-publish` skill and resume
  here after.

Either answer runs the same steps in a different order.

## 2. Show the whole cost first

Before asking for anything, tell the owner everything this takes: a self-custody
**payout address** on Base (public by design), a free-tier **Cloudflare account**
(their login, never seen here), a **price** per answer in USD, and a throwaway
**test buyer** that `npm run pay` creates and funds from a faucet. On the test
network all of it is free — faucet funds are play money. Then say this once,
plainly:

> The address is yours alone. Lore never holds, custodies, or can recover these
> funds. You are receiving cryptocurrency into a wallet you control.

Do not offer tax or regulatory advice at any point, including if asked directly.
Say it is outside what you can advise on.

## 3. The payout address

**Ask first whether they already have an EVM wallet** (MetaMask, Rainbow, Rabby,
Coinbase Wallet, hardware — anything with a stable Base address they control).
Have one? Copy the address, go. If not, walk them through Coinbase Wallet — the
self-custody app at `coinbase.com/wallet`, *not* the exchange app (an exchange
deposit address can rotate, and x402 would keep settling into an account nobody
watches, with no error anywhere). Announce the page, open it, then one step at a
time: **Create new wallet** (passkey setup is the safer default — no phrase to
mishandle; classic setups show a **recovery phrase**: paper backup, confirm in
app); skip all purchases, verification, and funding — an empty wallet is the
goal; then **Receive → Base → Copy address**. The owner pastes the address here
(`0x` + 40 hex, public by design); validate the format before using it.

Never ask for the recovery phrase, and never accept it if pasted — that phrase
*is* the wallet. If it lands in the conversation anyway, the wallet is
compromised: fresh one. Agent transcripts are exactly the files Lore's synthesis
later reads.

## 4. Price

Run `lore price 0.01` (or the owner's chosen amount — their call, `0.01` is the
recommendation). `lore price 0` is free and a supported place to stop.

## 5. Deploy the node

Verify two prerequisites from state, then one command:

1. `npx wrangler whoami` — not logged in? See "interactive logins" above. Free
   tier is enough.
2. If deploy later fails with "register a workers.dev subdomain" (one-time per
   account): frame and open
   `https://dash.cloudflare.com/<account-id>/workers-and-pages` (account id from
   `whoami`) — the **Your subdomain** panel is where they pick a name. Wrangler's
   own `/workers/onboarding` link 404s; don't use it.

```sh
lore node deploy --wallet <payout-address>   # the public 0x address from step 3
```

It stages the node at `~/.lore/node`, installs dependencies, creates the D1
database, deploys, stores the payout address as the Worker's `LORE_WALLET` secret
(Cloudflare's vault, not this machine), pushes the active publication set, and
smoke-checks the live node with real MCP calls. It spends nothing. If a step
fails it prints what to do next; `npx wrangler tail` streams live errors.
Rerunning is always safe — it is also the redeploy path.

Deployed earlier? `lore status` shows the URL as `Node (last deploy):` — ask the
owner only if status cannot answer. After any publication change: `lore push`.

## 6. Prove one payment on the test network

The owner should see money move once before real money is near this. The payer is
a throwaway buyer, **never the payout wallet** — a node paying itself proves
nothing. From `~/.lore/node` (node URL from `lore status`):

```sh
npm run pay -- https://<node-url>/mcp
```

The script drives itself: on first run it **generates the throwaway buyer**
(key written straight to `.buyer.env`, read-only — never open that file in an
editor, and regenerate rather than repair if it's ever damaged), checks the
buyer's USDC balance on-chain, and — if unfunded — prints the address to fund
and exits. Then:

1. **Fund the buyer address it printed** (say which wallet this is: the buyer,
   not the payout). Frame and open a faucet: prefer
   `https://portal.cdp.coinbase.com/products/faucet` (free Coinbase login;
   defaults to Base Sepolia + USDC). No login wanted?
   `https://faucet.circle.com` works but **its network dropdown defaults to the
   wrong chain** and its success screen doesn't name the network — have the
   owner confirm it reads **Base Sepolia** before sending; a wasted send locks
   that asset+network pair for 2 hours.
2. **Re-run the same command.** The preflight passes once funds arrive (the
   script's own error output covers the wrong-network diagnosis if they don't).
   It pays at most the node's price and prints the settlement receipt. If it
   settles, the whole rail — challenge, signature, facilitator, payout — is
   proven. If it fails, stop and fix before going further; a node that
   challenges every buyer and can never settle is worse than a free one.
3. **Close the loop where the owner can see it.** Warn first that **wallet apps
   show $0.00 for testnet funds** — the explorer is the window until mainnet.
   Then frame and open
   `https://sepolia.basescan.org/address/<payout-address>` — Token Transfers
   shows the settlement as `Transfer With Authorization`: the x402 signature
   executing, price moving buyer → payout.

If an owner insists on using their own key instead, they edit `.buyer.env`
themselves, in their own editor — nothing in this flow ever needs a private key
pasted into the conversation, and anything key-shaped pasted here is refused.

## 7. Mainnet, later — not part of this skill

Real money is a separate, deliberate step, taken only after a two-person paid
test has settled. It requires all of: at least one active publication (a real
buyer must never pay real USDC against an empty catalog); an **explicit** owner
confirmation; and Coinbase Developer Platform API keys (`portal.cdp.coinbase.com`)
set as Worker secrets via `npx wrangler secret put` in `~/.lore/node` — they live
in Cloudflare's vault, never on this machine and never in this conversation. The
test-network facilitator needs no keys; CDP is the only facilitator that settles
Base mainnet.

If the owner asks to go to mainnet now, say it is gated on the above and leave
the node on the test network.
