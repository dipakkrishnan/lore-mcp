---
id: DEP-003
title: Add the Cloudflare provider — R2 bundle and Worker MCP endpoint
priority: P2
effort: L
component: deployment
status: in-review
related: [DEP-001, DEP-002, MON-001, XC-004]
blockers: [DEP-001]
dependencies: ["Cloudflare account (owner-controlled)"]
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

Cloudflare is the second of two hosting providers being tried in parallel with AWS
(`DEP-002`), to see which one sticks. Without it there is no comparison — and the
comparison is the point of building two.

There is a naming hazard worth stating up front, because the repo's history makes
it easy to misread this item: **this is not the Monetization Gateway.** `MON-001`
covered that path and was closed obsolete on 2026-07-29 ("Lore is not going to use
Cloudflare") because payment moved in-process to the MCP layer. Cloudflare here is
purely a place to *run* the node, competing with Lambda. Nothing in this item
revives the gateway, the tunnel, or edge-enforced x402.

## Proposed approach

Implement the `DEP-001` lifecycle against Cloudflare: detect or install `wrangler`,
authenticate via `wrangler login`, upload the bundle to a private R2 bucket, and
deploy a Worker serving the same `POST /mcp` and `GET /health` contract as the AWS
path. Record account id, bucket, object key, Worker name, and route on success.

The honest complication, per `docs/deployment-mvp.md`: the Worker runtime cannot
run Lore's Python MCP handler. With the bundle specified as a SQLite file
(`DEP-001`), the plausible move is importing it into D1 — SQLite underneath — and
the open question is whether FTS5 survives the import; if not, this provider
reimplements search natively over what is a deliberately small publication set.

Larger, and deliberately unresolved: the *paid* path. The Python x402/CDP gate does
not run in a Worker at all, so a paid Cloudflare deployment means a JavaScript
implementation of the payment gate — a second payment implementation nobody has
scoped. That is flagged as `XC-004`; this item does not resolve it, and the paid
portion of this path must not start until it does. The free path does not wait.

That is acceptable — but it must be visible. The failure mode to prevent is this
path quietly returning substring matches while AWS returns BM25-ranked ones, and
the owner comparing two providers that are not doing the same thing. Any
behavioral difference is reported to the owner at `verify` time.

Authentication uses `wrangler login`'s OAuth flow, never a global API key.

## Acceptance criteria

- [ ] The skill detects or installs `wrangler` and authenticates via
      `wrangler login`; it never asks for a global API key
- [ ] The bundle lands in a private R2 bucket with no public access
- [ ] The Worker serves `POST /mcp` and `GET /health` and satisfies the same MCP
      contract as `DEP-002` — `initialize`, `tools/list`, `discover`, `answer`
- [ ] Where the runtime cannot run the Python handler unmodified, the contract is
      reimplemented rather than degraded silently, and every behavioral difference
      from `DEP-002` is reported to the owner at `verify` time
- [ ] Verification asserts a query matching a private memory returns nothing, and
      fails the deployment otherwise
- [ ] If `XC-004` resolves in favor of a paid Worker path: the payment secret is
      installed as a Worker secret binding — never in the bundle or a plaintext
      var. Until then, the paid portion of this item is out of scope
- [ ] Account id, bucket, object key, Worker name, and route are recorded locally
- [ ] The skill emits working `codex mcp add` and `claude mcp add` snippets
- [ ] On failure after provisioning begins, the skill reports what exists and
      offers teardown
- [ ] A written comparison against `DEP-002` covers search behavior, cold start,
      and idle cost

## Notes

Transposed from the "Cloudflare" branch of Shane's 2026-07-30 sketch; design in
`docs/deployment-mvp.md`. Blocked by `DEP-001`.

Confirmed with Shane (2026-07-30): Cloudflare's role in the sketch is hosting only,
not payments. `related` includes `MON-001` deliberately — anyone who reads
"Cloudflare" in this backlog should find the obsolete gateway decision and see that
this item does not contradict it.

The last acceptance criterion is the actual deliverable of running two providers.
Without a written comparison, this is just a second deployment path with no
decision attached, and the parallel effort is wasted.
