# Initial monetization MVP

Design notes for the `lore-monetize` skill — the Monetize branch of
`docs/full-service-onboarding.md`. Transposed from a paper sketch (2026-07-30, Shane) and
reconciled against the current `main`.

## What this is

`lore price` already stores a fixed answer price, and `origin/codex/x402-payments`
already implements the machinery that charges it: an in-process x402 gate on the `answer`
tool, verified and settled through Coinbase's hosted CDP facilitator, paid in USDC on
Base.

What is missing is the part a human has to do. That branch reads its configuration from
four environment variables and fails with `LORE_X402_PAY_TO is required for paid answers`
if the owner has not already produced a wallet address and a pair of CDP API keys — with
no guidance anywhere on how to get either.

`lore-monetize` is that missing guidance, as a skill: state what is needed, walk the owner
to a Coinbase Wallet address, persist it in Lore, collect the CDP credentials, set a
price, and prove the whole path works with a real payment on a test network before any
mainnet money moves.

## The shape

```
[owner] → lore-monetize → Show info needed → Open Coinbase Wallet
        → copy receiving address (Base) → save in Lore
        → CDP API keys → set price → test transaction (testnet) → go live
```

## Where payment actually happens

Worth being explicit, because the repo's README is currently stale on this point.

Payment is enforced **in-process, at the MCP layer**, by Lore itself:

```
buyer agent
    │  tools/call answer
    ▼
Lore /mcp ──► x402 gate (lore/payments/) ──► payment-required challenge
    │                                              │
    │                                     buyer authorizes, retries
    │                                              ▼
    │                            Coinbase CDP facilitator: verify → settle
    ▼                                              │
publications WHERE active=1  ◄─── payment confirmed┘
    │
    ▼
bounded, owner-approved answer
```

One transport note, because the protocol's name invites confusion: at the MCP layer the
challenge is **in-band** — `tools/call` succeeds at the transport level and the payment
requirements come back inside the tool result, via x402's MCP wrapper. "402" survives as
the protocol's name, not as an HTTP status an implementer should go looking for in this
path.

There is no edge gateway in this path. `MON-001` — the Cloudflare Tunnel / Monetization
Gateway deployment guide — was closed **obsolete** on 2026-07-29 precisely because this
design supersedes it. The README's Cloudflare and x402-at-the-edge sections are known
stale; PR #19 strips them.

Two consequences:

- **Monetization does not require deployment.** A loopback `lore serve --transport http`
  behind any tunnel the owner already runs can charge for answers today.
- **Deployment does not require monetization.** A deployed node with no price is free.

One seam is deliberately **unresolved**: everything above describes a locally-served
node. A *deployed* node (`docs/deployment-mvp.md`) runs a handler over an exported
bundle, not `lore serve` — so a paid deployed node needs this gate running inside the
cloud handler, which is plausible on Lambda (Python) and unscoped on a Cloudflare Worker
(the Python x402/CDP stack does not run there). Flagged for investigation as `XC-004`;
nothing in this doc assumes its outcome.

`discover` stays free and unpaid, as the README promises — the gate is on `answer` only.

## What the owner needs, and why each

The skill's first step is to show all of this at once, before asking for any of it. The
sketch calls this "show user info needed", and it is doing real work: the owner learns the
total cost of the branch before investing in step one, instead of discovering the CDP
signup three screens in.

| What | Why | Secret? |
|---|---|---|
| A Coinbase Wallet **receiving address** on Base | Where buyers' USDC lands. Becomes `LORE_X402_PAY_TO`. Must be a `0x` EVM address. | No — public by design |
| **CDP API key id** | Identifies Lore to Coinbase's x402 facilitator for verify/settle | No |
| **CDP API key secret** | Signs the short-lived JWTs for those calls | **Yes** |
| A **price** per answer, in USD | What the gate charges. `lore price 0` means free. | No |
| A **test network** run | Proves the path before real money | — |

### Why a self-custody wallet address, not an exchange deposit address

A Coinbase *exchange* deposit address is custodial and **may rotate**. x402 settles to
whatever address is configured; if that address stops being the owner's, payments succeed
and the money goes somewhere else — a silent failure with no error to surface. A Coinbase
Wallet address is stable and owner-controlled, so it is what the skill walks the owner to.
Any stable EVM address the owner controls works; Coinbase Wallet is the recommended
on-ramp, not a requirement.

The owner is receiving cryptocurrency into an address they control. The skill should say
that plainly once — including that Lore never holds, custodies, or can recover those funds
— and should not attempt tax or regulatory advice.

## Requirements

### Functional — disclosure and capture

- **FR1** The skill SHALL show the complete list of what is needed — wallet address, both
  CDP credentials, a price, and a testnet run — before asking for the first item.
- **FR2** It SHALL state, in that same first step, that Lore never holds or can recover
  the funds, and that the address is the owner's alone.
- **FR3** It SHALL walk the owner to a Coinbase Wallet receiving address on Base, and
  SHALL explain why a rotating custodial deposit address is unsafe here.
- **FR4** It SHALL validate the address as `0x` + 40 hex before accepting it, and reject
  anything else with a specific error rather than deferring to a runtime failure.
- **FR5** It SHALL persist the pay-to address and network in Lore as settings — they are
  not secrets.
- **FR6** It SHALL NOT accept, request, or handle the CDP key secret in conversation —
  a secret pasted into an agent session lands in transcripts under
  `~/.claude/projects/`, the very files synthesis later reads. The skill directs the
  owner to run the credential command (FR11) themselves, then verifies that payment
  configuration validates without ever seeing the value.
- **FR7** It SHALL set the price through `lore price`, and SHALL confirm that `0` means
  free rather than silently disabling the gate.

### Functional — configuration precedence

- **FR8** `PaymentConfig` SHALL resolve the pay-to address and network from Lore's
  settings when the environment does not supply them, so the skill's persisted values
  actually take effect. Environment variables SHALL win where both are present.
- **FR9** `validate_paid()` SHALL name the *missing* item in owner-facing terms ("no
  payout address configured — run the monetize skill"), not only the environment variable.
- **FR10** A price greater than zero with incomplete payment configuration SHALL fail
  loudly at server start, not on the first buyer's call.

### Functional — secret handling

- **FR11** A `lore` command (proposed: `lore payment auth`) SHALL prompt for the CDP
  key id and secret directly on the owner's terminal with echo off (getpass-style) and
  write them to a `0600` file under `$LORE_HOME` (or the OS keychain where available) —
  not `lore.db` alongside memory content, and not any prompt file under
  `~/.lore/automation/`. That prompt is the only *interactive* input path for the
  secret — no agent, skill, or command argument ever carries it. The environment
  variable remains for headless and deployed contexts.
- **FR12** No Lore command output, error message, or MCP response SHALL ever contain the
  secret, whole or partial.
- **FR13** Where the node is deployed (`docs/deployment-mvp.md`), the secret SHALL be
  installed into the provider's secret manager, and SHALL NOT travel in the publication
  bundle or a function environment literal.

### Functional — the test transaction

- **FR14** The skill SHALL default to **Base Sepolia** (`eip155:84532`) for the first run
  and SHALL NOT configure mainnet until a testnet payment has verifiably settled.
- **FR15** The test SHALL have a buyer: a minimal x402-capable client harness (proposed:
  `lore payment test-buy`, shipped by `MON-002`) driven by a second, owner-controlled
  testnet wallet. The skill SHALL walk the owner through funding that wallet from a
  Base Sepolia USDC faucet — without this, the test transaction has no payer and cannot
  run.
- **FR16** The test SHALL exercise the full path through the harness: an unpaid `answer`
  returning the payment-required challenge, then a paid retry returning owner-approved
  content.
- **FR17** It SHALL assert the unpaid challenge discloses no publication content — a
  payment gate that leaks the answer in its own challenge is worse than no gate.
- **FR18** On success it SHALL show the owner exactly what changes when switching to Base
  mainnet (`eip155:8453`), and SHALL require an explicit confirmation for that switch.
- **FR19** If the facilitator is unreachable or settlement fails, the skill SHALL leave
  the price unset rather than half-configuring a node that challenges every buyer and
  can never settle.

### Non-functional / constraints

- **NFR1** Monetization is independent of deployment in both directions.
- **NFR2** `discover` stays free. The gate applies to `answer` only.
- **NFR3** Lore builds no payment rail, holds no funds, and takes no fee. It configures an
  existing one.
- **NFR4** Free is the default and stays a first-class end state. An owner who reaches the
  end of this skill and sets `lore price 0` has not failed at anything.
- **NFR5** The gate must add no latency to the free `discover` path and must not be
  initialized at all when no price is set — matching the existing
  `gate(price_usd, handler) → None` behavior.
- **NFR6** Nothing here changes what is disclosable. Payment gates access to publications;
  it never widens the set. A paid answer and a free answer read from exactly the same
  `publications WHERE active=1`.

## Harvesting `codex/x402-payments`

This design sits on top of that branch, which lands as its own backlog item (`MON-002`)
before the skill (`MON-003`). What is already there:

| File | What it provides |
|---|---|
| `lore/payments/__init__.py` | `gate(price_usd, handler)` — returns `None` when free, validates the price, else builds the x402 gate |
| `lore/payments/config.py` | `PaymentConfig` — the four env vars, Base/Base-Sepolia allowlist, EVM address validation, `validate_paid()` |
| `lore/payments/coinbase.py` | `CoinbaseAuth` — short-lived CDP JWTs; the hosted facilitator client |
| `lore/payments/x402.py` | `gate()` — the `exact` EVM scheme on the configured network, wrapping the `answer` tool at `mcp://tool/answer` |

Four changes that branch needs before it is enough:

1. **FR8's settings fallback.** `CONFIG = PaymentConfig()` is a module-scope singleton
   populated from `os.environ` at import. As written, a pay-to address the skill persists
   into Lore has no effect — the skill would have to instruct the owner to export
   environment variables by hand, which is most of the friction this branch was meant to
   remove.
2. **New runtime dependencies.** PR #19 already introduces `pydantic` for the store
   models, so the README's "no dependencies beyond Python 3.10+ and SQLite" claim breaks
   at that merge — before this branch. `x402` and `cdp` are the additional payment-only
   packages; the installer decision covers both events, and the payment imports must
   stay lazy enough that an owner who never monetizes never needs them. `MON-002` owns
   that decision.
3. **The credential command (FR11).** The branch reads the CDP secret from the
   environment only; the owner-facing path needs the echo-off prompt and `0600` file so
   the secret never transits an agent conversation.
4. **The buyer harness (FR15).** Nothing in the branch can *pay*; without a minimal x402
   client there is no way to run the testnet transaction `MON-003` requires.

## What this intentionally does not do

- **No dynamic pricing.** The README sketches value-based pricing; the MVP is one fixed
  price for every answer, which is what x402's payment challenge already quotes.
- **No per-buyer identity, quotas, or rate limits.** Future work in the README, still
  future work here.
- **No refunds, disputes, or partial settlement.** That includes the window where
  settlement succeeds and answer production then fails — the buyer has paid for
  nothing. Accepted for the MVP and recorded in `MON-002`: the answer is a cheap read
  of pre-approved content, so the window is small, but it is not zero.
- **No chain or asset choice.** USDC on Base, and Base Sepolia for the test. Other
  networks are rejected by `PaymentConfig`, deliberately.
- **No wallet creation inside Lore.** The skill points at Coinbase Wallet; the owner
  creates and holds it.
- **No repeated-query extraction protection.** A buyer paying repeatedly to reconstruct
  private material is a real threat the README names, and bounded publications are the
  current mitigation. Nothing in this doc improves it.

## Open follow-ups

- OS keychain vs. `0600` file for the CDP secret. The file is portable and works headless;
  the keychain is safer and does not. Proposed: file, with keychain later.
- Whether the price belongs in `settings` (where it is) or in the payment config, once
  payment config gains a settings-backed path in FR8.
- The README's monetization, privacy-boundary, and "first version" sections still describe
  Cloudflare at the edge. PR #19 strips the `lore/mcp.py` and README mentions; a follow-up
  should make sure the *monetization* narrative also reflects in-process x402. Likely a
  `DOC` item once PR #19 lands.
- Nothing in the MVP tells an owner whether a price is *working* — how many challenges
  were issued, how many settled. Some minimal local counter is probably the difference
  between a configured price and a trusted one.
- Where the gate runs for a *deployed* node is unresolved — `XC-004`, called out above
  and in `docs/deployment-mvp.md`. Do not design against an assumed outcome.

## Related

- `docs/full-service-onboarding.md` — the handoff this branches from
- `docs/deployment-mvp.md` — hosting, which this is independent of
- Backlog: `MON-002` (land the gate), `MON-003` (the skill), `XC-004` (deployed-paid
  investigation)
- `MON-001` — closed obsolete; why Cloudflare is not in this path
- `STO-001` / `XC-002` — what a paid answer is allowed to contain
