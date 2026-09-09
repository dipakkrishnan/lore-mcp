---
id: MON-017
title: Refuse paid answers until the model provider is ready
priority: P1
effort: S
component: monetization
status: completed
related: [MCP-003, APP-035, EVAL-002, MON-022]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-28
updated: 2026-09-09
---

## Problem

An owner can push enabled answer settings while the Worker lacks the API key for
the selected model. The node then advertises and accepts payment for `answer`,
returns a ticket, and only discovers the missing provider credential inside the
scheduled job. The buyer pays for a failure that was knowable before payment.

## Proposed approach

Resolve the configured answer model and required environment binding during MCP
initialization, before registering a paid `answer` tool or advertising its price.
If the provider is unavailable or the model is unsupported, keep `answer`
unpaid and disabled with a bounded resolution message; keep free `result`
available for existing tickets. Never return or log a secret value.

## Acceptance criteria

- [x] Enabled D1 settings without the selected provider's API-key binding do not
      advertise `answer_price_usd` or register `answer` as a paid tool.
- [x] An unsupported configured model fails closed before any x402 challenge or
      settlement.
- [x] A ready provider preserves the existing paid `answer` → ticket behavior.
- [x] Free `result` polling remains available for existing tickets even when a
      provider becomes unavailable.
- [x] Errors name only the missing binding or unsupported model; no credential
      value is logged or returned.
- [x] A focused Worker test proves an unready node cannot charge a buyer.

## Notes

This is a payment-correctness prerequisite for exposing answer controls in
Desktop (`APP-035`), not a request for provider setup UI, automatic secret
creation, fallback models, refunds, or key rotation machinery.

Implemented as part of `APP-035`: `lore/node/src/answer.ts` exports
`providerReadiness(env)`, extracted from `modelConfig`, and `index.ts`'s
`init()` gates registration on `settings.enabled && readiness.ready` (the
`selling` flag) rather than `settings.enabled` alone. An enabled-but-unready
node still registers `answer` unpaid, distinguishing "not available: <reason>"
from the plain "not enabled" case via a new `unready` telemetry outcome.
Covered by `lore/node/test/answer-unready.test.ts` (missing key, unsupported
model, and that `result` still resolves an existing ticket). `MON-022` reuses
`providerReadiness` for the owner's free trial route.
