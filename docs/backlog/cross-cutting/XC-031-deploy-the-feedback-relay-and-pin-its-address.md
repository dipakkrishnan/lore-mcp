---
id: XC-031
title: Deploy the feedback relay, pin its address, and verify one real submission
priority: P2
effort: S
component: cross-cutting
status: ready
related: [XC-028, APP-105, CLI-003]
blockers: []
dependencies: [XC-028]
github_issue: null
created: 2026-09-09
updated: 2026-09-09
---

## Problem

`XC-028` shipped the whole feedback path — shared core, relay Worker, both
surfaces — but deliberately shipped it **off**. `lore/feedback.py`'s
`RELAY_URL` is `None`, so `lore report-feedback` refuses before it prompts
and the Desktop app hides its button. Nothing in the feature has ever run
against the real GitHub API: the relay's tests stub GitHub, and the client's
tests stub the relay.

The remaining work needs credentials only a maintainer holds — a
fine-grained GitHub PAT scoped to this repo, and a Cloudflare account — so
it could not be part of `XC-028`. It is tracked here rather than left as a
line in that item's Notes, because until it is done the feature is dead code
in every shipped build, and because the review of `#252` made "one real
submission verified" an explicit release condition.

## Proposed approach

The runbook is `feedback-relay/README.md`; this item is the doing of it.

- Create the fine-grained GitHub PAT: `dipakkrishnan/lore-mcp` only, exactly
  one permission (**Issues → Read and write**). Never a classic token, never
  repo-wide write. Record its expiry somewhere it will be seen — a silent
  expiry turns every report into a 502, visible only in Workers Logs.
- Create the `feedback` label on the repo. Without it every issue creation
  fails with a 422 from GitHub.
- `npx wrangler secret put LORE_FEEDBACK_GITHUB_TOKEN` and
  `npx wrangler deploy`. Alternatively populate the `feedback-relay` GitHub
  Environment (`CLOUDFLARE_API_TOKEN`, `FEEDBACK_GITHUB_TOKEN`) and let
  `.github/workflows/deploy-feedback-relay.yml` do it on the next push to
  `main` — it already skips itself with a warning when those are empty.
- Put the Worker behind a custom route on a domain the project actually owns,
  not `*.workers.dev`. Whatever address is chosen is baked into every shipped
  copy of Lore forever, so it must not carry a Cloudflare account subdomain.
  `https://feedback.lore.dev/report` was the placeholder in the first draft
  and nobody has confirmed that domain is owned — decide before pinning.
- Smoke it before pinning anything:
  `LORE_FEEDBACK_URL=<deployed URL> uv run lore report-feedback`.
- Then set `RELAY_URL` in `lore/feedback.py` to that address, and update the
  `RelayUrlTest` cases in `tests/test_feedback.py` that currently assert the
  unset default.

## Acceptance criteria

- [ ] The relay is deployed with a working token and a `feedback` label
      exists on the repo.
- [ ] The Worker answers on a custom route on a domain the project owns.
- [ ] One real report, submitted from the CLI, becomes a labeled issue on
      `dipakkrishnan/lore-mcp`, and its metadata table reads correctly.
- [ ] The same, once, from the Desktop app — with the button now visible
      because `desktop-state` reports `feedback.available`.
- [ ] `RELAY_URL` is pinned to the deployed address and the Python suite
      still passes.
- [ ] The token's expiry is recorded somewhere a maintainer will see it.

## Notes

Until every box above is checked, no release should carry a Send button. The
code enforces that on its own — an unpinned `RELAY_URL` refuses — so this
item is the way to turn the feature on, not a warning label on a feature
that is already reachable.
