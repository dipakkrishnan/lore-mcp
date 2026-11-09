---
id: XC-116
title: Give agents a front door: llms.txt, robots.txt and JSON twins
priority: P0
effort: S
component: cross-cutting
status: completed
related: [XC-117, XC-120, MON-051, XC-074]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-31
updated: 2026-10-31
---

## Problem

The site tells visitors that "other people's agents pay you," but an agent that lands on
yourlore.dev sees pages built for people. `/llms.txt` and `/robots.txt` both return the home
page HTML. The only machine-readable data is `/marketplace.json`, which lists sellers but no
pieces or bids. To read or buy anything, an agent has to discover the lore-buy skill on GitHub
and then visit each seller's store.

## Proposed approach

- **`/llms.txt`.** About 15 lines on what Lore sells and what it never sells, how to search,
  how to bid, how to buy, and where the MCP server is.
- **`/robots.txt`.** Allow AI crawlers, and point to `llms.txt` and the sitemap.
- **`/marketplace.jsonl`.** One line per piece and per open bid, with full metadata: market,
  seller handle, price, `useful_if`, sample, updated, times sold. Code-mode agents download
  it once and filter it in code.
- **JSON twins.** Every marketplace, market, piece and bid page links its JSON with
  `<link rel="alternate" type="application/json">`.
- **Forms for writes.** Most fetch tools can only send GETs, so anything an agent can do is
  also a plain HTML form.

## Acceptance criteria

- [x] `/llms.txt` and `/robots.txt` return text, not the home page.
- [x] `/marketplace.jsonl` lists every listed piece and open bid with the fields above. A test compares it to the HTML marketplace.
- [x] Every human page links a JSON twin.

## Notes

Oct 31 call: build on primitives agents already use well (browsers, HTML, MCP). Don't build
the architecture around A2A agent cards until it's clear which one wins.

Built Oct 31 in `site/src/agents.js`, from the same `Exchange` the marketplace pages render.
The test reads the piece URLs out of the marketplace page's own structured data and requires
`/marketplace.jsonl` to match them exactly, so the two can't drift.

- **Pages with a twin:** the marketplace (`/marketplace.json`, plus `/marketplace.jsonl`), each
  market (`/marketplace/<market>.json`), and each store's piece and collection page
  (`/p/<id>.json`, which the store already served for checkout). Bid pages are XC-115's and
  link their own twin when they land. The home page is the static download page and has no
  data of its own. A store's front page has no JSON twin; its machine form is `discover`
  over MCP.
- **Bids:** `openBids` reads the contract's own `GET /bids.json` through this Worker, only
  when the `BIDS` binding exists, and keeps only named public fields. Until MON-051 lands it
  emits nothing, and `/llms.txt` says nothing about bids.
- **Not included:** times sold. Stores don't publish it in `discover`, and nothing else on
  the site knows it yet.
- **Sitemap:** piece pages live on sellers' stores, on other hosts. Crawlers that only accept
  same-host URLs skip those lines and keep the rest.
- **Forms for writes:** the only write is a bid, and its plain HTML form is MON-051's `/bids`.
- Live after `cd site && npx wrangler deploy`, and the piece-page twin link after each store
  redeploys.
