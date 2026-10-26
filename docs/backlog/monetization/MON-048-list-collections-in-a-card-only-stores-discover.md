---
id: MON-048
title: List collections in a card-only store's discover
priority: P1
effort: S
component: monetization
status: ready
related: [MON-044, MON-047]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

A store that sells by card alone (no payout address) shows its collections on the storefront, and a browser buyer can buy one. But `sellByCardOnly()` (`lore/node/src/index.ts`) builds `discover` from single pieces only, so buyer agents and the marketplace's daily refresh never see the collections.

Found by the Codex review of v0.1.19 (Oct 25) and deferred past launch.

## Proposed approach

Pass the store's collections into the card-only manifest and list each with its price, pieces and page URL, without registering a paid `collection_<id>` tool.

## Acceptance criteria

- [ ] A card-only store's `discover` lists its collections with their checkout pages
- [ ] No paid MCP tool is registered for them
