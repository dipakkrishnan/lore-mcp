---
id: APP-231
title: A store running older code than the app offers a quiet, optional Update
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-226, MON-047, XC-069]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-19
updated: 2026-10-19
---

## Problem

The store's code ships inside the Lore app. The store only picks up new code when something on it changes: pieces, the price, or free copies. After an app update, every existing store silently keeps its old code until then. On Oct 19, the owner's test store kept describing payments in USDC after 0.1.17 shipped the card-only wording. The only way to update it was to change a setting.

## Proposed approach

- Every deploy that goes out records which store it put online. It writes `deployed.json` beside `payout.json`, holding a digest of the packaged store source.
- The snapshot gives `node.store` one of three values:
  - **current:** the recorded store matches the one this Lore ships.
  - **outdated:** the recorded store is older, or the store was put online from this Mac before the record existed (only a deploy from this Mac writes `payout.json`).
  - **unknown:** there's no record here, so another Mac may have set the store up. Never offered an update.
- The newer store is never a Today next step and never counts as a waiting change. Where the store shows, the app says quietly "A newer store from Lore is ready." with an optional **Update**:
  - Settings › Your store › Address;
  - the store card, but only when nothing else is waiting to go out there.
- Update runs the same confirmed update. The changes card lists **Store · The latest from Lore** and waits for the owner's Confirm (APP-226). The store goes out again as it was last opened:
  - for sale, on its recorded network and payout address;
  - by card alone, on its recorded network;
  - online only for the owner's agents, with an agents-only deploy.
- Every other push (after an approval, a take-down, or Update store for waiting pieces) leaves the store's code as it is.
- The agent gets no new way to change the store.

## Acceptance criteria

- [x] A deploy that goes out records its store; a refused deploy records nothing.
- [x] Current, outdated and unknown stores read as such. Unknown is never offered an update.
- [x] Nothing about it appears on Today.
- [x] Settings and the store card offer a quiet Update. It asks first, and Cancel puts nothing out.
- [x] Confirm redeploys as the store was last opened, whether for sale or for agents only.
