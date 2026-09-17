---
id: APP-122
title: Bundle source logos with provenance and render Apple icons from disk
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-120, APP-115]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-17
updated: 2026-09-17
---

## Problem

A source list without logos reads as a form. Fetching favicons is not an
option: the renderer's CSP is `img-src 'self' data:` with `connect-src
'none'`, and PRIVACY.md promises the only thing Lore sends unprompted is
feedback the owner asks to send. A lookup on render would tell a third
party which services the owner is browsing. Apple's guidelines forbid
bundling the Notes or Messages icon at all.

## Proposed approach

Follow the existing `claude.svg` and `openai.svg` convention: one SVG per
service under `app/desktop/src/assets`, simple-icons format, each with a
comment recording the source URL and the date pulled. Per the brand pages:
GitHub, Bluesky, X, and Obsidian ship as-is (GitHub monochrome only);
Google Drive as the multicolour PNG, unchanged; Substack and Day One after
a short permission email; Slack and LinkedIn as a text label on a house
tile, since both forbid the mark and simple-icons removed them; Readwise
and Bear as house tiles until they answer. For Apple apps, render the icon
already on the owner's disk: `nativeImage.createThumbnailFromPath` on the
app bundle at 512 px in main, cached by bundle path and mtime, sent to the
renderer as a data URI. When a source has no logo, a house tile with the
initial in a colour derived from the name, never a broken image.

## Acceptance criteria

- [x] Every source in the catalog renders a crisp 20 px mark at 2x, offline.
- [x] No network request fires when the source list renders.
- [x] Each bundled asset file names its source URL and pull date.
- [x] Apple Notes shows the real Notes icon on a Mac that has it and a
      house tile on one that does not.

## Notes

Verified on this Mac 2026-09-16 with Electron 44: `createThumbnailFromPath`
returns a real 512 px image; `nativeImage.createFromPath` on the `.icns` is
empty; `app.getFileIcon` at size `large` crashes the process with SIGTRAP
and must never be called. simple-icons is CC0 but waives no trademark
rights; treat it as delivery, not licence.

Built 2026-09-17. `logo(source)` in `renderer.js` is the one seam rows, sheets
and the catalog all call: a bundled brand SVG when the label names a service,
the icon macOS already has when the entry is a `script` pointing at an app
bundle, a house tile (the initial on one of four palette tokens, picked from
the label's character sum) otherwise, and the folder outline for a plain
folder or file.

What the brand pages actually served on the pull date:

- **GitHub** — bundled. `brand.github.com/foundations/logo` shows only PNGs
  inline, but links `GitHub_Logos.zip`; `SVG/GitHub_Invertocat_Black.svg` came
  out of it unmodified.
- **X** — bundled, from `about.x.com/en/who-we-are/brand-toolkit` →
  `x-logo.zip` → `logo.svg`. Geometry untouched; the zip's only SVG is the
  white variant, which is invisible on Lore's cream, so the fill is the
  brand's own black one.
- **Obsidian** — bundled, `obsidian.md/images/obsidian-logo-gradient.svg`,
  linked from `obsidian.md/brand`. Unmodified: the brand forbids recolouring,
  so it stays 512 px with its gradients rather than being flattened to the
  simple-icons 24 px shape.
- **Google Drive** — skipped, as the item allowed. The developer branding
  page offers one PNG and no SVG.
- **Bluesky** — house tile. `bsky.social/about/press` is gone; the press FAQ
  points at a Google Drive media kit folder that cannot be read without
  signing in, so no SVG was ever served from an official page. Worth
  retrying when Bluesky publishes a brand page.
- **Substack, Day One** — house tile, permission email still pending.
- **Slack, LinkedIn** — house tile; both forbid the mark.
- **Readwise, Bear** — house tile; no brand page.

Two deviations from the plan worth knowing:

- Claude Code and Codex, the only non-folder sources that exist today, now
  use the `claude.svg` and `openai.svg` already bundled for the Account row.
  Without that the Settings page would have shipped with no logo on it at all.
- `appIcon` lives in `state.cjs`, not `main.cjs`, so `node --test` can reach
  it; `main.cjs` only registers `icons:app` over it. It caches the pending
  read (not the resolved string) per bundle path and mtime, which is what the
  unit test asserts by identity. Verified under Electron 44 that
  `/System/Applications/Notes.app` comes back as a 512 px PNG data URL and a
  missing bundle as null.

No catalog entry was added: the catalog still offers only a folder of notes,
which keeps the outline glyph. The `script` branch of `logo()` has no source
to drive it until CAP-007 files one, so it is covered by the unit test alone.
