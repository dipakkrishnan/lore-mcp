---
id: MON-003
title: Add a lore-enable-payments skill for payout and price configuration
priority: P1
effort: M
component: monetization
status: in-review
related: [MON-002, ONB-002, DEP-001]
blockers: [MON-002]
dependencies:
  - "Coinbase Wallet (owner-controlled, Base network)"
  - "Coinbase CDP account with x402 API keys"
  - "Second testnet wallet + Base Sepolia USDC faucet funds for the buyer harness"
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

Once `MON-002` lands, the machinery to charge for an answer exists — and it reads
its configuration from four environment variables. An owner who sets a price gets
`LORE_X402_PAY_TO is required for paid answers`, with no guidance anywhere in the
repo on how to produce a wallet address or a pair of CDP API keys.

So the monetization path is gated on the owner independently knowing to create a
Coinbase Wallet, find its Base receiving address, sign up for Coinbase Developer
Platform, generate x402 API keys, and export all of it into their shell. Every one
of those steps is a place to quietly give up, and the last one produces a
configuration that does not survive a new terminal.

## Proposed approach

A `lore-enable-payments` skill, per `docs/enable-payments.md`, following the sketch's
steps: show what is needed, open Coinbase, collect the payout address, save it in
Lore, collect the CDP credentials, set a price, test, go live.

**Show the whole cost first.** The skill's opening step lists everything required —
wallet address, both CDP credentials, a price, a testnet run — before asking for any
of it, so the owner learns the total cost of the branch up front instead of
discovering the CDP signup three screens in. It also states once, plainly, that
Lore never holds, custodies, or can recover the funds.

**Self-custody, for a specific reason.** The skill walks the owner to a Coinbase
Wallet receiving address on Base, not an exchange deposit address. A custodial
deposit address may rotate; x402 settles to whatever is configured, so if that
address stops being the owner's, payments succeed and the money goes elsewhere —
a silent failure with no error to surface. Any stable EVM address the owner controls
works; Coinbase Wallet is the recommended on-ramp, not a requirement.

**The skill never touches the secret.** The address and network are settings —
public by design, fine to handle in conversation. The CDP secret is not: a secret
pasted into an agent session lands in transcripts under `~/.claude/projects/`,
the very files synthesis later reads. The skill directs the owner to run
`MON-002`'s credential command themselves — an echo-off terminal prompt writing a
`0600` file under `$LORE_HOME` — then verifies configuration validates without
ever seeing the value.

**Testnet before mainnet, without exception — and the test has a buyer.** The first
run configures Base Sepolia and exercises the full path through `MON-002`'s buyer
harness: an unpaid `answer` returning the payment-required challenge, then a paid
retry returning content. The harness needs a second, owner-controlled testnet
wallet, which the skill walks the owner through funding from a Base Sepolia USDC
faucet. Only after a settled testnet payment does the skill offer the mainnet
switch, and only with an explicit confirmation.

## Acceptance criteria

- [ ] The skill lists every requirement, and states that Lore never holds or can
      recover the funds, before asking for the first item
- [ ] It walks the owner to a Coinbase Wallet receiving address on Base and explains
      why a rotating custodial deposit address is unsafe here
- [ ] It validates the address as `0x` + 40 hex and rejects anything else with a
      specific error, not a deferred runtime failure
- [ ] Address and network persist as Lore settings and take effect without the owner
      exporting environment variables
- [ ] The skill never asks for, receives, or displays the CDP secret in
      conversation; it directs the owner to the credential command, then verifies
      payment configuration validates
- [ ] The price is set through `lore price`, and `0` is confirmed as meaning free
- [ ] The first run defaults to Base Sepolia; mainnet is not configured until a
      testnet payment has verifiably settled
- [ ] The test runs through the buyer harness with a second owner-funded testnet
      wallet (the skill walks through faucet funding): unpaid challenge, then paid
      retry — and asserts the challenge discloses no publication content
- [ ] Switching to Base mainnet requires an explicit confirmation and shows exactly
      what changes
- [ ] If the facilitator is unreachable or settlement fails, the price is left unset
      rather than half-configuring a node that challenges every buyer and can never
      settle
- [ ] Reachable from the `ONB-002` handoff menu and standalone

## Notes

Named `lore-enable-payments`, not `lore-monetize`: the skill configures a payment
rail and cannot produce revenue on its own, so naming it for the outcome
overclaims (Shane, review of PR #33). "Monetize" survives as the handoff *menu*
label in `ONB-002`, where it correctly describes the owner's intent. The
`monetization/` component keeps its name — that is a domain, and `MON-001`
already lives there.

Transposed from Shane's 2026-07-30 paper sketch ("monetize skill → show user info
needed → open Coinbase → direct user to public address to save in Lore"); design in
`docs/enable-payments.md`. Confirmed with Shane: Coinbase **Wallet**, USDC on Base.

Blocked by `MON-002` — there is nothing to configure until the gate lands, and
`MON-002` owns the settings-backed config path, the credential command, and the
buyer harness this skill depends on.

The secret-handling shape (skill never touches the secret) came out of design
review: the earlier draft had the skill collecting credentials in conversation,
which puts a payment secret into agent transcripts and contradicts the repo's own
skip-secrets rule in `lore-onboard`.

Independent of deployment in both directions: a loopback `lore serve --transport
http` behind a tunnel the owner already runs can charge for answers without
`DEP-001`, and a deployed node with no price is free. `DEP-001` is `related` only
because a deployed node needs this secret installed into the provider's secret
manager.

Free stays a first-class end state. An owner who reaches the end of this skill and
sets `lore price 0` has not failed at anything — the *useful before monetized*
principle is the whole reason the Monetize branch is opt-in.

Open in the design doc: keychain vs. `0600` file for the secret (file proposed), and
that nothing here tells an owner whether a price is *working* — some minimal local
count of `402`s issued versus settled is probably the difference between a
configured price and a trusted one.
