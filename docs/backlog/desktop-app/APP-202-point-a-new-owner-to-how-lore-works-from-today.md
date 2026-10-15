---
id: APP-202
title: Point a new owner to how Lore works from Today
priority: P1
effort: XS
component: desktop-app
status: completed
related: [APP-118, APP-201]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-10-14
---

## Problem

APP-201 moved the FAQ from the sidebar into the account menu. The FAQ is the
explainer a new seller reads to learn what Lore is (APP-118), and inside a
menu labelled "Signed in" a new owner may never find it.

## Proposed approach

A quiet line on Today, "New to Lore? How it works", opens the FAQ. It shows
until the owner's first paid sale (free copies don't count) or until they
close it. Closing it is remembered on this Mac.

## Acceptance criteria

- [x] Today shows the line to an owner with no paid sale.
- [x] How it works opens the FAQ.
- [x] Once closed, it stays closed.
- [x] Covered in `support/edge.sh faq`.
