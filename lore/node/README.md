# Your Lore node

This directory is the source of your deployable Lore node: a Cloudflare Worker
with a free MCP `discover` tool and a paid `get` tool (x402, USDC on Base),
serving your **approved publications** from D1. `discover` returns the full
catalog — owner-approved teasers grouped by topic, with ids and freshness (the
free advertisement); `get` returns one publication's content by id, paid.
Buyers may choose zero, one, multiple, or all advertised ids and call `get`
once per selection. A checksum rejects damaged ids before payment.
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
live endpoint. It uses the positive per-publication price set by `lore price`;
rerun deploy after changing that price. Deploying by hand with wrangler skips
all of that.

```sh
lore node deploy --wallet <your public 0x payout address>
```

`lore status` shows the node URL as `Node (last deploy):` afterwards. Files you create here
(`.buyer.env`, `.dev.vars`) survive redeploys; everything else is overwritten.

## Enable the paid answer tier (optional)

The node can also sell answers from the owner's AI proxy (`answer` paid, `result` free — see
`docs/answer-tier.md`). The tier is off until you opt in;
its agent reads **approved publications only**, framed by a public proxy charter you
approve — never your private memories or blueprint. The node pays for the
model calls with your own API key, so set the per-answer price above the
per-answer cost the stored telemetry reports.

```sh
npx wrangler secret put ANTHROPIC_API_KEY
lore answer on <proxy-file> 0.50
lore push                                   # ship proxy charter, price, and the switch
```

The default model is `claude-sonnet-5`. Set `LORE_ANSWER_MODEL` to
`gpt-5.6-luna` and add `OPENAI_API_KEY` to use OpenAI instead. Turn the tier off
with `lore answer off` and a push. Completed turns are checkpointed in the
existing D1 database so a fresh Worker invocation can resume the same ticket.
Pi's packaged SQLite session adapter uses Node's `node:sqlite` and cannot run in
a Worker isolate.

## Make the test payment

In this directory:

```sh
npm run pay -- <your node URL from lore status>
```

On first run the script provisions its own dedicated Base Sepolia buyer key
in `.buyer.env` (mode 400 — never open or edit it; it is not your payout
wallet). If the buyer holds less than the deployed price it prints the
address to fund plus faucet links; send it test USDC and re-run. The script
caps payment at the deployed price and prints the MCP result plus the x402
settlement receipt.

## Mainnet cutover (real money — read all of this first)

The node runs Base Sepolia (`eip155:84532`) against the free `x402.org`
facilitator unless every step below is taken; nothing defaults or falls back
to mainnet (MON-005). Cut over only after a full Sepolia payment has settled
end to end.

**Getting the CDP credentials** (a first live cutover hit every one of these):

- Keys are minted at `portal.cdp.coinbase.com` → **API keys** in the left
  nav's settings cluster. Beware the decoy: the "API key wallets" product
  page creates server-controlled *wallets*, which you do not want — the right
  page is a plain table of keys with a **Create API key** button, and it
  talks about authenticating requests, not creating wallets.
- In the create dialog: **Secret API key**; *opt out* of IP allowlisting (the
  caller is a Cloudflare Worker with no stable egress IPs — pinning IPs
  breaks settlement randomly); leave the Trade/Transfer/Receive account
  scopes unchecked — the facilitator authenticates settlement calls and
  never touches funds in any Coinbase account.
- The secret is shown once. It goes straight from that tab into the
  `wrangler secret put` prompt below — never into an agent conversation, a
  file, or a clipboard manager. A lost secret is not an incident: mint a
  replacement key.
- **Secrets are scoped to the worker's name.** If you intend to rename the
  worker, rename and redeploy first — secrets vaulted against the old name
  do not carry over.

Then, from `~/.lore/node`, in a real terminal:

```sh
npx wrangler secret put CDP_API_KEY_ID      # paste at the prompt
npx wrangler secret put CDP_API_KEY_SECRET
npx wrangler secret put LORE_NETWORK        # enter exactly: eip155:8453
npx wrangler deploy
```

On mainnet the Worker uses Coinbase's authenticated CDP facilitator; if either
credential is missing it refuses to start rather than serving unsettleable
answers. The server names itself `Lore x402 (MAINNET)` and `discover` reports
`network: eip155:8453`, so a deployed node's mode is visible at a glance. To
return to the testnet, delete the `LORE_NETWORK` secret and redeploy.

## The maintainers' standing QA environment (MON-008)

Separate from any owner's node: `env.qa` in `wrangler.jsonc` deploys its own
worker (`lore-qa`), its own D1 database (`lore-publications-qa`), and its own
payout wallet, so a QA deploy and a real owner's node never collide. It
redeploys automatically on every merge to `main` via
`.github/workflows/deploy-qa.yml`, which then reseeds it from
`scripts/qa-fixtures.sql` — two synthetic fixture publications, never a real
owner's library — and smoke-checks the result before finishing.

The current URL is recorded at [`.qa/node-url.txt`](.qa/node-url.txt) (the
workflow keeps this current; do not hand-edit it). Everything QA holds is
disposable and can be wiped and reseeded at any time — treat it as scratch
infrastructure for `XC-008`'s live testnet suite and manual verification,
never as a source of real data. The QA payout wallet and the QA buyer wallet
used against it are both dedicated to this environment, funded from the Base
Sepolia CDP faucet, and are never reused anywhere else or on mainnet.

The workflow provisions the QA D1 database itself on its first run and
commits the resolved id back — no tracked file ever needs a manual edit. The
one thing an admin does have to set up by hand, once, since a workflow
cannot create its own credentials: a protected GitHub **Environment** named
`qa` (Settings → Environments), holding `CLOUDFLARE_API_TOKEN` (scoped to
Workers + D1 only) and `QA_PAYOUT_ADDRESS` (a dedicated Base Sepolia payout
address) as Environment secrets — never repository secrets, which every
workflow in the repo can read.

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
