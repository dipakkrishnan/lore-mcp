---
id: XC-126
title: Keep the desktop job off GitHub release downloads
priority: P2
effort: S
component: cross-cutting
status: ready
related: [XC-082, XC-109, XC-121]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-09
updated: 2026-11-09
---

## Problem

On 2026-11-09, from about 05:05 to 08:20 UTC, github.com returned fast 504s for
release-asset downloads while the status page showed everything operational.
For those three hours `Desktop macOS checks` failed on most runs. The cause was
downloads, never the code. The job fetches from GitHub releases on every run in
three places:

- **Electron binary.** Electron 44 downloads its binary lazily, on the first
  `require("electron")`, not at `npm ci`. In the unit tier that is the test "an
  update downloads quietly…" in `app/desktop/test/unit/app.test.cjs`, through
  `updates.cjs` → `update-electron-app` → `electron`. So a 504 failed the unit
  step before any walk ran.
- **uv.** `app/desktop/packaging/wheelhouse.sh` curls the uv tarball from
  `github.com/astral-sh/uv/releases`. Its `out/uv` is not in the XC-082 cache,
  which covers only `packaging/out/whisper` and `packaging/out/node`.
- **Python.** The `uv run --managed-python` in the same script fetches
  CPython 3.12.14 from python-build-standalone, which is also a GitHub release.

Several test-pyramid PRs (#647, #649, #678) were merged with only
`npm run package` red on a 504. XC-109 decided against making the job
required, partly because it fails on things like this.

## Proposed approach

- Cache Electron's download cache (`~/Library/Caches/electron`), keyed on the
  pinned `electron` version in `app/desktop/package.json`. Restore it before the
  unit step.
- Add `packaging/out/uv` to the XC-082 cache, with `wheelhouse.sh` in the key
  so a `UV_VERSION` bump misses. Alternatively, fall back to the uv wheel on
  PyPI when the release download fails.
- Cache uv's managed-Python directory, keyed on `PYTHON_VERSION` in
  `wheelhouse.sh`.
- Keep XC-082's rules: no `restore-keys`, and save only on a green job.

## Acceptance criteria

- [ ] On a warm cache, the desktop job makes no request to `github.com`
      release downloads. Check this by grepping the job log for
      `releases/download` and for Electron's download line.
- [ ] Bumping `electron`, `UV_VERSION` or `PYTHON_VERSION` misses the cache and
      still passes.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Found during the test-pyramid rollout, 2026-11-09. A subagent's check
  confirmed the CDN itself was fine; the 504s came from github.com's redirect.
