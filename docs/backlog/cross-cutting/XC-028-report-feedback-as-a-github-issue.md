---
id: XC-028
title: Send owner-submitted feedback to GitHub as a shared core and relay
priority: P2
effort: L
component: cross-cutting
status: completed
related: [APP-097, CLI-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

Lore has no in-product way for a user to report a problem. The only feedback
loop today is a human running `docs/manual-test-walkthrough.md` and a
maintainer turning findings into GitHub issues by hand. Anyone not running a
manual test pass has no path at all.

We want a "Report Feedback" flow in both the Desktop app and the CLI that
lands a real GitHub issue on `dipakkrishnan/lore-mcp`. End users have no
GitHub credentials of their own, so a maintainer-owned relay is needed to file
the issue on their behalf. Both surfaces should share one core rather than
duplicating validation and delivery logic.

This item covers the shared core (`lore/feedback.py`) and the relay
(`feedback-relay/`); the two UI surfaces are `APP-097` and `CLI-003`.

## Proposed approach

- `lore/feedback.py`: pydantic `Report`/`ReportMetadata` models, metadata
  collection (version, OS/arch, Python version, an anonymous per-install id
  stored in the existing settings table), a local spool under
  `~/.lore/feedback/` written before the relay call, and `submit()` over
  stdlib `urllib` (matching `lore/snapshot.py`'s only HTTP pattern — no new
  runtime dependency).
- A new top-level `feedback-relay/` Cloudflare Worker (sibling of `bridge/`,
  outside `lore/` so it can never ship in the wheel) that validates the
  report, rate-limits by IP, and calls the GitHub REST API to create the
  issue using a maintainer-held fine-grained token scoped to Issues:
  read/write on this one repo.
- Field limits (title/description/email length, allowed metadata keys) live
  in `contracts/feedback_report.json`, asserted from both the Python core and
  the Worker's tests, mirroring the existing `contracts/mcp_tools.json`
  pattern.
- `PRIVACY.md` is amended in the same change: it currently claims Lore "does
  not collect telemetry or send data to a service controlled by the plugin
  author," which this feature makes untrue unless qualified. State plainly
  what is sent, when, and that the resulting issue (including the email
  address, if given) is public.
- `tests/gate.py`'s `node_gate()` is generalized to type-check/bundle/test
  every Worker directory, not just `lore/node/`.

## Acceptance criteria

- [x] `lore/feedback.py` exists with `build()`, `submit()`, and
      `report_feedback()`, fully covered per `tests/gate.py`'s 90%
      statement/branch floor. (100%/100%.)
- [x] `feedback-relay/` deploys independently of `lore node deploy` and is
      never packaged into the `lore-mcp` wheel.
- [x] A submitted report becomes a labeled GitHub issue on
      `dipakkrishnan/lore-mcp`, with a metadata table and no secrets in the
      response. Verified against a stubbed GitHub API
      (`feedback-relay/test/`); **not yet verified against the real GitHub
      API** — that needs the maintainer's one-time deploy, see Notes.
- [x] `PRIVACY.md` accurately describes what this feature sends and when.
- [x] `tests/gate.py --require-node` covers both `lore/node/` and
      `feedback-relay/`.

## Notes

Design informed by an exploration of `lore/node/` (the existing Worker
convention), `lore/snapshot.py` (the only HTTP client pattern in the Python
package), `lore/capture.py` (existing title/content length caps, reused here
for title/description), and `.github/workflows/deploy-qa.yml` (the pattern
for deploying a maintainer-owned Worker safely, never on `pull_request`).

Done 2026-09-07. Code complete and tested end-to-end (CLI and Desktop through
a stubbed local relay; the relay's own request/response shape and GitHub call
through a stubbed GitHub API). **Not done, and not this item's to do:** the
real one-time deploy — `npx wrangler secret put LORE_FEEDBACK_GITHUB_TOKEN`,
creating the `feedback` label on the repo, and pinning the deployed URL into
`lore/feedback.py`'s `RELAY_URL` — which only the maintainer can do, since it
needs a GitHub PAT scoped to `dipakkrishnan/lore-mcp`. See
`feedback-relay/README.md`. One real end-to-end submission against the live
relay is worth doing once deployed, to confirm an issue actually lands.

Found and fixed during integration testing, not scoped at ideation: argparse
refuses `--title VALUE` when `VALUE` looks like an unregistered option (e.g.
a title of literally `--json`) — `--title=VALUE` (equals-joined) is immune
to this and is what the Desktop bridge uses.
