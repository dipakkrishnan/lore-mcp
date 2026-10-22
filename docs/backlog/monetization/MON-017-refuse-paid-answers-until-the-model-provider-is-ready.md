---
id: MON-017
title: Refuse paid answers until the model provider is ready
priority: P1
effort: S
component: monetization
status: completed
related: [MCP-003, APP-035, EVAL-002]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-28
updated: 2026-10-20
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

**Prioritization 2026-10-19:** promoted to `ready`. No open blockers, no commit on main implements it, and the acceptance criteria are concrete and checkable. Priority and effort unchanged.

**Completed 2026-10-20.** `answerReadiness(env)` in `lore/node/src/answer.ts` resolves the configured
model and its binding through the same `resolveModel` the answer job uses, so the check and the job cannot
disagree. `LorePaidMCP.sell()` (`src/index.ts`) advertises `answer_price_usd` and registers the paid `answer`
tool only when answers are enabled and that check passes; otherwise `answer` is registered unpaid and
returns `answer_unavailable` naming the missing secret or the model. `result` reads D1 only, so it never
depended on the provider. The refusal reuses the existing `disabled` telemetry outcome, so the strict
privacy schema in `src/telemetry.ts` and `docs/telemetry.md` is unchanged.

Covered by `test/answer-unready.test.ts` (missing key, unsupported model, free `result` polling, and the
readiness function directly). With `src/index.ts` reverted, its two integration tests fail on the still-advertised
`answer_price_usd`. The ready-provider paid path is the unchanged `test/answer.test.ts`.

Not covered: a real deployed node. The check runs when each MCP session starts, so a key added with
`wrangler secret put` should be picked up by a new session, but that was not tried on a deployed Worker.

This unblocks `APP-035` (answer controls in Desktop).
