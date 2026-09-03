---
id: APP-056
title: Hand every browser step to the owner through one attended card
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-055, MON-005, MON-018]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-02
updated: 2026-09-02
---

## Problem

The only external step the app owned was Cloudflare sign-in. The wallet,
the workers.dev subdomain, the faucet, Basescan and the developer portal
were URLs the agent could only paste into prose, and a signed-out deploy
spawned an interactive Cloudflare login that hung inside the sandbox until
it timed out (edge audit finding 6).

## Proposed approach

One owner-gated tool, `open_url`, taking a step title, a URL and a one-line
note. The main process opens only `https` pages on the hosts the payments
skill uses. The renderer shows one card in two stages: the step and the
note with Not now or Open, then, once the page has opened through the
window-open handler, "Finish in your browser, then come back here" with
I got stuck or Done. Only the heading and the buttons change, so the card
keeps its size. The tool blocks like the Cloudflare sign-in does, holding
the task at needs-you under the step title, and returns finished, stuck or
declined; the skill verifies from state after Done.

The desktop agent's shell carries `LORE_UNATTENDED`, and a signed-out
deploy under it stops with "sign in first" so the agent calls the sign-in
tool instead of hanging.

## Acceptance criteria

- [x] The agent can open only the wallet, Cloudflare, faucet, Basescan and
      Coinbase developer pages, over https.
- [x] The card shows the step and the host, opens the page through the
      window-open handler, and swaps to Done / I got stuck at the same size.
- [x] Not now, Done and I got stuck each close the card, echo the owner,
      and return a distinct answer to the agent.
- [x] A signed-out `lore node deploy` under `LORE_UNATTENDED` stops before
      spawning a login; a terminal deploy is unchanged.
- [x] The payments skill's desktop paragraph routes every browser step
      through the tool.

## Notes

Shipped in PR #195. A Stop control while a card waits is still audit item
10 and out of scope here.
