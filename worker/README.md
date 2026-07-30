# Lore x402 canary

This is a disposable Base Sepolia proof: one free MCP `discover` tool and one
$0.01 `answer` tool using Cloudflare's `paidTool`. It serves only hardcoded test
content and has no connection to private Lore data.

Cloudflare's working x402 example still uses the legacy `McpAgent` path. This
canary follows that example rather than inventing a payment wrapper. Migrate to
the stateless `createMcpHandler` path when Cloudflare supports x402 there.

## Run locally

```sh
cp .dev.vars.example .dev.vars
# Set LORE_WALLET to a public Base Sepolia receiving address.
npm install
npm run types
npm run check
npm run dev
```

The MCP endpoint is `http://localhost:8787/mcp`.
In another terminal, run `npm run smoke` to verify free discovery and the
unpaid x402 challenge.

## Deploy

A Cloudflare account is required only for deployment:

```sh
npx wrangler login
npx wrangler secret put LORE_WALLET
npm run deploy
```

The deployed endpoint is printed as
`https://lore-x402-canary.<account>.workers.dev/mcp`.

## Make the test payment

Create a dedicated Base Sepolia buyer wallet, fund it with faucet test USDC,
then:

```sh
cp .buyer.env.example .buyer.env
# Set BUYER_TEST_PRIVATE_KEY to the dedicated test key.
npm run pay -- https://lore-x402-canary.<account>.workers.dev/mcp
```

The script caps payment at $0.01 and prints the MCP result plus x402 settlement
receipt. Never use a funded mainnet private key for this canary.
