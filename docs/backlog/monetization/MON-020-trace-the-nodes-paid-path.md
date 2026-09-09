---
id: MON-020
title: Trace the node's paid path in the owner's own Cloudflare account
priority: P1
effort: S
component: monetization
status: completed
related: [XC-030, MON-013, MON-018, XC-008]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-08
---

## Problem

`lore/node/` has no observability at all: `wrangler.jsonc` has no
`observability` block, and the only logging anywhere in the Worker is a
single swallowed `console.error` in `sales.ts`. An owner cannot see whether
their deployed node is serving, whether buyers are hitting revoked or
unknown ids (the drift `MON-013` cares about), or whether a settled payment
actually got recorded in the sales ledger `MON-018` shipped.

## Proposed approach

Enable Cloudflare Workers' native `observability.traces` and `.logs` in
`wrangler.jsonc` (default env and `env.qa`), with no `destinations` on the
owner's own node — traces stay entirely in the owner's Cloudflare account.
Add a `lore/node/src/telemetry.ts` module that is the actual enforcement
point for the privacy rules in `docs/telemetry.md`: a closed `OUTCOMES`
vocabulary, a `SPAN_ATTRIBUTES` allowlist, `hashId()` for correlating
publication/ticket ids without disclosing them, and assertion functions that
throw rather than silently forward an attribute or outcome outside the
allowlist — the same defense-in-depth `OwnerJob`'s validator gives the local
job history (`lore/store.py`'s `JOB_SUMMARIES`).

Wrap each of the four MCP tool handlers (`discover`, `get`, `answer`,
`result`) in a `tracing.enterSpan("lore.<tool>", …)` span; wrap
`sales.ts`'s existing `recorded()` settlement interceptor in a nested
`lore.sale` span; and wrap `answer.ts`'s background job in `lore.answer.job`,
promoting the `AnswerTelemetry` it already computes and persists to D1
(`answer_jobs`) rather than collecting anything new. Built test-first: the
allowlist and its leak table (`test/telemetry.test.ts`) went red before
`telemetry.ts` existed, and each span's behavior went red in
`paid-path.test.ts`/`answer.test.ts`/`answer-disabled.test.ts` before the
call sites were wired.

## Acceptance criteria

- [x] `wrangler.jsonc` enables traces and logs for both the default env and
      `env.qa`, with no OTLP `destinations` on the owner's node; validated by
      `wrangler deploy --dry-run` for both environments.
- [x] `get` records `not_found` with a hashed id on a miss and `ok` with a
      hashed id on a hit — never the publication title or content.
- [x] Settled payments record `settled: true` with `ok` or `ledger_failed`
      on a `lore.sale` span —
      never the payer address or transaction hash the settlement receipt
      actually carries.
- [x] The answer job's span carries the same `AnswerTelemetry` numbers
      already persisted to `answer_jobs` (model, tokens, cost, tool calls,
      duration) and never the buyer's question.
- [x] `test/telemetry.test.ts`'s leak table proves a buyer question, a
      wallet address, a transaction hash, a publication title/teaser, and a
      node URL never reach a span attribute, and every produced attribute
      key and outcome value is in the closed allowlist.
- [x] Verified against a real `wrangler dev` instance (not just the test
      pool): a `discover` call produced a real `lore.discover` span via
      Workers Observability's local query API, with exactly
      `{"lore.tool":"discover","lore.outcome":"ok"}` and nothing else.
- [x] All existing Worker tests (`npm test`, `npm run lint`, `npm run check`)
      pass unchanged, proving the tracing wrap changed no request semantics.

## Notes

**2026-09-07 (implemented):** `invalid_id` and `unpaid` are in the closed
`OUTCOMES` vocabulary but are never emitted by these spans — confirmed
empirically against `wrangler dev`: a malformed id is rejected by the tool's
own zod schema before any handler runs, and an unpaid call never reaches the
handler at all (`agents/x402`'s middleware returns the 402 challenge itself).
Both states are visible only through Workers' automatic request tracing.
`docs/telemetry.md` documents this rather than claiming coverage the custom
spans don't have.


**2026-09-08 (review fixes):** Removed the unused outcome codes described
above; the vocabulary now names only emitted outcomes. `ledger_failed`
means a settled payment was not recorded, not that payment failed. Shared
`withSpan` isolates tracing and attribute-validation failures from the
operation without replaying it. Failure-injection tests cover paid content,
answer completion, and preservation of business errors. Tool/model names
and metric values are validated; rejected values are never logged. Automatic
Cloudflare spans and logs are outside the custom-attribute allowlist.

**2026-09-08 (cleanup):** The hand-written key arrays, Sets, unions, and
nested validator in `telemetry.ts` collapsed into one strict zod schema with
`SpanAttributes` inferred from it; the three builders parse through it. The
Cloudflare tracing wrapper moved to its own `tracing.ts`. Re-verified against
`wrangler dev`: `lore.discover` spans carry exactly the documented attributes
(read them with `json(attributes)`; the explorer can flush up to half a minute late).
