---
id: XC-116
title: Give agents a front door: llms.txt, robots.txt and JSON twins
priority: P0
effort: S
component: cross-cutting
status: ready
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

- [ ] `/llms.txt` and `/robots.txt` return text, not the home page.
- [ ] `/marketplace.jsonl` lists every listed piece and open bid with the fields above. A test compares it to the HTML marketplace.
- [ ] Every human page links a JSON twin.

## Notes

Oct 31 call: build on primitives agents already use well (browsers, HTML, MCP). Don't build
the architecture around A2A agent cards until it's clear which one wins.
