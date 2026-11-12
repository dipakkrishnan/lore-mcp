---
id: MON-058
title: Stop a failed `d1 list` from crashing the deploy or hiding why it stopped
priority: P2
effort: S
component: monetization
status: ready
related: [XC-085, XC-069, XC-086]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-11
updated: 2026-11-11
---

## Problem

`d1 create` can say the store's database already exists without printing its id. In that case
`_ensure_d1` (lore/deploy.py:676-685) falls back to `wrangler d1 list --json`, but it ignores that
command's exit code and the shape of what it prints. Reproduced on main with a stubbed `_run`:

- If the listing exits 1 and prints a JSON object (e.g. `{"error": {...}}`), the code iterates the object's
  string keys and raises `AttributeError: 'str' object has no attribute 'get'`. JSON `null` would raise
  `TypeError`. `_recorded_deploy` catches only `OSError`/`ValueError` (deploy.py:1051), and so does the CLI
  (cli.py:903). So nothing reaches the store log, no `store.failed` usage event is recorded, and the owner
  sees a traceback.
- If the listing exits 1 with no output, the deploy stops with "could not determine the lore-publications
  database id; run `npx wrangler d1 list` … and paste it into wrangler.jsonc" (deploy.py:686-689), reason
  `other`. The real refusal (sign-in, network) is hidden behind a manual step that will fail the same way.

The listing also runs before the `exists_elsewhere` guard (deploy.py:690-706). So a fresh installation
(no `node_url`) on an account that already has the database has to get through the listing before it hears
the #257 refusal, and a listing failure replaces that refusal.

## Proposed approach

Decide `exists_elsewhere` first. When "already exists" and no `node_url` is recorded (and
`LORE_ADOPT_EXISTING_D1` is unset), refuse without listing. Then run the listing with `fail=`, so its own
refusal goes through `StoreFailed.of`. Accept only a JSON list of objects; anything else raises an `OSError`
that names the listing.

## Acceptance criteria

- [ ] A listing that exits non-zero, with a JSON error object or with no output, raises `OSError`/`StoreFailed`
      carrying wrangler's refusal, never `AttributeError`/`TypeError`. The store log gets an entry and
      `store.failed` is recorded.
- [ ] A listing that exits 0 with something other than a list of objects raises an `OSError` naming the
      listing.
- [ ] A fresh installation (no `node_url`) whose `d1 create` says "already exists" refuses with
      `exists_elsewhere`, whatever the listing would have done (test: the listing fails, or is never run).
- [ ] A listing that names `lore-publications` on an installation that has deployed before still adopts its
      id (existing behaviour, still tested).

## Notes

Found 2026-11-11 by the lore-worker while reading `lore/deploy.py` after TEST-deploy (#697). I haven't
checked whether real wrangler prints a JSON error object on stdout when `d1 list --json` fails. The
precedent is `d1 execute --json`, whose refusal `_detail` already parses (see its docstring and the
`WRANGLER_REFUSAL` fixture in tests/test_deploy.py). Real wrangler always lists objects, so the exit-0 shape
is defensive.

While here: `_ensure_d1` writes the config with `config.write_text` (deploy.py:714), not `_replace`.
`materialize`'s docstring promises the config is only ever written with its id. A torn write on a first
deploy brings back the placeholder, and the next run then refuses `exists_elsewhere` about the owner's own
database.

**Prioritization pass 2026-11-11:** Promoted `in-review` → `ready`: no blockers, each criterion is a concrete fake-wrangler case in tests/test_deploy.py.
