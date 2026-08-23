---
id: APP-030
title: Chain the next rung after setup — publish and open-your-store from the Done card
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-020, APP-023, APP-019, MON-006, DEP-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

Onboarding is designed as a chain — scrape memory, shape, synthesize,
then help the owner publish and deploy if they want — but the desktop
drops the chain at the seam: setup's final message says "publishing,
payments, and capture are optional next steps" as prose with nothing to
click (Dipak, 2026-08-23, first completed onboarding). Worse, the
`lore-enable-payments` skill is unreachable from the app entirely: the
task kinds are capture/setup/publish only, so a new owner can finish
setup and have no path to a store or Base without the CLI.

## Proposed approach

Make the Done card carry the next rung as actions: "Publish something"
(existing publish task) and "Open your store" — a new `deploy` task kind
running `lore-enable-payments`, with the payments/deploy owner gates
(address, price, deploy, push) as typed cards like capture/profile were.
The design doc's rule stands: the hand-off chain continues, never
stopping at "Finish setup." Respect MON-006 (deploy mechanics moving into
the CLI) so the skill drives validated commands, not mechanics.

## Acceptance criteria

- [ ] Setup's Done card offers Publish something and Open your store as
      buttons; both start their task with one click.
- [ ] `lore-enable-payments` runs as a desktop task end to end on a fresh
      LORE_HOME: payout address, price, deploy, and test payment reachable
      without a terminal.
- [ ] The chain is offered once, not pushed: dismissing it leaves the
      normal Today inbox.
