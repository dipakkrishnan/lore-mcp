---
id: XC-120
title: Count agent demand as its own number
priority: P2
effort: XS
component: cross-cutting
status: in-review
related: [XC-116, XC-117, XC-091, XC-092]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-31
updated: 2026-11-12
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

## Notes

Built Oct 31; both criteria wait on a deploy and on the insight being made in PostHog.

- **Sender:** `site/src/demand.js`. `countDemand(event, request, env, ctx)` is the one helper;
  the bids route (MON-051) calls it with `agent.bid` and the MCP server (XC-117) with
  `agent.mcp`, both already in the contract. It runs in `ctx.waitUntil`, so a response never
  waits and a failed send is dropped.
- **Relay:** not the public `/events` route. The site's `RELAY` service binding targets a new
  `SiteEvents` entrypoint on the relay (`count(name, agent)`), which only a binding can reach.
  So no one else can add to the count, and since only two codes cross, no visitor IP or header
  reaches the relay. The public route still takes app events only.
- **Contract:** `contracts/usage_events.json` gains `site_events`: names plus one `agent` prop
  and its families. `SiteEvents` checks both; `lore/usage.py` doesn't send them.
- **Privacy:** no cookie, one fixed id for the whole site, no IP, path, query, referrer or raw
  User-Agent. The relay already sends `$ip: null`.
- **Verified locally:** site and relay under one `wrangler dev`, the relay's PostHog host
  pointed at a local capture server. Requests with ClaudeBot, GPTBot, curl, python-requests,
  Perplexity-User and Safari User-Agents arrived as `agent.llms`, `agent.catalog`,
  `agent.sitemap` and `agent.json` with the right `agent` and `$ip: null`.
- **To finish:** deploy the relay first (it adds `SiteEvents`), then the site (its `RELAY`
  binding names that entrypoint); curl each endpoint with a known User-Agent and find it in
  PostHog; then build the insight below.

**Insight: "Agent demand, weekly"** (Trends, weekly interval, last 12 weeks, no breakdown):

1. *Agent reads*: total count of `agent.llms`, `agent.catalog`, `agent.json`, `agent.sitemap`
   and `agent.mcp`, filtered to `agent` is not `browser`. One series per event, then the
   formula A+B+C+D+E; or save an action "Agent read" matching those five events.
2. *Agent bids*: `agent.bid`, `agent` is not `browser`.
3. *Agent buys*: `sale.seen` where `via` = `agent`. This is the app's first-agent-sale
   milestone per install, so it undercounts repeat buys until a per-sale event exists.
4. *People (for contrast)*: the read events with `agent` = `browser`.

A second copy broken down by `agent` shows which agents are reading. The same numbers in SQL:

```sql
SELECT toStartOfWeek(timestamp) AS week,
  countIf(event IN ('agent.llms','agent.catalog','agent.json','agent.sitemap','agent.mcp') AND properties.agent != 'browser') AS agent_reads,
  countIf(event = 'agent.bid' AND properties.agent != 'browser') AS agent_bids,
  countIf(event = 'sale.seen' AND properties.via = 'agent') AS agent_buys,
  countIf(event IN ('agent.llms','agent.catalog','agent.json','agent.sitemap','agent.mcp') AND properties.agent = 'browser') AS browser_reads
FROM events
WHERE timestamp > now() - INTERVAL 12 WEEK
GROUP BY week ORDER BY week
```

**Backlog audit (2026-11-12), moved to in-review:** The sender, the relay
entrypoint and the contract shipped in #624 and were checked locally against
a stand-in capture server, and the relay and site appear deployed. Both
criteria need someone with PostHog access to confirm that known-User-Agent
requests to the live site arrive with the right agent family and no IP, and
to build the "Agent demand, weekly" insight. Moved out of in-progress: what
remains is owner work in PostHog, not code.

**Prioritization (2026-11-12):** Priority P2 (was P1), effort XS (was S).
Stays in-review. Before it can be ready: Someone with PostHog access
confirms known-User-Agent requests arrive with the right family and no IP,
then builds the "Agent demand, weekly" insight. The agent.mcp half waits on
XC-117. Prioritization flag (not acted on): done (code).
