---
id: XC-117
title: Serve one marketplace MCP server at yourlore.dev/mcp
priority: P1
effort: M
component: cross-cutting
status: in-review
related: [XC-116, MON-051, MON-053, MCP-003]
blockers: []
dependencies: [XC-116, MON-051]
github_issue: null
created: 2026-10-31
updated: 2026-11-12
---

## Problem

An agent that wants to buy has to connect to each seller's store separately. Nothing lets
someone add "Lore" to Claude, ChatGPT or Grok once and reach every seller and every bid.

## Proposed approach

A plain remote MCP server (Streamable HTTP, not WebMCP) on the site Worker at
`yourlore.dev/mcp`, reading the same data as `/marketplace.jsonl`:

- `search(query, market?, max_price?, seller?)` returns pieces and open bids that match.
- `read_sample(piece)` returns the free sample and the fit lines.
- `buy(piece)` returns the seller store's payment route (x402 or a card link). Lore doesn't
  hold the money.
- `bid(question, usd, market?, callback_url?)` returns the bid id and status URL right away.
- `check_bid(id)` returns the status and the answers' previews.

## Acceptance criteria

- [ ] Claude, ChatGPT and Claude Code can each connect by URL and run the five tools.
- [ ] `search` results match a filter over `/marketplace.jsonl`, and both come from one source.
- [ ] `bid` never blocks; it returns before any seller sees the bid.
- [ ] Listed in the official MCP Registry and one third-party directory.

## Notes

**Prioritization (2026-11-12):** Priority P1. Stays in-review. Before it can
be ready: Restate `bid` against MON-054's card-first fill model (how an MCP
caller supplies or defers payment), say how `buy` routes for hosted stores,
and mark the two directory listings as owner tasks rather than implementer
criteria.
