---
id: APP-023
title: Publish a private memory straight from the memory sheet
priority: P1
effort: S
component: desktop-app
status: completed
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
with that memory id in typed task context. Draft only from the selected
memory unless the owner asks to broaden the scope; normal approval cards and
pricing still follow.

## Acceptance criteria

- [x] The open memory sheet offers Publish; rows remain simple navigation.
- [x] It opens the publish task scoped to that memory through a typed task
      record that survives resume; drafts cite it in provenance.
- [x] No neighboring memories are included unless the owner asks.
- [x] Nothing changes in the approval or pricing contract.

## Notes

Implemented in the batch PR: Publish on the sheet head and each private row seeds the publish task with the memory id and title; the skill drafts from it through the unchanged validated path.
