---
id: XC-023
title: Detect when the installed lore CLI has drifted from the checked-out source
priority: P2
effort: S
component: cross-cutting
status: ready
related: [MON-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-10
updated: 2026-08-26
---

## Problem

`lore node deploy` materializes `~/.lore/node` from whatever `lore` package is
actually installed (`uv tool install`), not from a git checkout. A developer
iterating on `lore/node/src/` in a working copy of this repo can edit
`network.ts` (or any packaged source), run `lore node deploy`, and have it
silently redeploy the *old* installed version — no error, a clean "Live and
smoke-checked" message, and a Worker that behaves exactly as it did before the
edit. In one real case this cost significant time: a mainnet network guard
added to the repo had zero effect after `lore node deploy` because the
globally installed CLI was 5 days stale, and every signal (`materialize()`
staging succeeded, `npm install` succeeded, the deploy's own smoke check
passed) looked correct. Only a `diff` between the repo file and the staged
`~/.lore/node` file surfaced the mismatch.

## Proposed approach

Unclear in detail. One shape: `lore node deploy` (or `lore status`) detects it
is running from a `uv tool`-installed copy and, when a git checkout of the
same project is importable/discoverable nearby, compares installed-package
version/mtime against the checkout and warns if they disagree. Another shape:
a `lore dev` mode or documented reinstall-before-deploy step for anyone
working on `lore/node/src/` directly, so the gap is closed by workflow
instead of detection. Whichever shape, the goal is that editing packaged
source and deploying without reinstalling produces a visible warning, not
silent staleness.

## Acceptance criteria

- [ ] Deploying with an installed CLI that is out of sync with a nearby git
      checkout of the same source produces a visible warning, not a silent
      no-op deploy
- [ ] The fix (or documented workflow) is discoverable by a contributor
      hitting this the first time, without needing to diff staged output
      against the repo by hand

## Notes

Surfaced 2026-08-10 while walking an owner through mainnet cutover for their
personal node: `uv tool install`ed 2026-08-02, repo's `network.ts` guard added
2026-08-05, `lore node deploy` run repeatedly on 2026-08-06/07 kept deploying
the pre-guard code until `uv tool install --force --reinstall <repo>` was run
explicitly. Distinct from `MON-006`, which is about deploy mechanics living in
the CLI at all — this is about the CLI's own installed-vs-source freshness
once those mechanics exist.

**2026-08-26 (audit):** renumbered from `XC-016` to `XC-023` — three unrelated
items had accumulated that id (this one filed 2026-08-10, "let a buyer reach a
seller" (now `XC-022`) filed 2026-08-06, "seed the worker smoke test" filed
2026-08-04 and merged first via #86). The seed-worker-smoke-test item keeps
`XC-016` as the first to actually claim it.

**Prioritization pass 2026-08-26:** the approach's two shapes (detect-and-warn
vs. close-by-workflow with a `lore dev` mode/documented reinstall step) were
open. The item's own closing sentence already picks one — "the goal is that
editing packaged source and deploying without reinstalling produces a visible
warning, not silent staleness" — so detect-and-warn is the required shape;
treat the `lore dev`/reinstall-workflow idea as an optional complement, not a
substitute, since only detection satisfies the acceptance criteria as
written. Promoted `in-review` → `ready`.
