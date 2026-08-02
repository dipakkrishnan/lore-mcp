# Your Lore node

This directory is the source of your deployable Lore node: a Cloudflare Worker
with a free MCP `discover` tool and a paid `get` tool (x402, USDC on Base),
serving your **approved publications** from D1. `discover` returns the full
catalog — owner-approved teasers grouped by topic, with ids and freshness (the
free advertisement); `get` returns one publication's content by id, paid.
Private Lore never reaches the edge — `lore push` writes only
`publications WHERE active=1`. It ships inside the Lore package and is staged
here by `lore node deploy`.

Set up the database once per account, then push whenever the active set changes:

```sh
npx wrangler d1 create lore-publications   # paste the id into wrangler.jsonc
lore push                                  # sync the active set to the edge
lore push --local                          # seed the local dev database instead
```

Revoking a publication locally does not touch the edge until the next
`lore push` — the CLI reminds you. A push is a full replace (DROP+CREATE),
so a push that fails partway can leave the node briefly serving an empty
catalog or erroring; the recovery is always the same: rerun `lore push`,
which is idempotent. The pasted `database_id` survives
redeploys.

## Deploy or redeploy

Always use the CLI — it stages fresh source, deploys, sets the payout secret,
records the node URL where `lore status` can show it, and smoke-checks the
live endpoint. Deploying by hand with wrangler skips all of that.

```sh
lore node deploy --wallet <your public 0x payout address>
```

`lore status` shows the node URL as `Node (last deploy):` afterwards. Files you create here
(`.buyer.env`, `.dev.vars`) survive redeploys; everything else is overwritten.

## Make the test payment

Create a dedicated Base Sepolia buyer wallet (never your payout wallet), fund
it with faucet test USDC, then in this directory:

```sh
cp .buyer.env.example .buyer.env
# Edit .buyer.env yourself and set the buyer key there.
npm run pay -- <your node URL from lore status>
```

The script caps payment at $0.01 test USDC and prints the MCP result plus the
x402 settlement receipt. Never use a funded mainnet key here.

## Developing the node itself (repo checkout only)

Contributors working in the lore-mcp repository can run the node locally from
`lore/node/`:

```sh
cp .dev.vars.example .dev.vars   # set LORE_WALLET to any valid address
npm install
npm run types && npm run check
npm run dev                      # MCP at http://localhost:8787/mcp
npm run smoke                    # free discover + unpaid x402 challenge
```
