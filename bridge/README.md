# x402-mcp-bridge

A local stdio MCP server that fronts one remote x402-paid MCP server, so any
MCP client — Claude Code, Claude Desktop, Codex, Cursor, or any harness that
can spawn a stdio server — can call paid tools. The signer lives in this
process; the model only ever sees "payment required" → "paid" as tool
results. Nothing here is lore-specific: point it at any x402 v2 MCP server.

```sh
claude mcp add lore-buyer -- npm --prefix /path/to/bridge run start -- --node https://<host>/mcp
```

## How it works

- `tools/list` and `tools/call` pass through to the remote server. Paid tools
  arrive with their price annotated in the description, so the model can
  weigh cost before calling.
- On a 402 challenge, `withX402Client` (Cloudflare Agents SDK) signs a USDC
  transfer authorization and retries. The settlement receipt is appended to
  the tool result, so it lands in the buyer's conversation.
- Every step is logged to stderr as JSON lines (`startup`, `call`,
  `challenge`, `settled`) — tail it for a live payment feed.

## Signer custody

`X402_PRIVATE_KEY` in the environment wins. Otherwise the bridge
self-provisions a throwaway key at `~/.x402-bridge/key.env` (mode 400) on
first run and prints its address — fund it with only what you are willing to
spend through the bridge. Never give the bridge a key that holds real savings.

<!-- ponytail: env key + throwaway file only; CdpX402Client managed custody
     when a mainnet buyer wants no key on disk at all -->

## Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--node <url>` | required | Remote MCP endpoint to front |
| `--network` | `eip155:84532` (Base Sepolia) | CAIP-2 network; `eip155:8453` for Base mainnet |
| `--max-usd` | `1` | Per-call spend cap, enforced before signing |

## Checks

`npm run check` type-checks. `npm run smoke -- <url>` spawns the bridge
against a live node and drives the free path through it (tools proxied, price
annotation present, `discover` returns a catalog); it never spends.
