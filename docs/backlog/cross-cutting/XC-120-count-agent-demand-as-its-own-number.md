---
id: XC-120
title: Count agent demand as its own number
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [XC-116, XC-117, XC-091, XC-092]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-31
updated: 2026-10-31
---

## Problem

Agent demand is the number to optimize, and nothing measures it today. Cloudflare and PostHog
see visits from people. Agents read JSON, `llms.txt` and MCP, and none of those are counted.

## Proposed approach

The site Worker records one cookieless event per request to `/llms.txt`, `/marketplace.jsonl`,
any JSON twin, `/bids` POSTs and each `/mcp` tool call, through the relay's existing
`/events` → PostHog path with IPs discarded. Each event carries a coarse agent family taken
from the User-Agent or MCP client info (ClaudeBot, GPTBot, PerplexityBot, Claude, ChatGPT,
Grok, curl, browser, other). A PostHog insight shows agent reads, agent bids and agent buys
per week, kept separate from people.

## Acceptance criteria

- [ ] A known-UA test request to each endpoint shows up in PostHog with the right agent family and no IP.
- [ ] A weekly "agent demand" insight exists: reads, bids placed by agents, and buys by agents.
