---
id: APP-208
title: Show date-only memory dates on the day they name
priority: P2
effort: XS
component: desktop-app
status: in-review
related: [APP-207]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-16
updated: 2026-10-17
---

## Problem

A memory dated with just a day (for example `2026-10-16`) shows one day early
in US time zones: a save made today reads "Oct 15". The renderer's date
formatter parses a date-only string as UTC midnight, then shows it in local
time. Found while building APP-207.

## Proposed approach

Format date-only values as calendar dates, with no time zone shift: parse
`YYYY-MM-DD` as a local date, or format it with `timeZone: "UTC"`. Values
that carry a time keep converting to local time as they do now.

## Acceptance criteria

- [ ] A memory dated `2026-10-16` shows "Oct 16" on a Mac set to any US time zone.
- [ ] Timestamps with a time of day still show in local time.

## Notes
