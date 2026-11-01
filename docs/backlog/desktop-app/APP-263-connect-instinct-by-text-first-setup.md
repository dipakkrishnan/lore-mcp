---
id: APP-263
title: Connect Instinct by text-first setup
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-207, APP-217, XC-067, XC-068]
blockers: []
dependencies: []
github_issue: 597
created: 2026-10-29
updated: 2026-10-29
---

## Problem

Instinct is a text-first personal assistant. Connecting it fell through to the generic Other sheet: connector
settings Instinct doesn't have, a private link with the key in it, and a Copy all that bundles the key into
whatever the owner pastes. That puts the key into a text conversation and asks for a broad export on setup.

## Proposed approach

Instinct is its own agent app, at every step where an agent is connected:

- **Onboarding.** "Which AI do you talk to most?" offers Instinct. Its card shows the text-first steps.
- **Connectors › Connect an agent.** Instinct shows three steps: text the setup message to Instinct, copy the key
  into the secure form Instinct gives you (never into a text), and approve one memory. The setup message holds only
  the plain address. The key is a separate, masked Copy key.
- **Progress.** The line reads "waiting for the first save", then "reached your store, bringing it to this Mac",
  then "N memories from Instinct on this Mac · See it".
- **Recurring.** Only after the first save, Manage offers a separate message for Instinct to keep saving, asking
  the owner before each save. A new key has its own steps: the key only, into the secure form, with no setup message.
- **Fallback.** The sheet says the path is new. "Connect it as Other instead" disconnects the Instinct agent and
  hands out the Other instructions.

## Acceptance criteria

- [x] Instinct is a named choice in onboarding and in Connect an agent, with its own mark. The other agents are unchanged.
- [x] The setup message holds the plain address only, with no key, header, private link or Copy all.
- [x] The key is copied separately for the secure form. The re-key flow says never to text it.
- [x] Setup asks for one approved memory. No export or evening save is bundled into it.
- [x] Progress tells inbox acceptance apart from Mac receipt.
- [x] Walk coverage: steps, message contents, key exclusion, save, receipt, the recurring offer, and re-keying (the old key gets a 401).
- [ ] Live dogfood run with Instinct: secure key handoff, one approved save, receipt on the Mac, private item inspected, disconnect revokes.

## Notes

From issue #597. The copy is a proposal to validate while dogfooding. It is not a claim of a native integration or a partnership.
