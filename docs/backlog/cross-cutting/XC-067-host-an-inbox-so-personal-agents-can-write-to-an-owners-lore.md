---
id: XC-067
title: Let personal agents write to an owner's own node
priority: P0
effort: L
component: cross-cutting
status: in-progress
related: [CAP-036, CAP-037, APP-207, XC-068, MON-046, XC-044, CAP-009]
blockers: []
dependencies: [the owner has a deployed node; owners without one wait for hosted nodes (DOC-003, issue #369)]
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
- Owners without a node get one through hosted nodes (DOC-003). That is the
  same Worker code on Lore's account, so this design carries over.
- Grok Bot's connector form takes a URL and headers and doesn't do OAuth in
  the current beta, so a bearer agent key is enough for the first demo.
  OAuth for grok.com, Claude, ChatGPT and Muse is XC-068.
