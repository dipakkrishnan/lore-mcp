---
id: MON-035
title: Give piece pages a free sample, who it's for, and a way for a person to buy
priority: P1
effort: M
component: monetization
status: in-review
related: [MON-029]
blockers: []
dependencies: []
github_issue: 365
created: 2026-10-04
updated: 2026-10-04
---

## Problem

A piece page (`/p/<id>`) shows only the teaser, the price and MCP
instructions. When a seller shares a link, the reader has nothing to judge
the piece by and no way to act on it, so sharing goes nowhere.

## Proposed approach

Three optional, owner-approved free fields on a publication: `sample` (a
short excerpt), `useful_if` and `not_useful_if` (one line each). The publish
skill drafts them; the CLI and desktop approval cards show and edit them. They
travel in `discover` only when written and render on the piece page, escaped.
The page gets a buy box for people: a prompt to copy into their agent, plus
Share and Copy link. Card checkout (XC-039) fills the same box later.

## Acceptance criteria

- [x] A piece with a sample shows it on `/p/<id>`; one without renders as before.
- [x] The paid text never reaches the page or `discover`; a sample containing
      the whole paid text is refused.
- [x] Share and Copy link work; `og:description` uses the sample.
- [x] Existing local databases gain the columns; the edge table converges on
      the next push.
