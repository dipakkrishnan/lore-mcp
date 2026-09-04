---
id: MON-019
title: Let a desktop deploy finish its own push
priority: P0
effort: S
component: monetization
status: in-review
related: [APP-056, APP-055, APP-006, MON-013]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

`lore node deploy` ends by pushing the active publications, and that push
runs the owner-action gate (`cli.py: _owner_action`), which accepts a TTY
or the desktop marker. The desktop agent's shell sets `LORE_UNATTENDED` but
not the marker (`agent.mjs:441-446`), so every store deploy from the app
uploads the Worker, sets the wallet, then fails at its last step:

    lore: pushing publications needs an attended terminal or the Lore desktop app; piped and background use is disabled

Today shows "Store deploy · Failed" while the footer says "Store live", and
the agent tells the owner to press Push, a button that only exists once an
approved publication is waiting (dogfood 2026-09-04, sandbox deploy job 1).

## Proposed approach

Run the deploy sequence's push under the deploy's own job instead of through
the owner-action gate: deploy is already the owner's action and the push only
carries publications the owner approved. Call `_push` from `_deploy` with
the deploy's job id and keep `lore push` itself gated as it is. Do not put
the desktop marker in the agent's shell; that marker is the approval boundary
the agent must not be able to set.

## Acceptance criteria

- [ ] A store deploy from the desktop agent's shell completes, and the deploy
      job records succeeded.
- [ ] `lore push` from a pipe without the marker still refuses.
- [ ] The payments skill no longer tells the owner to press Push after a
      deploy.

## Notes

Regression from the owner-action gate (APP-006) meeting the deploy sequence's
built-in push; the edge tests cover the Push button and not the agent's
deploy path.
