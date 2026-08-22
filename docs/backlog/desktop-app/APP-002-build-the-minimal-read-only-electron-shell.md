---
id: APP-002
title: Build the minimal read-only Electron shell
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-001]
blockers: [APP-001]
dependencies: []
github_issue: null
created: 2026-08-21
updated: 2026-08-21
---

## Problem

Owners currently have no persistent place to review their memories or verify
what is for sale and actually deployed. Agent chat is useful for doing work,
but it is a poor inventory and store-status view, especially for people who do
not use developer tools.

## Proposed approach

Create a small Electron app with three views: Today, Lore, and Store. The main
process invokes the snapshot from `APP-001` through a narrow IPC boundary; the
renderer receives data but no filesystem or shell access. Use native HTML and
CSS unless the implementation proves a framework is necessary.

## Acceptance criteria

- [ ] The app starts locally with one documented command and renders Today,
      Lore, and Store from the snapshot contract.
- [ ] Lore distinguishes private, published, and needs-review inventory; Store
      distinguishes live, approved-but-not-live, drafts, and revoked items.
- [ ] Store shows the current price, node link, and deployment state without an
      analytics dashboard or speculative charts.
- [ ] Electron context isolation is enabled and the renderer cannot invoke
      arbitrary commands or read arbitrary files.
- [ ] Empty, not-configured, offline, and error states are readable and
      keyboard accessible.

## Notes

This PR is intentionally read-only. It establishes the simple post-setup
vendor console before adding an agent or owner actions.
