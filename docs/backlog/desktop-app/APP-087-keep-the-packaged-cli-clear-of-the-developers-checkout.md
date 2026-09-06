---
id: APP-087
title: Keep the packaged CLI clear of the developer's checkout
priority: P2
effort: S
component: desktop-app
status: completed
related: [XC-023, APP-073, MON-019]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

During the Sep 5 store-open dogfood, the first Cloudflare sign-in failed with
"installed Lore CLI differs from this checkout; deploy stopped before using
stale code". The agent, forbidden from naming plumbing, said "Let me sort out
something on my end", tried to reinstall the CLI with `uv` (the sandbox denied
it), poked around for two minutes, and only recovered because its own retry
ran from a different directory. Two things lined up:

- The packaged app runs the CLI with whatever working directory launched it.
  Launched from a terminal inside the repo, every CLI call inherits the repo
  as its cwd, and the XC-023 drift guard (which walks up from cwd looking
  for a checkout) compares the installed wheel against it. Launched from
  Finder the cwd is `/` and the guard never fires.
- The wheel carried a ghost file. setuptools reuses `build/lib` between
  builds, so `lore/node/.buyer.env.example`, deleted from the tree by
  MON-007 in August, was still in every wheel built on this machine. The
  guard flagged the one file the checkout no longer had.

## Proposed approach

Run the packaged CLI from the Lore home, so its cwd is never a checkout, and
clear `build/` before building the wheel.

## Acceptance criteria

- [x] A packaged `lore` call spawned by the desktop runs with the Lore home as its working directory, whatever directory launched the app.
- [x] The wheel built by `packaging/wheelhouse.sh` contains only files present in the tree.

## Notes

Fixed 2026-09-05. `state.cjs` falls back to `loreHome` as the cwd when no
runtime cwd is set (the dev path keeps the repo root so `uv run` finds the
project); `wheelhouse.sh` removes `build/` before `uv build`. The sandbox's
installed CLI was current, so provisioning itself was not at fault. The
second sign-in passed only because `lore node deploy`, run by the agent from
inside the sandbox home, had materialized the node source without the guard
in between.
