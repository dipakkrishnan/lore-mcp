---
id: APP-238
title: Today says Good evening after midnight, not Good morning
priority: P3
effort: S
component: desktop-app
status: in-review
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-10-22
updated: 2026-10-22
---

## Problem

Today's greeting counted every hour before noon as morning, so at 12:15 AM it said "Good morning."

## Approach

Hours before 5 AM count as evening.

## Acceptance

- Midnight to 4:59 AM: "Good evening." 5 AM to noon: "Good morning." The afternoon and evening hours are unchanged.
