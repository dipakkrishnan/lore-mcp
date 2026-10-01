---
id: APP-133
title: Ship only the Mac esbuild binary
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-129]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-01
updated: 2026-10-01
---

## Problem

The pi-coding-agent bump in APP-129 brought esbuild with all 26 platform binary
packages installed, about 280 MB. The download grew from 313 MB to 439 MB, and
every file adds to Apple's notary scan. A local `.mypy_cache` also shipped.

## Proposed approach

Ignore every `@esbuild/<platform>` except `darwin-arm64` (esbuild loads only the
current platform's package), and every dot-folder at the app root.

## Acceptance criteria

- [x] The packaged app differs from 0.1.4 only by the foreign esbuild binaries and `.mypy_cache`
- [x] esbuild transforms and bundles from inside the packaged app
- [x] The packaged app loads the agent stack and starts on a fresh library
