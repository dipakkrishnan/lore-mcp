---
name: lore-enable-payments
description: Set up payments for a Lore node, so other agents pay to call `answer`. Walks the owner to a Coinbase Wallet payout address on Base, sets a price, and proves the path with a real transaction on a test network before any mainnet money moves. Use when the user says "enable payments on Lore", "monetize my lore", "charge for answers", "get paid when agents use my Lore", or picks the Monetize branch after onboarding.
---

# Enabling payments

This skill configures a payment rail. It does not earn anything. The owner can finish
every step here and never receive a cent — earning happens later, when some other
agent calls `answer` and pays for it. Say that plainly if they seem to expect
otherwise; do not sell the outcome.

**Free is a first-class end state.** An owner who reaches the end of this and runs
`lore price 0` has not failed at anything. A Lore that is never monetized has already
paid for itself through private recall. Do not treat any step here as a funnel.

## 0. Preconditions

```sh
lore status           # confirms install, and shows how many active publications exist
lore payment status   # what is already configured; safe to re-run at any point
```

Both are read-only. `lore payment status` never prints a secret, so it is safe to run
in front of anyone.

Two things to check before starting, and to say out loud if either is true:

- **No active publications.** A paid node with nothing published answers nothing, and
  a buyer pays for an empty result. Stop and point them at publishing first; there is
  nothing to sell yet.
- **The payments extra is not installed.** If `lore payment status` fails on an import,
  reinstall with `uv tool install --force 'lore-mcp[payments]'`. Paying is optional, so
  the packages that do it are optional too.

This skill is resumable. Every step reads its state from `lore payment status`, so if a
session dies partway, run it again and continue from the first thing that is not
configured. Never re-ask for something already set.

## 1. Show the whole cost first

Before asking for anything, tell the owner everything this will take. They should learn
the total price of the branch now, not discover a Coinbase signup three screens in.

| What | Why | Secret? |
|---|---|---|
| A Coinbase Wallet **receiving address** on Base | Where buyers' USDC lands | No — public by design |
| A **CDP API key id** | Identifies this node to Coinbase's x402 facilitator | No |
| A **CDP API key secret** | Signs the calls that verify and settle payments | **Yes** |
| A **price** per answer, in USD | What the gate charges | No |
| A **second testnet wallet**, funded from a faucet | Something has to *pay* the test transaction | Lore can create one; its key is secret |

If they have no crypto wallet at all, that is fine and expected — step 2 walks through
creating one, and step 5 creates the test wallet for them. The only account they have to
sign up for themselves is Coinbase Developer Platform.

Then say this once, plainly:

> The address is yours alone. Lore never holds, custodies, or can recover these funds.
> You are receiving cryptocurrency into a wallet you control.

Do not offer tax or regulatory advice at any point, including if asked directly. Say it
is outside what you can advise on.

Ask whether they want to continue. If not, stop cleanly — `lore price 0` and nothing
else is a complete, supported outcome.

## 2. The payout address

**Ask first whether they already have an EVM wallet.** Any of MetaMask, Rainbow, Rabby,
Coinbase Wallet, or a hardware wallet works — the requirement is an address on Base that
they control and that will not change. If they have one, skip to copying the address.

If they do not, walk them through creating one. Do not narrate click-by-click UI from
memory; app layouts change and a confidently wrong instruction is worse than none. Give
them the shape and let them find it:

1. **Install Coinbase Wallet** — the self-custody wallet, either the browser extension
   or the mobile app. It is a different product from the Coinbase exchange app, and the
   difference matters (see below). Get it from `coinbase.com/wallet`.
2. **Create a new wallet.** It will show a recovery phrase.
3. **Write the recovery phrase down offline and store it somewhere safe.** Whoever has
   it has the money. Nobody — not Coinbase, not Lore, not you — can recover it if it is
   lost. Say this plainly and do not move on until they confirm they have done it.
   **Never offer to store, hold, or write down the recovery phrase yourself, and never
   accept it if they paste it.** If they paste it, tell them to move the funds to a
   freshly created wallet.
4. **Switch the network to Base.** Coinbase Wallet supports it natively.
5. **Copy the receiving address.** It starts with `0x` and is 40 hex characters after
   that. The same address works whether or not the network selector says Base — an EVM
   address is the same across EVM chains — so what matters is that buyers pay on Base,
   which Lore configures.

Explain *why* it must not be a Coinbase **exchange** deposit address, because the failure
it prevents is silent:

> An exchange deposit address is custodial and may rotate. Payments settle to whatever
> address is configured — so if that address stops being yours, payments keep succeeding
> and the money goes somewhere else. There is no error to notice.

A CDP-managed account (created through the Coinbase Developer Platform SDK) is also a
valid payout target, and is worth mentioning to someone who is already comfortable with
CDP. Do not steer a first-time owner there: it puts key custody in a service rather than
their hands, and this step is the one place where that tradeoff should be theirs.

Then persist it:

```sh
lore payment payout 0xYOUR_ADDRESS_HERE
```

The command validates the address as `0x` plus 40 hex characters and refuses anything
else. If it refuses, do not work around it — a wrong address here is money sent to
nobody. Ask them to re-copy it from the wallet.

Leave the network alone. It defaults to Base Sepolia, the test network, and step 6 is
the only place that changes.

## 3. Credentials — which you never see

The owner needs a Coinbase Developer Platform account and an API key. This is a separate
signup from the wallet in step 2, and a separate thing from a Coinbase exchange account.

1. Sign in at `portal.cdp.coinbase.com` and create a project.
2. Create a **Secret API Key** at `portal.cdp.coinbase.com/api-keys/secret`.
3. The portal shows the key id and the key secret. **The secret is shown once.** Have
   them keep it on screen for the next command rather than closing the page.

They do not need a CDP Wallet Secret for this — that is for CDP-managed accounts, and
step 2's wallet is their own.

Then have them run this **themselves**, in their own terminal:

```sh
lore payment auth
```

It prompts for the key id and the secret with echo off and writes them to a `0600` file
under `$LORE_HOME`.

**Do not ask for, accept, or repeat the key secret.** Not in a message, not in a command
argument, not "just to check it". A secret pasted into this conversation lands in a
transcript under `~/.claude/projects/`, which is exactly what Lore's own synthesis reads
later — the secret would end up in the memory library it is meant to protect. If they
paste it anyway, tell them to rotate the key in the CDP portal and run
`lore payment auth` again.

Confirm it worked without seeing anything:

```sh
lore payment status
```

Both credential lines should read `configured`.

## 4. Set the price

```sh
lore price 0.05
```

One fixed price for every answer, which is what the payment challenge quotes. There is
no per-buyer or per-query pricing yet — say so rather than implying it can be tuned.

Confirm what `0` means before they pick: `lore price 0` makes answers free and builds no
payment gate at all. It is the off switch, not a broken state.

If the price is set before payment is configured, `lore price` says so and names what is
missing. That is a warning, not a failure — but the node cannot collect until it is
resolved.

## 5. Prove it works, on a test network

Nothing goes to mainnet until a real payment has settled on Base Sepolia.

**The test needs a payer** — a *second* wallet, never the payout wallet, since a node
paying itself proves nothing. Lore can make one:

```sh
lore payment auth --buyer --generate
```

That creates a throwaway testnet wallet, stores its key in the same `0600` file, and
prints only its address. Prefer this over having them export a private key out of a real
wallet, which is a habit worth not starting. If they would rather use a wallet they
already have, `lore payment auth --buyer` prompts for the key with echo off instead.

Then have them fund that address with **Base Sepolia USDC** from a testnet faucet — the
Coinbase Developer Platform portal has one, as does Circle. It is play money on a test
network.

The buyer does not need testnet ETH for gas. The payer signs an authorization and the
facilitator submits the transaction, so USDC is the only thing that wallet needs.

Start the node in one terminal:

```sh
lore serve --transport http
```

It prints whether answers are paid or free. If it exits instead, it will name exactly
what is missing — fix that and start it again.

Then, in another terminal, buy one answer:

```sh
lore payment test-buy what do you know about deployment
```

That runs the whole path: an unpaid call that comes back as a payment challenge, then a
paid retry that returns owner-approved content. It also checks that the challenge did
not disclose any publication content — a gate that leaks the answer while asking to be
paid is worse than no gate — and refuses to continue if it did.

On success it reports the buyer address, the payout address, the network, and the
settlement transaction. Show the owner the transaction id; it is the proof.

**If the facilitator is unreachable or settlement fails, run `lore price 0`.** Leave the
node free rather than half-configured. A node that challenges every buyer and can never
settle is worse than a free one: it turns away everybody and tells nobody why.

## 6. Going live on mainnet

Only after a settled testnet payment, and only if they ask.

Say exactly what changes:

> Switching to Base mainnet means payments settle in real USDC to your payout address.
> The test network money was fake. This is not. Your price stays what it is; the network
> and the funds become real.

Get an explicit yes — not an assumed one, not a continuation of earlier consent. Then:

```sh
lore payment payout 0xYOUR_ADDRESS_HERE --network base
lore serve --transport http
```

The node must be restarted for a network change to take effect. Confirm with
`lore payment status`, which flags mainnet as real money.

## 7. Hand back

Tell them:

- what the node charges, and where the money lands;
- that `discover` is still free, so buyers can tell whether this node is worth paying
  before paying — the gate is on `answer` only;
- that payment changes *who* gets an answer and never *what* is answerable: a paid
  answer reads exactly the same publications a free one did;
- that `lore price 0` turns charging off at any time, with no other cleanup.

## Rules

- Never ask for, accept, echo, or store a key secret or a private key in this
  conversation. `lore payment auth` is the only path, and the owner runs it.
- Never accept, repeat, or offer to record a wallet recovery phrase. If one is pasted,
  say so and tell them to move the funds to a new wallet.
- Never write `~/.lore/payment.json`, `lore.db`, or any Lore file directly — only
  through `lore payment payout`, `lore payment auth`, and `lore price`.
- Never configure mainnet before a testnet payment has settled, and never without an
  explicit confirmation for that specific step.
- Never present monetizing as the expected outcome of onboarding. Deploying and
  monetizing are independent, and doing neither is a supported end state.
- If a step fails, stop and report it. Do not retry-loop against a payment facilitator.
