---
id: XC-026
title: Point the faucet card at Onchain Tools → Faucet in four short lines
priority: P2
effort: XS
component: cross-cutting
status: completed
related: [XC-025, APP-056, MON-007]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

The "Fund the test buyer" card ran three numbered steps together on one line
with a 42-character address in the middle, and told the owner the faucet
"defaults to Base Sepolia + USDC". After signing in, the Coinbase developer
portal lands on its own home page, not the faucet, so the owner has to find
Onchain Tools → Faucet in the sidebar on their own (dogfood 2026-09-05).

## Proposed approach

Give the payments skill the exact note shape: one step per line, name the
sidebar path, put the address alone on its own line so it can be copied,
one line saying it is play money. Let the `open_url` tool description allow
four short lines instead of three numbered ones.

## Acceptance criteria

- [x] The skill's faucet step names Onchain Tools → Faucet and prescribes a four-line note with the address on its own line.
- [x] The `open_url` tool asks for up to four short lines, each its own line.

## Notes

Done 2026-09-05 in the same PR as APP-087. The card renders the note as
markdown, so line breaks become separate lines only when the agent emits
them; the skill now shows the shape rather than describing it. A future shape
is XC-027, where Lore drives the page itself.
