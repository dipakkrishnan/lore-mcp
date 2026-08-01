---
name: lore-enable-payments
description: Set up a paid Lore node end to end, so other agents pay to call `answer`. Walks the owner to a self-custody payout address, a price, a deployed Cloudflare Worker, and a proven test-network payment — in whichever order they choose. Use when the user says "enable payments on Lore", "monetize my lore", "charge for answers", "deploy my lore node", "put my lore online", or picks the Monetize branch after onboarding.
---

# Enabling payments

This skill configures a payment rail. It does not earn anything. The owner can finish
every step and never receive a cent — earning happens later, when some other agent
calls `answer` and pays for it. Say that plainly if they seem to expect otherwise; do
not sell the outcome.

**Free is a first-class end state.** An owner who stops at `lore price 0`
has not failed at anything. A Lore that is never monetized has already paid for
itself through private recall. Do not treat any step here as a funnel.

The deployed node serves the owner's **approved publications** — nothing else exists
at the edge. With zero active publications the rail still proves end to end, but a
paying buyer would get an empty answer, which is why mainnet is gated on having at
least one.

## How to drive — read this first

The owner should never have to figure out *where to go* or *what comes next*. You
are the guide; the skill is your script.

- **One step at a time.** Say what this step is for in one line, do it or open it,
  confirm it worked, then move on. Never paste the whole flow as a wall of steps.
- **You run everything that is not the owner's browser or wallet.** Every shell
  command in this file is yours to execute, not to quote at the owner. The owner
  personally does exactly three things: log in to Cloudflare, create a wallet, and
  fund/enter the test-buyer key.
- **Open browser steps for them.** When a step needs the owner in a browser, open
  the exact page yourself: `open <url>` on macOS, `xdg-open <url>` on Linux. Say
  what they'll see and what to click before you open it.
- **Verify from state, never by asking.** After each step, read the result:
  `npx wrangler whoami` (logged in? account id?), `lore status` (price, node URL,
  publications), `npx wrangler deployments list` (already deployed?). Resume from
  the first thing not configured; never re-ask for something already set.
- **Interactive logins run in the owner's session.** In Claude Code, tell them to
  type `! npx wrangler login` so the OAuth flow lands in their terminal; elsewhere
  have them run it in their own shell. You never see the credentials either way.
- **Ask choices, don't quiz.** Use AskUserQuestion where available (plain
  conversation on Codex) — one question, with a recommendation.
- **Validate before use.** A payout address must match `^0x[0-9a-fA-F]{40}$`.
  Anything else — including anything that looks like a key or phrase — is refused,
  see step 3.

## 1. Pick the path

Read `lore status` first, then ask one question:

- **Active publications exist → recommend content-first.** They have something worth
  selling; price and deployment are in service of it.
  - *Sell what's published* — continue to step 2.
  - *Rails first* — prove a test payment before anything else; step 2, then straight
    to deploy and the test buy.
- **Zero publications → recommend rails-first.** There is nothing to sell yet, and
  the rails can be proven with nothing at stake.
  - *Rails first* — wallet, price, deploy, test buy, publish later.
  - *Publish first* — route them to the `lore-publish` skill and resume here after.

Either answer runs the same steps in a different order.

## 2. Show the whole cost first

Before asking for anything, tell the owner everything this takes:

| What | Why | Secret? |
|---|---|---|
| A self-custody **payout address** on Base | Where buyers' USDC lands | No — public by design |
| A **Cloudflare account** (free tier) | Runs the Worker that serves and charges | Login is theirs; the skill never sees it |
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
Coinbase Wallet, or a hardware wallet all work — the requirement is an address on
Base that they control and that will not change. Have one? Copy the address, go.

If not, walk them through creating one — you drive, one step at a time:

1. `open https://www.coinbase.com/wallet` — **Coinbase Wallet**, the self-custody
   app (blue square logo), *not* the Coinbase exchange app. An exchange deposit
   address may rotate, and x402 settles to whatever address is configured — payments
   would keep succeeding into an account nobody watches, with no error anywhere.
   App or browser extension both work.
2. **"Create new wallet."** Two possible setups, both fine:
   - *Passkey / Smart Wallet* (Face ID / fingerprint, no phrase shown) — the safer
     default; there is no phrase to mishandle.
   - *Classic* — the app shows a **recovery phrase** and asks them to back it up.
     Paper, then confirm in the app.
3. **Skip everything optional.** No purchase, no identity verification, no funding.
   An empty wallet is the goal — buyers pay *into* it.
4. **Get the address:** Receive (or tap the address at the top) → network **Base**
   if asked → Copy. It is `0x` + 40 hex characters, public by design, safe to paste.
5. Owner pastes it in the conversation; you validate the format before using it.

Never ask for the recovery phrase, and never accept it if pasted — that phrase *is*
the wallet, and nothing legitimate in this flow will ever need it. If it appears in
the conversation anyway, tell them to treat that wallet as compromised and start a
fresh one. Agent transcripts are exactly the files Lore's synthesis later reads.

## 4. Price

Run `lore price 0.01` yourself (or the owner's chosen amount). `lore price 0` is
free and a supported place to stop, not a failure. The price is advertised by the
node; nothing enforces it until the node is deployed.

## 5. Deploy the node

Two owner-side prerequisites, each verified from state before you deploy:

1. **Cloudflare login.** Check `npx wrangler whoami`. If not authenticated: in
   Claude Code have them type `! npx wrangler login` so the OAuth flow lands in
   their terminal; elsewhere they run it in their own shell. Free tier is enough;
   sign-up happens in the browser page wrangler opens. The skill never sees or
   handles that login.
2. **workers.dev subdomain** (one-time per account). If a deploy fails with
   "register a workers.dev subdomain", take the account id from `npx wrangler
   whoami` and open the Workers overview for them:
   `open https://dash.cloudflare.com/<account-id>/workers-and-pages` — the
   "Your subdomain" panel (right column, or the first-visit prompt) is where they
   pick a name; then you retry. Do not use the `/workers/onboarding` URL wrangler's
   error message prints — it 404s on the current dashboard.

Then deploy — one command, you run it (the node source ships inside Lore itself —
no repository, no checkout):

```sh
lore node deploy --wallet <payout-address>   # the public 0x address from step 3
```

It stages the node source at `~/.lore/node`, installs dependencies, creates the D1
database, deploys, stores the payout address as the Worker's `LORE_WALLET` secret
(in Cloudflare's vault, not on this machine), pushes the active publication set,
and then proves the node is actually up: the built-in smoke check makes real MCP
calls — both tools listed, `discover` answers free, and `answer` challenges for
payment without leaking content. It spends nothing.

If a step fails, the command prints exactly what to do next — follow that rather
than improvising, and `npx wrangler tail` in `~/.lore/node` streams the live error
while you re-run. Rerunning is always safe: it is also the redeploy path, and it
never touches a `.buyer.env` the owner created.

If the node was deployed earlier (even in another session), recover the URL from
state rather than asking: `lore status` shows it as `Node (last deploy):`. Ask the
owner only if status cannot answer. After any future publication change, sync the
node: `lore push`.

## 6. Prove one payment on the test network

Something has to pay the node once, so the owner trusts the rail before real money
is near it. Use a **throwaway buyer wallet, never the payout wallet** — a node
paying itself proves nothing.

1. Create the throwaway buyer wallet. The buyer is anything holding a key that can
   sign the challenge, so **generate it locally yourself** — wallet apps with
   passkey accounts cannot export a raw key at all, and `npm run pay` needs one in
   a file. From `~/.lore/node`, generate with viem (already a dependency) and write
   it straight into `.buyer.env`, printing **only the address**:

   ```sh
   node -e "const{generatePrivateKey,privateKeyToAccount}=require('viem/accounts');
   const fs=require('fs');const k=generatePrivateKey();
   const f=fs.readFileSync('.buyer.env.example','utf8').replace('0x...',k);
   fs.writeFileSync('.buyer.env',f,{mode:0o600});
   console.log('fund this:',privateKeyToAccount(k).address)"
   ```

   The key exists only in that file; it never appears in the conversation. (An
   owner who prefers exporting a key from a classic wallet account can — they edit
   `.buyer.env` themselves in their editor, `open -t .buyer.env`; the key still
   never enters the conversation.)
2. Fund the printed address with test USDC: `open https://faucet.circle.com` —
   token **USDC**, network **Base Sepolia**. This is play money.
3. Run the capped buyer from `~/.lore/node` (the node URL is in `lore status`):

```sh
npm run pay -- https://<their-subdomain>.workers.dev/mcp
```

It pays at most $0.01 test USDC and prints the settlement receipt. If it settles,
the whole rail — challenge, signature, facilitator, payout — is proven. If it
fails, stop and fix before going further; a node that challenges every buyer and
can never settle is worse than a free one.

## 7. Mainnet, later — not part of this skill

Real money is a separate, deliberate step, taken only after a two-person paid test
has settled. It requires all of:

- at least one active publication — a real buyer must never pay real USDC for an
  empty answer;
- an **explicit** confirmation from the owner that they are switching to real money;
- Coinbase Developer Platform API keys (from `portal.cdp.coinbase.com`), set as
  Worker secrets with `npx wrangler secret put` in `~/.lore/node` — they live in
  Cloudflare's vault, never on this machine and never in this conversation. The free test-network
  facilitator needs no keys at all; CDP is the only facilitator that settles Base
  mainnet.

If the owner asks to go to mainnet now, say it is gated on the above and leave the
node on the test network.
