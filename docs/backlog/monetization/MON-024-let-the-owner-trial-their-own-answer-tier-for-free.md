---
id: MON-024
title: Let the owner trial their own answer tier for free
priority: P2
effort: M
component: monetization
status: in-review
related: [MCP-003, MON-017, APP-035]
blockers: [MON-017]
dependencies: []
github_issue: null
created: 2026-09-09
updated: 2026-09-09
---

## Problem

The owner has no way to judge their proxy charter's voice before it goes live.
The paid `answer` tool only exists once `answer_enabled` is pushed and
advertises a price, so a test-funds purchase (the only other free-of-real-money
option) can only run *after* the tier is already exposed to real buyers. There
is also no way to run the real Pi agent loop against the real deployed node
without either a git checkout and `./lore-test.sh`, or spending crypto — neither
of which a packaged Desktop app can do.

## Proposed approach

A second, unpaid door into the same answer agent, gated by a bearer credential
Lore mints and vaults itself rather than by payment:

- `LORE_OWNER_TOKEN`, a Worker secret minted fresh on every `lore node deploy`
  (rotation, not reuse) and stored locally so the CLI can keep using it.
- `POST /owner/answer` on the plain Worker `fetch` handler (outside the MCP
  `LorePaidMCP` Durable Object and outside x402 entirely): checks the bearer
  token, runs `createTicket`/`runAnswer` directly at `price_usd = 0` with a new
  `origin: 'buyer' | 'owner'` column on `answer_jobs`, and never writes a
  `sales` row. No token configured → 404, not 401, so a node the owner has
  never deployed to since this shipped advertises nothing extra.
- `lore answer try "<question>" [--json]` on the CLI: posts the question,
  polls the existing free `result` tool, and renders the answer, its
  citations, or an honest refusal/failure.

## Acceptance criteria

- [x] `LORE_OWNER_TOKEN` is generated and vaulted on every deploy, and the
      previous token stops working once a new deploy rotates it.
- [x] `/owner/answer` is invisible (404) on a node with no token configured,
      refuses a wrong or absent token, and accepts the real one.
- [x] A trial call never creates a `sales` row and never charges the buyer's
      x402 path — it is reachable with no wallet involved at all.
- [x] A trial call refuses cleanly when `providerReadiness` (`MON-017`) says
      the node's model is not ready, before spending anything.
- [x] Worker and Python tests cover the auth boundary, the no-sale guarantee,
      and the provider-unready refusal, with a stubbed facilitator and no
      network involved.
- [ ] `lore answer try` verified end to end against a real deployed node:
      ticket, poll, and a rendered answer/refusal/failure. Outstanding — needs
      a live Cloudflare deploy, tracked by the manual pass this note describes.

## Notes

Split out of `APP-035` during its design: a test-funds purchase was
considered and rejected because the paid tool does not exist until the tier
is already enabled, so it cannot inform the enable decision the trial exists
to support. Settlement itself is not re-proven here — `get`'s x402 path
already covers that machinery, and `answer` shares it; a real $0.01 purchase
via `lore/node`'s `npm run pay`, after enabling, is the manual check for that
one gap.

The last acceptance criterion needs a real Cloudflare account and cannot run
in this environment; it belongs in the manual pass alongside `APP-035`'s own
live verification (see that item and `docs/manual-test-walkthrough.md`). Move
this to `completed` once that pass confirms it, or back to `in-progress` with
what broke if it doesn't.
