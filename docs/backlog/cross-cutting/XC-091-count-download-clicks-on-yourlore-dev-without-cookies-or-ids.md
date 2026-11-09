---
id: XC-091
title: Count download clicks on yourlore.dev without cookies or ids
priority: P1
effort: S
component: cross-cutting
status: ideation
related: [XC-093, XC-095, XC-092, APP-126]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

The Download buttons link straight to the GitHub asset, so clicks aren't counted. GitHub's
download_count also includes every auto-update (update.electronjs.org serves the same asset). So
"how many people downloaded Lore after visiting" has no answer.

## Proposed approach

Add a `/download/:platform` route to the site Worker (`run_worker_first`) that 302s to the
GitHub asset. It writes 1 Workers Analytics Engine data point with platform, referer host, and
country only, and no IP or id. Point index.html's two links and worker.js's DOWNLOAD at it. Read
it with AE SQL, and compare daily against CF Web Analytics visits and PostHog `app.installed`.
No per-person stitching.

## Acceptance criteria

- [ ] Clicking Download still starts the zip download in one hop.
- [ ] An AE SQL query returns clicks per day by platform and referer host.
- [ ] No cookie, query token, or IP is stored.
- [ ] The site test covers the redirect.

## Notes

Merged with the website audit's draft. Visits are already measured: Cloudflare Web Analytics (cookieless) is on for yourlore.dev (35 visits Oct 26, 49 Oct 27). GitHub release `download_count` includes in-app auto-updates, so it overstates installs; the first `app.opened` per install in PostHog is the install signal.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
