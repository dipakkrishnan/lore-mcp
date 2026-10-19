---
id: MON-046
title: Sign every sale and approval into a public append-only receipt log
priority: P1
effort: XL
component: monetization
status: in-review
related: [XC-067, CAP-036, MON-037, MON-040, XC-039]
blockers: []
dependencies: [public dipakkrishnan/lore-receipts repo with a Contents-write PAT, receipts Worker secrets (Ed25519 signing key, payer HMAC key), a Base RPC endpoint, Sigstore Rekor public instance]
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/467
created: 2026-10-16
updated: 2026-10-16
---

## Problem

A sale is one row in the seller's own D1, which the seller can edit, and
nothing anywhere else. A seller can't prove a sale, a buyer can't prove what
they bought or on what terms, and a future lab licensee can't check that a
piece was approved by its owner, where it came from, or for what use. Lore is
turning into an exchange for owner-approved context that personal agents
write (XC-067). The owner's question becomes "what was my note used for, by
how many, for how much, and did I agree to that?" The answer has to be a
record that nobody can fake, Lore included.

## Proposed approach

**The payment rails are the truth, and the log is a signed index over
them.** Lore signs a sale only after checking it on the rail. If the log or
the key is lost, every sale receipt can be rebuilt from Stripe and Base.

**Records.** Each record is canonical JSON (RFC 8785, integers only, money
as `usd_micros`, `v` and `type` on every record), hashed with SHA-256 and
signed with Ed25519 by Lore's key (`kid` = first 16 hex of the key's hash).

- `approval` is written when the owner approves or pushes a version. It holds:
  - the store, the piece, a version, and the content hash
    (`sha256(JCS({title, content, kind}))`)
  - the source kinds, typed: `{kind: "agent", app: "grok"}` or
    `{kind: "feed", app: "substack"}`. Only kinds, never memory ids, text or
    fingerprints (a hash of a short note can be guessed). An agent's kind
    comes from its inbox credential, not from the agent's own claim.
  - `uses` (`read`, `answer`; `train` is never granted by default)
  - the floor price, the time, and `prev` (the earlier approval of this
    piece).
- `withdrawal` points at an approval and gives a scope (`sale`, later
  `train`).
- `sale` is one record per rail payment. Its id is `sha256(rail‖tx)`, so
  retries collapse. It holds a hashed rail reference, gross and Lore fee,
  and an optional `basket`. `lines[]` holds (store, piece, content hash,
  approval hash, use, `share_bp`, `usd_micros`). Nothing about the buyer
  appears in it.
- `reversal` points at a sale, with a reason: refund, dispute,
  dispute_won, or settlement_failed. No record is ever changed in place.

**The receipts Worker** (`receipts/`, `receipts.yourlore.dev`) runs on
Lore's account with its own key, apart from checkout so the key's blast
radius stays small. One SQLite Durable Object is the single writer.

- **Card sales and reversals** come from checkout's Connect webhook through
  a service binding. Checkout created the session, so the sale is already
  checked. It adds handling for `charge.refunded` and `charge.dispute.*`.
- **x402 sales** are sent by the node after `recorded()` in `ctx.waitUntil`,
  with a `pending` retry. The Worker signs one only after a Base RPC lookup
  shows a USDC transfer of at least the listed price to that store's
  registered `payTo`.
- **Approvals and withdrawals** are posted by `lore push`.
- **A sale never waits on the ledger.**
- **Buyer tags.** The ledger keeps a private
  `payer_ref = HMAC(secret, store‖payer)`, used for unique-buyer counts and
  for spotting wash sales. It is never signed and never published.

**Checkpoints.** Each UTC day, the Worker builds an RFC 6962 Merkle tree of
that day's entries and signs a checkpoint: `{day, count, root, prev, kid}`.
A cron commits it to the public `lore-receipts` repo and uploads it to
Sigstore Rekor. The chain is at the checkpoint level, not per entry, so an
inclusion proof never exposes other sellers' entries. Keys live in
`keys.json` in the repo. A rotation is announced by a checkpoint signed by
both keys. If a key is compromised, everything already anchored in Rekor
before the compromise stays valid.

**Verifying.**
- `GET /r/:id` returns the receipt, and `GET /proof/:id` returns the Merkle
  path and the checkpoint.
- `lore receipts verify` checks the signature against the repo's keys, the
  path against the root, and the root against GitHub and Rekor.
- **The seller is the monitor.** Every day the app checks that each of its
  receipts appears in yesterday's checkpoint. For Sale reports any that are
  missing.

**Attribution.** Every payment has exactly one payee (a direct charge on one
Stripe account, or a USDC transfer to one wallet). So, in v1:
- A cross-seller basket is N payments sharing a `basket` id.
- Inside one seller's payment (a collection, or an answer citing several
  pieces), the split is equal, chosen by Lore's code. It only feeds stats.
- Pooled splits after the fact need either a pot (custody) or a splitter
  contract. That is a founder decision before any lab licensing.

**The seller-facing view.** Per piece: "used in 3 purchases this week ·
$14 · for answering, not training". `lore node receipts --json` gives the
same numbers.

## Acceptance criteria

- [ ] A card sale and an x402 sale each produce exactly one signed receipt; a resent webhook or a node retry never produces a second.
- [ ] A node reporting a tx that doesn't pay its `payTo` the listed price gets no receipt.
- [ ] A refund or dispute appends a reversal; an x402 tx missing at checkpoint time appends `settlement_failed`; nothing is edited.
- [ ] A push writes an approval whose content hash matches what `get` and the kept card copy deliver; an agent-sourced piece names `{kind: "agent", app}` from the credential; a takedown writes a withdrawal.
- [ ] Records and public endpoints never contain content, titles, memory text or ids, buyer wallet or email, Stripe account id or raw tx (asserted on the serialized forms).
- [ ] A daily checkpoint is committed to the repo and uploaded to Rekor, each naming the one before.
- [ ] `lore receipts verify` passes for a real receipt and fails when a byte of the record, the path or the root changes, or when the key is wrong.
- [ ] The app reports a receipt left out of its day's checkpoint within a day.
- [ ] With the receipts Worker down, `get`, card unlock and free copies behave exactly as today, and pending receipts are logged once it is back.
- [ ] A rotation checkpoint signed by both keys verifies across the boundary.

## Notes

- Oct 16 design, combined from two independent designs (Fable and Opus)
  reviewing the codebase.
- What they agreed on: JCS + SHA-256 + Ed25519, an approval record plus a
  sale record, a central Lore Worker (the node runs in the seller's own
  account and can't hold Lore's key), daily chained Merkle checkpoints, no
  buyer identity, reversals as new records, equal split in v1, and one
  payee per payment.
- Where they differed, and what was picked:
  - Check sales on the rail, not by reading the receipt back from the node.
    A read-back proves control of the origin, not that money moved.
  - Source kinds only, not fingerprints.
  - The seller as monitor.
  - Rekor alongside GitHub, because Lore can force-push its own repo.
  - Free copies are not logged, since there is no rail to check them
    against.
- Build as five PRs, in this order:
  1. contracts and hashing helpers in TS and Python (S)
  2. approval records on push (M)
  3. the receipts Worker (L)
  4. node x402 reporting and the app's inclusion audit (M)
  5. checkout reversals, the app view and `verify` (M)

  The receipts Worker and the node reporting can be built in parallel
  against the contract.
- Later items:
  - `train` use and a revocation feed (with the first lab customer)
  - owner-device consent signatures
  - a cross-seller cart
  - a split rail (blocked on the custody decision)
  - public badges from distinct payer tags
  - weekly on-chain anchoring of the checkpoint hash
- Bids (#467) settle as ordinary sales; a bid fill puts its bid id in
  `basket`.
