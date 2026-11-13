---
id: APP-036
title: Guide Cloudflare and wallet setup inside Desktop
priority: P3
effort: L
component: desktop-app
status: obsolete
related: [APP-004, APP-005, APP-006, APP-030, MON-006, XC-005]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-25
updated: 2026-11-13
---

## Problem

`lore-enable-payments` knows the right Cloudflare and Coinbase steps, but the
Desktop agent cannot carry them through. A first-time owner can still be left
copying terminal commands, moving URLs between apps, or telling Lore whether a
step worked. These are exactly the unfamiliar account, wallet, network, and
payment steps where the app should hold their hand and verify the result.

## Proposed approach

Keep `lore-enable-payments` as the orchestrator. Reuse Desktop's existing
clickable HTTPS links and approval cards, then add only the fixed, typed runtime
actions the skill cannot complete today: open an allowlisted external setup
destination, start and observe Cloudflare authentication or deployment, and
read the resulting Lore/payment status. Do not add a general browser tool,
arbitrary shell bridge, embedded webview, or credential capture.

Extend the owner-skill conversation harness with fake runtime results for the
Cloudflare and Coinbase branches. The harness should prove the skill advances
one verified step at a time and can resume after the owner returns from an
external consent or wallet action; it should not require live accounts, funds,
or secrets.

## Acceptance criteria

- [ ] An owner starting without a wallet or Cloudflare account is guided one
      action at a time through choosing a self-custody Base payout address,
      signing in to Cloudflare, deploying, funding a distinct Base Sepolia
      buyer wallet, and proving one test payment.
- [ ] The owner never has to copy a terminal command. Desktop opens each
      necessary external handoff or runs it through a fixed typed runtime
      action, then verifies completion instead of asking the owner to report
      success.
- [ ] The skill consistently distinguishes the public payout address from the
      funded buyer wallet and never asks for a seed phrase, recovery phrase,
      private key, wallet export, or Cloudflare credential.
- [ ] External actions are limited to named HTTPS destinations and named Lore,
      Wrangler, and payment operations; neither the renderer nor the agent gets
      a general URL opener or arbitrary privileged command channel.
- [ ] The conversation harness covers a fresh Cloudflare/Coinbase setup, an
      already-configured resume, and one declined or failed external step using
      deterministic fake runtime responses.
- [ ] Cancellation leaves the current verified checkpoint intact, and reopening
      the deploy task resumes there without repeating completed setup.

## Notes

Split from APP-030 before dogfood. APP-030 remains the publication-only handoff;
this ticket owns the deeper first-time deployment guidance. Implement the first
real dogfood break, not every possible Cloudflare or wallet workflow.

**Prioritization pass 2026-08-26:** No blockers, scope explicitly excludes a general browser/shell bridge. Promoted `in-review` → `ready`.

**Prioritization pass 2026-11-11:** Effort M → L: six criteria spanning new typed runtime actions, a Cloudflare and Coinbase conversation harness with resume and failure branches, and checkpointed cancellation is more than two days of work.

**Prioritization (2026-11-12):** Priority P3 (was P1). Moved back from ready
to in-review. Before it can be ready: Criterion 1 walks the owner through
funding a Base Sepolia buyer wallet, which MON-025's real-money store
contradicts, and most of the hand-holding shipped elsewhere (APP-056,
APP-057, in-app Cloudflare sign-in, bundled Node, card payout). Mark
obsolete, or narrow to a named remaining break from a real-money first
deploy; APP-180 and XC-059 own the form-based open-store flow.
Prioritization flag (not acted on): obsolete (likely).

**Close-out (2026-11-13):** Obsolete. The premise is gone. Criterion 1 walks the owner through funding
a Base Sepolia buyer wallet, which MON-025's real-money store replaced, and
the hand-holding it asked for shipped elsewhere. APP-056 (completed) hands
every browser step to the owner through one attended card. APP-057
(completed) takes a store to real money without a terminal. Fixed typed
runtime actions now exist in `app/desktop/src/agent.mjs`: `cloudflare_login`,
`open_store` (deploy on the owner's confirm), `open_url` and
`propose_price`, with no general shell or URL bridge, under the APP-008
sandbox. The remaining form-based open-store flow belongs to APP-180 and
XC-059.
