---
id: XC-126
title: Keep the desktop job off GitHub release downloads
priority: P1
effort: S
component: cross-cutting
status: completed
related: [XC-082, XC-109, XC-121]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-09
updated: 2026-11-12
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

- [x] On a warm cache, the desktop job makes no request to `github.com`
      release downloads. Check this by grepping the job log for
      `releases/download` and for Electron's download line.
- [x] Bumping `electron`, `UV_VERSION` or `PYTHON_VERSION` misses the cache and
      still passes.
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Found during the test-pyramid rollout, 2026-11-09. A subagent's check
  confirmed the CDN itself was fine; the 504s came from github.com's redirect.

**Implementation (2026-11-12):**

- `.github/workflows/tests.yml` (`Desktop macOS checks`): a `Pinned download
  versions` step reads the installed `electron` version and `UV_VERSION` /
  `PYTHON_VERSION` from `wheelhouse.sh`. An `electron-<version>` cache of
  `~/Library/Caches/electron` is restored after `npm ci`, and an `Unpack
  Electron` step runs `node_modules/electron/install.js` before the unit tier,
  saying whether the zip came from the cache or names the `releases/download`
  URL it fetches. A `wheelhouse-uv<UV>-py<PY>` cache holds `packaging/out/uv`
  and `UV_PYTHON_INSTALL_DIR`; on a hit `npm run package` runs with
  `UV_PYTHON_DOWNLOADS=never`. Both keep XC-082's rules (no `restore-keys`,
  saved only by a green job).
- `forge.config.js` passes `download.checksums` from `electron/checksums.json`.
  Without it, `@electron/packager`'s `@electron/get` fetches
  `SHASUMS256.txt` from GitHub releases on every package, even on a cache hit
  (it bypasses the cache for checksums). Pinned by
  `test/unit/packaging.test.cjs`.
- `wheelhouse.sh` prints the uv release URL before its silent `curl`, so a log
  shows whether `out/uv` came from the cache.
- Pointing `ELECTRON_MIRROR` at a closed port on a hit, to make a stray request
  fail the job, doesn't work: `@electron/get` keys its cache on the download
  URL, so a different mirror misses the cache.
- Not covered: `npm ci` still clones the `electron/node-gyp` git dependency
  from github.com, and `setup-uv` fetches uv from releases.astral.sh. Neither
  is a GitHub release download.
- Grepping a log for `releases/download` also matches setup-uv's own line
  ("Downloading uv from https://releases.astral.sh/github/uv/releases/download/..."),
  which is Astral's mirror, not github.com. Grep for
  `github.com/.*releases/download` instead.
