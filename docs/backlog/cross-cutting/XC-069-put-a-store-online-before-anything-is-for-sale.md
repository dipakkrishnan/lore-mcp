---
id: XC-069
title: Put a store online to receive agent saves before anything is for sale
priority: P0
effort: M
component: cross-cutting
status: in-review
related: [XC-067, APP-207, APP-215]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-17
---

## Problem

An owner's agent can only save to Lore once their store is online, and
putting a store online today requires a price above zero, an approved piece
and a payout address. A new owner who only wants Grok Bot to save memories
can't get a connect link without first deciding how to sell.

## Proposed approach

Allow a store to go online with nothing for sale: the Cloudflare sign-in and
deploy only, with the agent inbox working and the buyer side answering that
nothing is for sale yet. Price, payout and the first piece come later, when
the owner first approves something to sell, through the existing store flow.

## Acceptance criteria

- [x] A store with no price, payout or pieces deploys and accepts agent saves.
- [x] Buyers calling it see nothing for sale, with no errors.
- [x] The first approved piece walks the owner through price and payout as today.
- [x] Node and edge tests cover the empty store.

## Notes

- Oct 17, built on `xc-069-store-before-sale`:
  - `lore node deploy --inbox-only` (an explicit mode, not a guard that
    relaxes when nothing is approved): the default deploy keeps every price
    and payout guard, and the desktop names its intent instead of relying on
    the library's state. It needs only the Cloudflare sign-in, takes no
    `--wallet` or `--network`, bakes in no price, never reads the wallet,
    still creates D1 and pushes (which carries the inbox keys).
  - Selling is the owner's explicit state, `node_selling`, pushed to the
    node as `node_settings.selling`; it is not derived from `LORE_WALLET`.
    A new store is `false` from the moment its address is recorded and turns
    `true` only after a full deploy has the price, network and payout in
    place. Inbox-only never changes it. A store from before XC-069 has no
    setting and keeps selling.
  - Payment ways stay separate from selling: agent payments (x402) need a
    valid wallet, cards need the connected Stripe account and a price of at
    least $0.50. A selling store with no wallet sells by card only: its
    pages, `.json` listing and free copies work as before, `discover` lists
    the catalog, and `get` answers `cards_only`; `payTo()` is never called.
  - A store not selling: `/mcp` lists the same four tools, `discover`
    returns an empty catalog with `for_sale: false`, `get` and `answer`
    refuse with `{"error": "nothing is for sale here yet", "code":
    "nothing_for_sale"}`, and the pages show "Nothing for sale yet." with
    every piece page 404. `/agent` works with no `LORE_WALLET` at all.
  - A failed `wrangler secret list` on a full deploy stops it with a plain
    error instead of reading as "no wallet".
  - In the app, approved pieces read "ready to sell" until the store opens
    for sale; the first one offers "Open your store" with a price and where
    payments go; approvals don't push; the marketplace row is hidden; the
    agents' setup thread is subtitled "Sign in to Cloudflare".
  - Round 3: a deploy of a store with no address yet writes
    `node_selling = false` before anything else, so a custom route (no
    workers.dev address printed) never tells the node to sell. A push sends
    `selling = true` only for an explicit yes or a store whose address
    predates the setting, and while not selling it sends no piece at all:
    settings and the agents' inbox keys only (a local dev push always sells).
    The Worker treats unreadable settings as not selling. Inbox-only on a
    store already selling needs a price it can charge, like a full deploy.
    Its job history reads "Your store is online for your agents".
- Deferred: a card-only store (reachable only by deleting `LORE_WALLET` by
  hand) still has page copy about paying in USDC, and its MCP `get` gives
  no free copies (the pages do).
- Round 4: the Python suite is hermetic (`tests/hermetic.py`, loaded by
  `helpers.py`, `conftest.py` and every test file that doesn't use helpers):
  any npm, npx or wrangler call a test didn't stub raises, and wrangler and
  npm get an invalid Cloudflare token, a throwaway config and cache, and no
  network. A refusal test had reached a real account through this Mac's
  wrangler login when a guard was mutated off.
- Round 6 (replaces round 5's upgrade guess): `node_selling` has three
  states, and none is guessed from local files.
  - Unset is every store from before XC-069 and behaves exactly as 0.1.15:
    its push carries the pieces and no `selling` key, and the Worker's
    missing-key default sells. That covers a seller who keeps a store with
    `lore push --worker-dir` and never recorded an address.
  - False is written only by a deploy that created a brand-new D1 database in
    that run (`_ensure_d1` reports created, adopted or recorded), before its
    push, and only if the setting is still unset at that moment (one guarded
    statement, so an explicit choice written meanwhile wins). A deploy that
    adopted or found an existing database leaves the setting as it is. While
    false, a push sends `selling=false` and no pieces.
  - True is written only after a full deploy's push landed; that push itself
    sends `selling=true` with the pieces.
  - `--inbox-only` with `LORE_ADOPT_EXISTING_D1` is refused unless the
    store is already explicitly not selling.
  - Round 7: that `false` is written before the new database's id is saved
    to `~/.lore/node/wrangler.jsonc`. If the write fails, no id is saved and
    the deploy fails; a retry finds the database already made and is refused,
    or adopts it with a full deploy that opens it for sale explicitly.
