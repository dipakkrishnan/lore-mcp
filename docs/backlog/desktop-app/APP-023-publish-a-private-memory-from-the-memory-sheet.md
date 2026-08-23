---
id: APP-023
title: Publish a private memory straight from the memory sheet
priority: P1
effort: S
component: desktop-app
status: ready
related: [APP-011, APP-019, XC-002, APP-020]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

The Memories tab reads well now, but a private memory is a dead end: to
sell one the owner must go to Today, start a publish pass, and hope the
draft covers the memory they had open. Dipak (2026-08-23): "there should
be an easy way to transition a private memory to published."

## Proposed approach

A single "Publish" action on the open memory sheet starts the publish task
with the memory id in its typed task context. The skill drafts from that memory
only, and the normal approval cards and pricing follow. Same validated path —
`lore publication draft` + owner approval — just entered from where the owner
already is.

## Acceptance criteria

- [ ] The open sheet for a private memory offers Publish.
- [ ] The publish task stores the selected memory id in its task record and
      stays scoped to it when resumed.
- [ ] Drafts cite the selected memory in provenance; neighboring memories are
      included only when the owner asks.
- [ ] Nothing changes in the approval or pricing contract.
