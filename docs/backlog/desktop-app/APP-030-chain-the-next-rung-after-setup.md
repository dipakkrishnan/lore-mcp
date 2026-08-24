---
id: APP-030
title: Chain the next rung after setup — publish and open-your-store from the Done card
priority: P1
effort: M
component: desktop-app
status: in-progress
related: [APP-020, APP-023, APP-019, MON-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-25
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

Setup ends on a Done card that says so ("Your Lore is set up. This thread
is closed. What comes next is a separate step") and offers the next rung as
task-spawning buttons — *Open your store* and *Publish something* — so the
hand-off no longer lives as prose in a conversation that `finish_task` has
already ended. *Open your store* is a new `deploy` task kind running
`lore-enable-payments` with its own title, thread, records, and Start over.
Post-#143 the skill already runs through open tools, so Electron adds no
deployment mechanics. Rails live in the skill: test network by default,
mainnet an explicit choice, and `wrangler login` and Push remain the owner's.
The desktop path stays publication-only; the optional paid-answer tier keeps
its existing terminal-attended gate and is tracked separately in APP-035.

## Acceptance criteria

- [x] Setup's Done card offers Open your store and Publish something; each
      starts its own task with a fresh thread and title.
- [x] `deploy` is a task kind (session dir, records, title, Start over)
      running `lore-enable-payments`; Today's Needs-you offers it once the
      profile exists and no node does.
- [x] The skill defaults to the test network, keeps `wrangler login` and
      Push with the owner, stays publication-only, and never touches the
      onboarding checkpoint.
- [ ] Live proof: a fresh `LORE_HOME` reaches a Sepolia node and completes a
      paid publication `get`; terminal handoffs are limited to authentication
      and explained before the owner leaves the app.

## Notes

MON-006 already moved deterministic deployment into the CLI. Keep this desktop
work thin: one new task kind drives the existing skill and CLI through typed
owner gates. If implementation starts recreating deployment mechanics in
Electron, split it rather than expanding this item.

Implemented 2026-08-24 (PR pending). Simplified 2026-08-25 by removing the
optional desktop paid-answer bridge: its environment-marker attendance check
was forgeable from agent Bash, while publication payments already prove the
core store loop. APP-035 retains that feature behind a future unforgeable owner
boundary. Left in-progress until the scratch-home deployment/payment proof.
