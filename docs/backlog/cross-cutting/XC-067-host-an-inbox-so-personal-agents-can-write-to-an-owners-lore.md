---
id: XC-067
title: Let personal agents write to an owner's own node
priority: P0
effort: L
component: cross-cutting
status: in-review
related: [CAP-036, CAP-037, APP-207, XC-068, MON-046, XC-044, CAP-009]
blockers: []
dependencies: [the owner has a deployed node (APP-207 deploys one first when missing)]
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/467
created: 2026-10-16
updated: 2026-10-16
---

## Problem

It is hard to get people to put their context into Lore by hand, even with a
good interface. Their context already sits in their personal agents (Grok,
Muse, ChatGPT, Claude). Those agents run in the cloud and attach only remote
MCP servers over public HTTPS, so they can't reach the owner's Mac. Every
seller node today is read-and-buy only.

## Proposed approach

Writes go to the owner, not to Lore. Each owner's node already sits in
their own Cloudflare account at a public HTTPS address. It gains a second
MCP endpoint, `<node_url>/agent`, for the owner's own agents. The write
tools `store`, `stored` and `forget` live there and are scoped by an agent
key. The buyer endpoint `/mcp` is untouched. Saves wait in the node's own
D1, sealed to a key only the owner's Mac holds, until the Mac collects them
with the same wrangler path it uses to read sales. Lore hosts nothing in
between. The full wire contract is `contracts/inbox.md`.

## Acceptance criteria

- [ ] An agent key minted on the Mac lets that agent's `store` call put sealed items in the node's `inbox`; the Mac opens them with its private key only.
- [ ] A revoked, rotated-out or wrong key gets 401; buyers calling `/mcp` see no write tools, and `/agent` never takes payment.
- [ ] The same `key` saved twice leaves one waiting item, holding the newer content; `forget` withdraws a waiting item or tells the Mac to remove the memory.
- [ ] Quotas and size limits reject with a tool error that names the limit; payloads waiting past 30 days are dropped.
- [ ] No plaintext item content is logged, and none is stored at rest (asserted against D1 after a store).
- [ ] A push keeps `agents` and `inbox` intact and always carries `inbox_public_key` and `inbox_salt`.

## Notes

- Oct 16: first designed as a central Lore-hosted inbox (`inbox.yourlore.dev`
  with owner accounts). Dipak redirected it to the owner's own node: "It
  needs to go to an owner no?" Nothing about the buyer surface rules this
  out. The write endpoint is separate and authenticated, and saves are
  sealed, so the shared D1 only ever holds ciphertext. The node-based design
  also needs no Lore owner identity at all: keys are minted on the Mac.
- Every owner runs their own node, which is the decentralized point
  (Dipak, Oct 16). An owner without a node is walked through putting their
  store online as the first step of connecting an agent (APP-207); they
  don't wait for hosted nodes.
- Grok Bot's connector form takes a URL and headers and doesn't do OAuth in
  the current beta, so a bearer agent key is enough for the first demo.
  OAuth for grok.com, Claude, ChatGPT and Muse is XC-068.
- Built (Oct 16) in `lore/node`:
  - `src/agent.ts` holds the `/agent` endpoint, the agent key check and the
    `store`, `stored` and `forget` tools. It serves stateless MCP through
    the SDK 1.30 `WebStandardStreamableHTTPServerTransport`, with a fresh
    server per request.
  - `src/inbox.ts` is the D1 side: tables created lazily, keys read from
    `node_settings`, quotas, replacement and forgetting.
  - `src/seal.ts` does the sealing.
  - The fetch router sends `/agent` there; the buyer `/mcp` and x402 are
    untouched.
  - The tests are `test/agent.test.ts`, `test/seal.test.ts` and
    `test/inbox.ts`; the last one plays the Mac's side through D1.
- MCP library: `agents` 0.23's stateless `createMcpHandler` takes only an SDK
  v2 server factory, so `/agent` uses the SDK's own web-standard transport.
- Atomicity: the window updates, the item writes and the agent's counters go
  in one D1 batch. The batch ends with a guard that fails a NOT NULL insert
  when any window or the waiting cap is over, which rolls the batch back.
  So concurrent writes can't pass the limits (tested with six calls at
  once), and a refused call spends nothing.
- Lengths count code points, as the Python side does.
- A forget that drops a waiting item leaves the row as `forgotten` with no
  payload, so `stored` can still report it. Like a received forget, that row
  has `state = 'forgotten'` and `sealed IS NULL`. The Mac's collect and
  waiting queries must also filter on `sealed IS NOT NULL`. The contract's
  versions don't, and would return these rows forever.
- A payload dropped after 30 days takes its row with it, so `stored`
  reports that key as `unknown`, or as its previous state.
