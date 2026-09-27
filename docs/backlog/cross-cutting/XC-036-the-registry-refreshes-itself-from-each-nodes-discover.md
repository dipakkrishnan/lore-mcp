---
id: XC-036
title: The registry refreshes itself from each node's discover
priority: P1
effort: M
component: cross-cutting
status: in-review
related: [XC-033, XC-034, XC-022, XC-031, APP-119]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-27
updated: 2026-09-27
---

## Problem

`APP-119` lists a store by asking the feedback relay to open a pull request
on dipakkrishnan/lore-marketplace with a maintainer PAT. The relay was never
deployed, and the shape has problems of its own: the PAT expires, status
reads spend the relay's quota, anyone can list anyone's node and then hold
its HMAC delist secret, every listing rewrites the whole file so pull
requests conflict, derived fields go stale the day after merge, dead nodes
stay forever, and `validate.py --live` checks every store's root on every
pull request, so one dead store blocks all of them.

## Proposed approach

The node is the source of truth. Its `discover` says `"listed": true` and
the owner's chosen `name` only when the owner switched it on (a
`listed_name` row pushed into `node_settings`), so owning the node is the
proof of ownership. A `refresh` workflow on the registry repo runs daily, on
demand, and on a `listing`-labelled issue from a "List my store" issue form:
it calls `discover` on every node and rewrites each entry from it, drops a
node that says `"listed": false`, marks one that stops answering or
qualifying `down_since` and drops it after seven days, and for a request
checks the node (answers, Base mainnet, at least one publication, opted in),
commits with the built-in `GITHUB_TOKEN`, and replies on the issue.
`validate.py --live` calls `discover` on changed entries only.

On this side the relay's `/listing` route and both its secrets go away.
`lore marketplace list` pushes the listed name and returns the prefilled
issue-form URL, `delist` pushes it empty, and `status` reads the raw file.

## Acceptance criteria

- [x] `discover` carries `listed` (and `name` when listed) from `node_settings`.
- [x] `lore marketplace list|delist|status` hold no credential and call no relay.
- [x] Settings shows Not listed / Pending / Listed and opens the form in the browser.
- [x] The relay's listing route, tests, and secrets are deleted.
- [ ] The registry PR's workflow lists the first real node end to end.

## Notes

Trade-off: sending the issue form needs a GitHub account. Intake through the
feedback relay for sellers without one is a possible later step, not built.
