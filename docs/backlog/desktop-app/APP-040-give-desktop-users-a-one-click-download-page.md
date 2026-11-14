---
id: APP-040
title: Give desktop users a one-click download page
priority: P3
effort: XS
component: desktop-app
status: completed
related: [APP-005]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/175
created: 2026-09-01
updated: 2026-11-13
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
- [x] The download URL serves the current notarized zip (asset uploaded under
      the stable name after each release).

## Notes

The zip is far over Cloudflare's 25 MiB asset cap, so the binary stays on
GitHub Releases; the Worker hosts only the page.

**Review 2026-10-19:** not completed. Download link and releases fallback ship (a3b5308). Unmet: the link serving the current notarized zip; uploading that asset is a manual release step, check with `gh release`.

**Prioritization (2026-11-12):** Priority P3 (was P1), effort XS (was S).
Stays in-review. Before it can be ready: Close it: release v0.1.25 carries
Lore-macOS-arm64.zip and .dmg under stable names and the site links
releases/latest. File automating the upload separately if wanted.
Prioritization flag (not acted on): done.

**Close-out (2026-11-13):** Completed. Release v0.1.25 is Latest and matches `app/desktop/package.json`
0.1.25. It carries `Lore-macOS-arm64.zip` and `Lore-macOS-arm64.dmg` under
the stable names. `releases/latest/download/Lore-macOS-arm64.zip` was
downloaded and unpacked on 2026-11-13. `spctl -a -vv -t exec` printed
"accepted, source=Notarized Developer ID", and `stapler validate` passed.
The site's primary action now goes through `/download` (XC-125, #670) to
the dmg; the zip stays at its stable URL for updates (`src/updates.cjs`).
Leftover, not filed: uploading the assets under stable names is still a
manual release step (`site/README.md`). Automating it would be its own
small item if wanted.
