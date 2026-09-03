---
id: APP-044
title: Reuse Electron's Node runtime for desktop deploys
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-005, APP-036]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-01
updated: 2026-09-01
---

## Problem

The macOS app ships a 116 MB standalone Node executable even though Electron
already embeds a compatible Node runtime. Lore only needs that second runtime
to execute npm and Wrangler during Cloudflare deployment, adding about 39 MB
to the download and 116 MB after installation.

## Proposed approach

Keep the small bundled npm payload, but replace the standalone Node executable
with a shim that runs the signed Lore executable under
`ELECTRON_RUN_AS_NODE=1`. Preserve the current PATH and sandbox behavior so a
fresh Mac still needs no terminal or separately installed Node. Deliver this
as one focused PR.

## Acceptance criteria

- [x] The packaged app no longer contains the standalone Node executable.
- [x] The packaged app can run its bundled npm and Wrangler through Electron's
      embedded Node runtime.
- [ ] A fresh-account Desktop deployment completes without relying on Node or
      npm from the owner's PATH.
- [x] Package checks cover the shim.
- [ ] The rebuilt release artifact passes signature, stapling, and Gatekeeper
      validation.

## Notes

Verified against the current notarized build: Electron runs as Node v24.18.1
and successfully executes the bundled npm v11.19.0. The separately bundled
Node is v24.20.0; no other packaged runtime caller was found.

Implemented: bin/node is a shell shim that execs Contents/MacOS/Lore (dev:
node_modules/electron/dist) under ELECTRON_RUN_AS_NODE=1, plus a NODE_OPTIONS
preload setting process.defaultApp — without it yargs (wrangler's parser) sees
process.versions.electron and misreads argv, so wrangler aborts on its own
cli.js path. Local verification on the unsigned rebuild: shim prints v24.18.1,
npm 11.19.0 and wrangler 4.127.1 run through it, app 704 MB -> 585 MB
(node 129 MB -> 14 MB), zip 362 MiB -> 289 MiB, 12,510 files.
