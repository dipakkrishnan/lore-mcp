# Lore x402 node

One free MCP `discover` tool and one $0.01 `answer` tool using Cloudflare's
`paidTool`, serving the owner's **approved publications** from D1. `discover`
returns titles and topics only (the free advertisement); `answer` returns the
content, paid. Private Lore never reaches the edge — `lore push` writes only
`publications WHERE active=1`.

Setup once per account, then push whenever the active set changes:

```sh
npx wrangler d1 create lore-publications   # paste the id into wrangler.jsonc
lore push                                  # from the repo root (or --worker-dir)
lore push --local                          # seed the local dev database instead
```

Revoking a publication locally does not touch the edge until the next
`lore push` — the CLI reminds you.

Cloudflare's x402 support (`withX402`, which provides `paidTool`) only works on
the legacy `McpAgent` path today. This canary follows that working example
rather than inventing a payment wrapper. Migrate to the stateless
`createMcpHandler` path when Cloudflare supports x402 there.

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
unpaid x402 challenge. The smoke check is manual (not CI), spends nothing,
and also works against a deployed Worker: `npm run smoke -- <url>`. Run it
after any Worker change and after each deploy, before `npm run pay`.

## The two invariants

Both of these fail *silently* in production — nothing errors, and the damage is
only visible to whoever is on the other end. They are checked wherever the
relevant call already happens rather than left to review.

**The challenge discloses no publication content** (`npm run smoke`). A gate that
leaks the answer inside its demand for payment is worse than no gate: the buyer
keeps the content and the money. Rather than asserting today's rows are absent,
the check asserts the stronger property — the challenge does not vary with the
query. If asking about two unrelated things produced two different challenges,
the difference is something the gate learned from the publications before being
paid. Nonces and timestamps are discovered by calling twice with the same query,
so a moving field is never mistaken for a leak.

**Payment never widens the disclosable set** (`npm run pay`). Free and paid differ
in *depth* by design — `discover` returns titles and topics, `answer` returns the
content — but they must not differ in *breadth*. After a payment settles, the
titles in the answer are compared against the titles `discover` advertised for the
same query. Paying buys the content of rows the node already named; if it ever
surfaced a row `discover` would not have, payment would have become a disclosure
decision, which is the one thing it must never be.

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
