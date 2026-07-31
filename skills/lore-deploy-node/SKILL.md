---
name: lore-deploy-node
description: Deploy the owner's Lore node as a Cloudflare Worker and verify it is live. Handles the Cloudflare account, the payout address secret, the deploy, and the smoke check. A free node is a complete outcome. Use when the user says "deploy my lore node", "put my lore online", "set up my lore node", "host my lore", or when the lore-enable-payments skill routes here for deployment.
---

# Deploying a Lore node

This skill puts a Lore node on the internet: a Cloudflare Worker that serves
`discover` free to any agent, and `answer` — free or paid, depending on what the
owner configured with the `lore-enable-payments` skill. Deploying is not a
commitment to charge: a free node is a complete outcome, not a step toward one.

Be honest up front: the deployed node currently serves sample canary content, not
the owner's publications. Serving approved publications from the edge is on the
way; until then, deploying proves the node and its payment rail work — it does not
put their lore on sale.

## 0. What this takes

- A **Cloudflare account** — the free tier is enough. The owner signs up and logs
  in themselves; this skill never sees or handles that login.
- If the node will charge: a **payout address** from `lore-enable-payments`. If
  they have not run it and want payments, route there first; if they want a free
  node, no address is needed and nothing else is either.

Everything below runs on a test network. Nothing here moves real money.

## 1. Deploy

All commands run in `worker/` of the Lore checkout:

```sh
cd worker
npm install
npx wrangler login
npx wrangler secret put LORE_WALLET     # paste the payout address — the public one
npm run deploy
```

`wrangler login` opens their browser to authorize their own Cloudflare account.
`LORE_WALLET` is the payout address — a public value, safe to paste anywhere; skip
it only if the node is free and stays free. The deploy prints the node's URL:
`https://lore-x402-canary.<account>.workers.dev/mcp`.

## 2. Verify it is up

A successful deploy means Cloudflare accepted the code, not that the node works.
Prove it:

```sh
npm run smoke -- https://<their-subdomain>.workers.dev/mcp
```

The smoke check makes real MCP calls: both tools listed, `discover` answers free,
and `answer` either answers (free node) or challenges for payment without leaking
content (paid node). It spends nothing. Run it after every deploy; if it fails,
`npx wrangler tail` streams the live error while you re-run it.

## 3. Hand off

The node is live. Offer the natural next steps once, without pushing:

- **Charging for answers** — the `lore-enable-payments` skill, which sets the
  price and proves one test payment against this deployed URL.
- **Nothing** — a free node that answers from canary content is a fine place to
  stop, and so is tearing it down: `npx wrangler delete` removes it completely.
