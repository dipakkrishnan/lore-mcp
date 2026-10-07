---
id: APP-188
title: Order Settings by what a seller changes most
priority: P2
effort: S
component: desktop-app
status: ready
related: [APP-136, APP-119, APP-184]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Settings lists the address and wallet before the things a seller actually
changes. It shows a wallet row to sellers who have no wallet, and leaves
marketplace listing off until the seller finds the setting.

## Proposed approach

- Put Price and By card first.
- Hide the wallet row unless the seller has one, and offer "Also let AI agents
  pay" as a quiet link instead.
- List new stores on the marketplace by default, with an easy opt-out.

## Acceptance criteria

- [ ] Price and By card are the first two rows under Your store
- [ ] A seller with no wallet sees no wallet row
- [ ] A newly opened store is listed on the marketplace unless the seller opts out

## Notes

Filed from the 2026-10-06 new-seller audit.
