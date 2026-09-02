---
id: APP-040
title: Give desktop users a one-click download page
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-005]
blockers: []
dependencies: []
github_issue: 175
created: 2026-09-01
updated: 2026-09-01
---

## Problem

There is no public way to get the desktop app. A launch post needs a download
CTA, and new users should not have to find a GitHub release page to install
Lore (issue #175).

## Proposed approach

A minimal static page at yourlore.dev — one prominent Download button and a
GitHub-releases fallback link — served as Cloudflare Worker assets from
`site/`, with the apex and www custom domains bound. The button points at the
stable `releases/latest/download/Lore-macOS-arm64.zip` URL; the release
process uploads the notarized zip under that exact name (electron-forge emits
a versioned `Lore-darwin-arm64-<version>.zip`, renamed at upload — see
`site/README.md`).

## Acceptance criteria

- [x] yourlore.dev serves a page whose primary action downloads the macOS app.
- [x] The page works without JavaScript and offers a GitHub-releases fallback.
- [ ] The download URL serves the current notarized zip (asset uploaded under
      the stable name after each release).

## Notes

The zip is far over Cloudflare's 25 MiB asset cap, so the binary stays on
GitHub Releases; the Worker hosts only the page.
