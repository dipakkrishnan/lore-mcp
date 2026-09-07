---
id: APP-103
title: Tell the agent what happened to the drafts it staged
priority: P1
effort: XS
component: desktop-app
status: in-review
related: [APP-047, APP-097, APP-083]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

Drafts are approved or skipped on cards the agent never sees. After the owner
approved a draft and pushed (store 19 → 20), pressing Publish again made the
agent insist "the current draft is waiting for your decision" and offer
"Review current draft", with no card anywhere (final pass 2026-09-07). Its
context still ended at "one draft is ready for approval below".

## Proposed approach

Every publish turn carries an aside the owner never sees, alongside the
memory aside from APP-083: how many staged drafts still wait on cards, or that
none do because each was approved or skipped. The app counts them from the
CLI's candidates list at prompt time. The skill's desktop callout says to
trust only that line. Thread history strips every aside at one marker.

## Acceptance criteria

- [x] A publish turn after all drafts were decided tells the agent none are
      waiting, and the thread history shows only what the owner typed.
- [x] The skill tells the desktop agent to claim a waiting draft only from
      that line.
