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

> **Agent-system controls:** In Claude Code, use `AskUserQuestion` for owner
> decisions. In Codex, ask directly in chat unless the current mode explicitly
> provides a structured question control. Never block because a named question
> tool is unavailable.

> **Lore desktop:** this skill runs as the app's "Open your store" task. Ask every
> decision through `ask_user`. You run every command yourself except two the app
> keeps for the owner: Cloudflare sign-in (call `cloudflare_login`; it opens
> Cloudflare in their browser and returns who is signed in — never send the
> owner to a terminal) and `lore push` (they press **Push** in the app; never
> run it). Every other browser step — the wallet, the workers.dev subdomain,
> the faucet, Basescan — goes through `open_url` with a short step title and
> a note of up to three short numbered lines; it waits for the owner and tells
> you whether they finished, got stuck, or declined. Never paste a link into prose. If
> `lore node deploy` stops with "not signed in to Cloudflare", call
> `cloudflare_login` and rerun it. Default the path to the **test network**
> (Base Sepolia); mainnet is an explicit choice the owner makes with a publication
> live. Keep the desktop flow publication-only; paid answers remain a separate,
> terminal-attended option. Do not read or write
> `~/.lore/automation/onboarding.json`.

## How to drive — read this first

The owner should never have to figure out where to go or what comes next. You are
the guide; the skill is your script.

- **One step at a time.** One line on what this step is for, do it or open it,
  confirm it worked, move on. Never paste the flow as a wall of steps.
- **You run the commands.** Every shell command here is yours to execute, not to
  quote. The owner personally handles Cloudflare login, their wallet and faucet,
  provider secrets, and attended publication or proxy approval.
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

## 1. Pick the path and buyer products

Read `lore status`, then ask one question:

- **Active publications exist → recommend content-first**: they have something
  worth selling; price and deployment serve it.
- **Zero publications → recommend rails-first**: wallet, price, deploy, test buy,
  publish later. Or *publish first* — route to the `lore-publish` skill and resume
  here after.

Either answer runs the same steps in a different order.

Only when at least one publication is active, explain the two products and ask one
question: keep publication access only, or also add paid answers.

- `get` returns one approved publication exactly, at the publication price.
- `answer` optionally adds a new response in the owner's first-person proxy voice,
  grounded only in approved publications, at its own per-answer price. It does not
  mean the owner is present.

If they decline answers, skip every answer-specific step. Publication-only, free,
and private-only are complete outcomes.

## 2. Show the whole cost first

Before asking for anything, tell the owner everything this takes: a self-custody
**payout address** on Base (public by design), a free-tier **Cloudflare account**
(their login, never seen here), a **price** per publication in USD, and a throwaway
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
Name the two traps before either branch: an app showing prices, buy buttons,
and a portfolio is the Coinbase *exchange* app, not a self-custody wallet —
exchange deposit addresses can rotate and silently break payouts; and the
network label must read **Base**, not Ethereum or Solana — a wrong-network
payout address means x402 settles funds they'll never see, with no error
anywhere. Base is a network selection *inside* the wallet, not a site — say
that plainly before anyone goes looking for a Base app.

**Has one:** ask *which* app, then drive it with that app's exact taps — "copy
the address" is not guidance. Generic shape, adapted to their app: open the app
or extension → **Receive** → network **Base** (same address across EVM chains;
what matters is receiving on Base) → **Copy**.

**Needs one:** walk them through Coinbase Wallet — the self-custody app at
`coinbase.com/wallet`. Announce the page, open it, and give the steps as three
short numbered lines: **Create new wallet** (passkey setup is the safer
default — no phrase to mishandle; classic setups show a **recovery phrase**:
paper backup, confirm in app); skip all purchases, verification, and funding —
an empty wallet is the goal; then come back. Put both traps on that same
card, one line each: the app with prices and Buy buttons is the exchange, not
the wallet; and the wallet has one address that starts with `0x`, the same on
Base and Ethereum, so any **Copy** next to it is the right one.

Either way, the address is its own step once the wallet exists: one question
with no options, so the owner gets a single field to paste into, and the line
"never paste a recovery phrase — Lore only wants the public address".
Validate the format (`0x` + 40 hex) before using it; a bad paste means ask
again, not guess.

Never ask for the recovery phrase, and never accept it if pasted — that phrase
*is* the wallet. If it lands in the conversation anyway, the wallet is
compromised: fresh one. Agent transcripts are exactly the files Lore's synthesis
later reads.

## 4. Price

Run `lore price 0.01` (or the owner's chosen amount — their call, `0.01` is the
recommendation). `lore price 0` is free and a supported place to stop; deploying
the paid node requires a positive price.

If they chose answers, draft two to four lines of **public proxy instructions** from
their confirmed voice. The instructions should tell the agent to answer as their
authorized proxy, cite approved publications, distinguish documented experience
from inference, refuse uncovered questions, and stay concise. Do not copy private
profile or blueprint content. Explain before showing the draft: this is public
behavior guidance, not an API key, secret, access to private memory, or a claim that
the owner is present.

Show the exact instructions and ask for a per-answer price that clears expected model
cost. Write the accepted draft to a temporary text file outside `~/.lore`; do not
enable it yet. If they decline the draft or price, continue without answers.

## 5. Deploy the node

Verify three prerequisites from state, then one command:

0. `node --version` — `lore node deploy` needs Node to stage the Worker and run
   wrangler, and a fresh machine may not have it. Missing? Say what you're
   installing and why, get a yes, then install via the platform's package
   manager (`brew install node` on macOS) **in the background** while the
   wallet/price steps proceed — the owner should never sit watching a package
   manager.

1. `npx wrangler whoami` — not logged in? In Lore desktop call `cloudflare_login`;
   elsewhere see "interactive logins" above. Free tier is enough.
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
smoke-checks the live node with real MCP calls. The staged Worker advertises and
charges the configured price; rerun deploy after changing it. It spends nothing.
If a step fails it prints what to do next; `npx wrangler tail` streams live errors.
Rerunning is always safe — it is also the redeploy path.

Deployed earlier? `lore status` shows the URL as `Node (last deploy):` — ask the
owner only if status cannot answer. After any publication change: `lore push`.

If they chose answers, select Anthropic or OpenAI after the base node exists. From
`~/.lore/node`, the owner enters the provider key through
`npx wrangler secret put ANTHROPIC_API_KEY` or
`npx wrangler secret put OPENAI_API_KEY` in their own terminal; never ask them to
paste it into conversation. For OpenAI, they also run
`npx wrangler secret put LORE_ANSWER_MODEL` and enter `gpt-5.6-luna`. Verify the
secret names with `npx wrangler secret list`.

Then show the exact draft and price again and have the owner run this in a real
terminal:

```sh
lore answer on <temporary-proxy-file> <per-answer-price>
```

The command prints both and asks for approval. Never invoke it, answer its prompt, or
work around its interactive gate. A rejection saves nothing. After approval, run
`lore push`; `lore answer off` plus another push returns to publication-only.

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

## 7. Mainnet — gated, and driven only when the gates hold

Real money is a separate, deliberate step. Never initiate it; the owner asks.
When they do, verify the gates **from state** before driving anything:

1. At least one active publication pushed to the node (a real buyer must
   never pay real USDC against an empty catalog) — `lore publication list`
   and the node's own `discover` manifest.
2. A full test-network payment settled end to end, including one from a
   wallet that is not the owner's own machine.
3. The owner's **explicit** confirmation that they are switching to real
   money — this step, uniquely, is never inferred from context.

Any gate fails → say which, leave the node on the test network, stop.

> **Lore desktop:** all gates hold → frame and open the Coinbase Developer
> Platform's API keys page through `open_url` (the runbook's decoy and
> dialog notes belong in that one line), then call `store_secret` for
> `CDP_API_KEY_ID` and again for `CDP_API_KEY_SECRET` — each shows the owner
> a field whose value goes straight to Cloudflare's vault — then run
> `lore node deploy --network real`. Say "real money" and "the test
> network", never "mainnet". `lore node deploy --network test` goes back.

All gates hold in a terminal → drive the **Mainnet cutover** section of
`~/.lore/node/README.md` like any other section of this skill: one step at a
time, announce each portal page before opening it, verify each step from
state. The runbook carries the sharp edges — the API-keys page hides behind
an "API key wallets" decoy; the create dialog's right answers (opt out of IP
allowlisting for a Worker, leave the account scopes unchecked); secrets are
scoped to the worker's *name*, so any rename happens before vaulting; and the
key values go from the CDP tab into `wrangler secret put` prompts in a real
terminal — they live in Cloudflare's vault, never on this machine and never
in this conversation. The test-network facilitator needs no keys; CDP is the
only facilitator that settles Base mainnet.

After the cutover deploy, close the loop where the owner can see it: the
server names itself `Lore x402 (MAINNET)` and `discover` reports
`network: eip155:8453` — show both. The first real purchase needs a buyer
holding real USDC; there are no mainnet faucets, and the throwaway test buyer
stays on the test network.
