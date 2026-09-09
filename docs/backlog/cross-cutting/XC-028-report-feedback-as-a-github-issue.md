---
id: XC-028
title: Send owner-submitted feedback to GitHub as a shared core and relay
priority: P2
effort: L
component: cross-cutting
status: completed
related: [APP-105, CLI-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-09
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
(`feedback-relay/`); the two UI surfaces are `APP-104` and `CLI-003`.

## Proposed approach

- `lore/feedback.py`: pydantic `Report`/`ReportMetadata` models, metadata
  collection (version, OS/arch, Python version, an anonymous per-install id
  stored in the existing settings table), a local spool under
  `~/.lore/feedback/` written before the relay call, and `submit()` over
  stdlib `urllib` (matching `lore/snapshot.py`'s only HTTP pattern — no new
  runtime dependency).
- A new top-level `feedback-relay/` Cloudflare Worker (sibling of `bridge/`,
  outside `lore/` so it can never ship in the wheel) that validates the
  report, rate-limits, and calls the GitHub REST API to create the issue
  using a maintainer-held fine-grained token scoped to Issues: read/write on
  this one repo. Rate limiting is three layers, not the one "by IP" this
  item originally asked for: two Rate Limiting bindings as cheap
  pre-filters, and a Durable Object (`feedback-relay/src/quota.ts`) holding
  the only counters that actually bound issue creation across the whole
  relay. The aggregate bound is a real requirement for a Worker holding a
  credential that can write to the issue tracker, and it was undocumented
  scope on the first pass — which is how the code came to claim a guarantee
  the mechanism did not provide.
- The feature ships off. `lore/feedback.py`'s `RELAY_URL` is `None` until a
  maintainer has deployed the relay and pinned its address, and until then
  `lore report-feedback` refuses before it prompts and the Desktop app hides
  its button. Pinning the address is the only switch, so no release can ship
  a Send against an endpoint nobody configured.
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

Second review round (2026-09-09) found three defects in this item's own
scope, all reproduced, all fixed here:

- The "global" Rate Limiting binding was never a global cap: those counters
  are per Cloudflare location, so a caller spread across locations got one
  bucket per location. Replaced as the authoritative layer by the
  `FeedbackQuota` Durable Object above (60/minute, 300/hour across the
  relay, both under GitHub's secondary limits). The 429 response had no
  end-to-end test before, because the bindings fail open under the Workers
  test pool; the Durable Object is always bound, so it does now.
- `spool_path()` built a filename from `submitted_at` (one-second precision)
  and a per-install constant, so two reports sent in the same second wrote
  the same file and the second replaced the first — against `PRIVACY.md`'s
  promise that a copy of everything sent is kept. Replaced by
  `allocate_spool_path()`, which claims a name once per submission with
  `O_EXCL` and hands it to every later update of that file.
- Client and relay disagreed about what they were measuring. `json.dumps`
  defaults to `ensure_ascii=True`, inflating a valid 20,000-character CJK
  description to ~120 KB against a 64 KiB body cap; and the relay counted
  UTF-16 code units where pydantic counts code points, so emoji-heavy text
  the client accepted came back a 400. Now: UTF-8 on the wire, code points
  on both sides, `body_bytes` raised above the largest body the field caps
  can produce, and `length_unit` in the contract so the unit is asserted
  rather than assumed.
