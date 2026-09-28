---
id: APP-128
title: "Dogfood fixes: errors in the sheet, cancellable connect, own words only"
priority: P1
effort: M
component: desktop-app
status: completed
related: [CAP-009, APP-125, APP-127, APP-118, CAP-005, CAP-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-28
updated: 2026-09-28
---

## Problem

Two driven dogfood passes over the connectors (2026-09-27) found the owner
losing track of what happened:

- A failed connect wrote its reason to the notice area behind the open sheet,
  so the owner saw nothing and could not correct the address.
- The reasons were wrong or raw: a typo showed `http.client.InvalidURL…`, a bad
  export said "can't reach Export", and a live site with no feed said
  "can't reach example.com". Medium accepted a Substack address.
- A success notice landed above the visible area when the list was scrolled,
  and up to three notices stacked across views.
- Closing a sheet during a slow connect did not stop it; when it finished it
  closed whatever sheet was open by then.
- Feeds and chat exports carry other people's and the AI's words; nothing told
  the drafting agent those are not the owner's to sell.
- The FAQ promised controls that are not there (questions, a price of a cent,
  listing before a store exists), and smaller copy slips: "storys", "Setting
  up" with no store, "per call", internal source ids and "personal" on every
  imported memory, posts dated by import day, agent rows and a Today nudge for
  agents that are not on this Mac, sheets opening on ×, and `lore sources`
  alone crashing.

## Proposed approach

Say a connect's outcome in the sheet that started it, let the reader name the
real reason, and give connect the sign-in's abort path. Keep the drafting rule
in the publish skill rather than filtering imports.

## Acceptance criteria

- [x] A refused connect or sign-in is said inline in its sheet, which stays open
- [x] Not an address / no posts there / not a ChatGPT (or Claude) export / can't reach are told apart
- [x] Medium reads only feeds Medium writes
- [x] Closing a sheet stops its connect, and a connect never closes a sheet it did not open
- [x] A notice is scrolled into view; one success notice at a time; a saved price clears the refusal
- [x] Read again says "Nothing new." or how many new items
- [x] The publish skill drafts only from the owner's own words
- [x] FAQ, Settings and sidebar say only what is true today
- [x] Imported memories name their app and are dated when written
- [x] Agent rows and the Today nudge appear only for agents on this Mac
- [x] Sheets open on their first field or action; Enter submits an address
- [x] `lore sources` alone prints usage

## Notes

The ChatGPT `Reply:` prefix is kept: it is how the drafting agent tells the
AI's words from the owner's. Imports stay a full dump by the owner's decision;
no quote stripping or skipping.
