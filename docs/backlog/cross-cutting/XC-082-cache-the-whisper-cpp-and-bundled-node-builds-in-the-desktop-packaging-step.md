---
id: XC-082
title: Cache the whisper.cpp and bundled-node builds in the desktop packaging step
priority: P2
effort: XS
component: cross-cutting
status: ready
related: [XC-077, APP-005]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

The last step of `Desktop macOS checks`, `npm run package`
(`.github/workflows/tests.yml:116`, `electron-forge package` per
`app/desktop/package.json:15`), takes 83 s at the median. Its `generateAssets`
hook (`app/desktop/forge.config.js:64-65`) runs `icon.sh`, `wheelhouse.sh`,
`node.sh` and `whisper.sh` in turn; in one timed CI log it ran for 72 s
(15:42:31 to 15:43:43), and 55-60 s of that was `whisper.sh` cloning whisper.cpp
at the pinned tag `WHISPER_TAG=b4938` (`app/desktop/packaging/whisper.sh:6,16`)
and building `whisper-cli` with cmake (`whisper.sh:17-19`). The wheelhouse takes
about 12 s and forge's copy and finalize about 10 s.

The whisper build produces the same binary on every run: the tag is pinned, the
cmake flags are fixed, and nothing in the PR's diff feeds into it unless the PR
edits `whisper.sh` itself. `node.sh` likewise downloads a pinned npm
(`NODE_VERSION=24.20.0`, `node.sh:7,19-21`) every run. Both scripts already know
how to do nothing: `whisper.sh:14` skips the clone and build when
`out/whisper/whisper-cli` is executable and `out/whisper/version` equals
`WHISPER_TAG`, and `whisper.sh:24` skips the model download when
`out/whisper/ggml-base.en.bin` exists; `node.sh:14-16` exits early when
`out/node/bin/node` is the expected shim for `NODE_VERSION` and the preload file is
present. In CI the `out/` directory is empty on every run (it is gitignored,
`.gitignore:12`), so the skip never fires. That is about a macOS minute per run
spent rebuilding a known artifact, on the job that is the run's critical path.

## Proposed approach

Add one `actions/cache` step before `npm run package` in `desktop-check`:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      app/desktop/packaging/out/whisper
      app/desktop/packaging/out/node
    key: packaging-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('app/desktop/packaging/whisper.sh', 'app/desktop/packaging/node.sh') }}
```

No `restore-keys`: a partial match would restore a `whisper-cli` built at another
tag, and although `whisper.sh:14` would then rebuild it correctly, the miss should
be visible, not papered over. The scripts need no change: on a hit, `whisper.sh`
and `node.sh` see their outputs in place and exit without building, which is the
path they already take on a developer's second `npm start`
(`package.json:7` runs `packaging/whisper.sh` before `electron .`). On a miss
they build as today and the post-job cache save stores the result.

The cached directories hold `whisper-cli`, `version`, the ~150 MB
`ggml-base.en.bin` model and the trimmed npm tree (`node.sh:22`): well under the
repository's 10 GB cache allowance, and only two keys live at a time (old and
new) when a script changes.

What not to cache:

- The whole forge output (`out/` or the packaged `.app`) keyed on
  `package-lock.json` plus `src/`. Most PRs touch `src/`, so it would miss on
  nearly every PR, and the slow part depends on `packaging/*.sh`, not `src/`.
- `out/wheels` and `out/uv` (`wheelhouse.sh`): the wheelhouse builds the repo's
  own `lore` wheel from the current tree (~12 s), so it must run on every PR.

Optional extras from the same investigation, each under 10 s per run, to fold in
or skip:

- `actions/setup-node@v7` at `tests.yml:57-59` has no `cache:` input, and the CI
  log shows no npm cache restore or save because `app/desktop` is not the repo
  root. `cache: npm` with `cache-dependency-path: app/desktop/package-lock.json`
  would trim a few seconds from the 14 s `npm ci`.
- Electron's binary downloads at the start of `npm test` (about 2 s); caching
  `~/Library/Caches/electron` keyed on the `electron` version in
  `package.json:29` saves about that.

## Acceptance criteria

- [ ] On a cache hit, the `npm run package` step finishes in about 25 s (was 83 s
      median), and its log shows no `git clone` of whisper.cpp and no cmake build.
- [ ] A PR that edits `app/desktop/packaging/whisper.sh` or
      `app/desktop/packaging/node.sh` misses the cache, rebuilds, and saves under
      a new key; a PR that edits only `src/` hits.
- [ ] The packaged app still carries `whisper-cli` at the pinned tag: the
      `Resources/whisper/version` file inside the built `.app` (copied from
      `out/whisper` by `forge.config.js:42-46`) reads `b4938`, on hit and on miss.
- [ ] The first run after `WHISPER_TAG` or `NODE_VERSION` changes builds from
      scratch; a stale binary from the previous tag is never shipped.

## Notes

Filed from the 2026-10-26 CI investigation (options C1 and C8); ranked 6 of 9 in
its low-effort list. The 83 s median is over the last 8 green `Desktop macOS
checks` jobs; the 55-60 s whisper figure is from one timed log's timestamps and
should be re-read from the first cache-miss run after this lands.

This is about a minute off the ~19-min job. XC-077 (walks two at a time) is the
large cut, about 8 min; together they bring a green job to about 10 min. APP-005
owns `npm run package` and the packaging scripts this item leaves unchanged.

Dropping `npm run package` from PR runs entirely was considered and set aside:
after this item it would save only about 25 s more and would lose PR-time
detection of packaging breakage (forge `ignore` rules at `forge.config.js:9-24`,
the wheelhouse). That trade is the owner's to make and is not needed for speed.
