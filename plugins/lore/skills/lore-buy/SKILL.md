---
name: lore-buy
description: Find Lore sellers whose first-hand experience fits the task, read their free catalogs, and buy only the publications worth their price, within a budget the user sets. Works from any agent runtime. Use when the task needs experience or judgment you lack, or when the user says "buy from Lore", "find a Lore seller", "check Lore for this", or "is there lore on X".
---

# Lore buy

Buy first-hand knowledge from other people's Lore nodes. Browsing is free;
each `get` costs real USDC.

> **Agent-system controls:** In Claude Code, use `AskUserQuestion` for user
> decisions. In Codex, ask directly in chat unless the current mode explicitly
> provides a structured question control. Never block because a named question
> tool is unavailable.

## How to drive — read this first

- **One step at a time.** Registry, discover, judge, buy, one exchange each.
- **Announce, then open.** Say which registry or node you are about to query and why.
- **Verify from state, never by asking.** Read the registry and catalogs yourself.
- **Defer at decision points.** The budget and the first purchase are the user's call.

## 1. Decide whether to buy

Buy only when the task needs first-hand experience or judgment you do not have,
and the price is small next to the time it saves. Never buy speculatively or to
browse.

## 2. Read the registry

Given a piece link (`https://<host>/p/<id>`), skip the registry: the node is
`https://<host>/mcp` and the id is `<id>`. Discover there to confirm the price,
then go to step 5.

Fetch it directly; no wallet or MCP server is needed:

```sh
curl -s https://raw.githubusercontent.com/dipakkrishnan/lore-marketplace/main/marketplace.json
```

Each entry in `sellers` has `name`, `node`, `network`, `topics`, `price_usd`
and `answer_price_usd`. Shortlist sellers whose `topics` match the task and
whose `network` your wallet pays on (`eip155:8453` is Base mainnet,
`eip155:84532` Base Sepolia).

## 3. Discover

Call `discover` on shortlisted nodes only. It is free and returns teasers by
topic with `id`, `updated_at`, `network`, `price_usd` and `answer_price_usd`.
Without an MCP client, discover works over plain HTTP:

```sh
NODE=https://<host>/mcp
H='Content-Type: application/json'; A='Accept: application/json, text/event-stream'
SID=$(curl -si -H "$H" -H "$A" "$NODE" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"buyer","version":"0"}}}' | awk 'tolower($1)=="mcp-session-id:"{print $2}' | tr -d '\r')
curl -s -H "$H" -H "$A" -H "Mcp-Session-Id: $SID" "$NODE" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
curl -s -H "$H" -H "$A" -H "Mcp-Session-Id: $SID" "$NODE" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"discover","arguments":{}}}'
```

## 4. Judge

Pick ids whose teaser answers the task and whose `updated_at` is recent enough
for it. When an entry carries `useful_if`, `not_useful_if` or a free `sample`,
read them first: they are the seller's own word on who the piece is for. Drop
the rest. Prefer `get` (a fixed publication) over `answer` (a
paid question to the seller's proxy): questions sent to `answer` are kept and
seen by the seller, so never send one containing private or user-identifying
detail, and ask the user first.

When most of what you want sits in one of the node's `collections`, buy the
collection instead: its `tool` (`collection_<id>`) returns every piece in one
payment, usually for less than buying them one by one. When the task is
ongoing (tracking a writer's beat for weeks), and the node lists a `feed`,
`subscribe` buys a 30-day pass to every piece. Then pass it to `get` as
`pass`, and call `discover` with `since` to see only what is new. A pass reads only for the wallet that bought it: the bridge signs each pass
read for you; a runtime with its own wallet signs
`Lore pass <pass> for <id> at <signed_at>` and sends `signed_at` and
`signature` with `get`.

## 5. Agree a budget

Ask the user for a per-task budget in USD and confirm before the first
purchase, showing the ids, teasers and total. Never exceed the budget. Only
skip the confirmation if the user said to.

## 6. Set up payment

**MCP runtimes (Claude Code, Codex, others).** Run the bridge for the chosen
node. It holds the paying key, refuses charges off `--network` or beyond
`--max-usd`, and appends the receipt to paid results. Set `--max-usd` to the
budget. It needs a clone of https://github.com/dipakkrishnan/lore-mcp and
`npm --prefix <clone>/bridge install`.

```sh
# Claude Code
claude mcp add lore-buyer -- npm --prefix <clone>/bridge run start -- --node <node> --network <network> --max-usd <budget>

# Codex
codex mcp add lore-buyer -- npm --prefix <clone>/bridge run start -- --node <node> --network <network> --max-usd <budget>
```

Any other stdio MCP client:

```json
{"mcpServers": {"lore-buyer": {"command": "npm", "args": ["--prefix", "<clone>/bridge", "run", "start", "--", "--node", "<node>", "--network", "<network>", "--max-usd", "<budget>"]}}}
```

The runtime usually needs a restart to load it. On first run the bridge logs a
new address to stderr and stores its key in `~/.x402-bridge/key.env`; the user
funds that address with USDC on the node's network, only what they will
spend. Never read, print or ask for the key.

**Runtimes with their own x402 wallet.** Call the node's `/mcp` URL directly
and let the runtime pay.

**Shell-only runtimes.** Discover works with the `curl` above, but paying
needs an x402 client. Tell the user you can browse but not buy, and that
running this from an MCP runtime with the bridge, or a runtime with an x402
wallet, will buy.

## 7. Buy

Re-run `discover` if the catalog is older than this task, then call `get` once
per chosen id, or the chosen collection's tool once. With a pass, add `pass` to
each `get`; it charges nothing until the pass expires. Stop when the budget is
spent.

## 8. Cite and report

When you use a publication, cite the seller name, node URL, publication `id`,
`title` and `updated_at`. After buying, report each receipt's `transaction`
hash with its link: `https://basescan.org/tx/<hash>` on `eip155:8453`,
`https://sepolia.basescan.org/tx/<hash>` on `eip155:84532`.
