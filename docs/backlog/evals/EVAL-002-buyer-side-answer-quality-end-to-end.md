---
id: EVAL-002
title: Evaluate answer quality from the buyer's side of the MCP surface
priority: P1
effort: M
component: evals
status: in-progress
related: [EVAL-001, MCP-001, MON-008]
blockers: [XC-002, MON-003]
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-08-17
---

## Problem

EVAL-001 evaluates the owner's pipeline: does synthesis produce good memories
and safe answers from real Lore machinery. Nothing evaluates the transaction
the product actually sells: a buyer's agent, knowing nothing about the owner,
calls `discover` with its own vocabulary, decides whether to pay, calls
`answer`, and either got its money's worth or did not. The failure modes are
buyer-side and invisible to EVAL-001 — a relevant publication missed because
the buyer's words don't match the owner's (the FTS vocabulary gap MCP-001
names), a `discover` that says `can_help` when it can't (a paid empty answer),
or an answer whose content is right but useless to an agent that lacks the
owner's context. Once real money settles per answer, every one of these is a
buyer paying for nothing — the exact hole the payment work kept closing at the
protocol layer, still open at the content layer.

## Proposed approach

Extend EVAL-001's harness one hop outward: per case, stand up the real MCP
surface over a seeded publications set, drive it with a buyer agent that only
sees the public surface (no owner context, questions phrased in the buyer's
own words), and judge whether discover's verdict was honest and the answer was
worth the advertised price. Score discover honesty (would a buyer who paid
after this `can_help` feel cheated?) separately from answer quality. Post
MON-003, point the same harness at a deployed Worker so the edge path — D1
reads, revocation propagation — is what gets judged, not a local
approximation.

## Acceptance criteria

- [x] An eval case fails when `discover` reports it can help and the
      subsequent `answer` returns nothing relevant to the query.
- [x] Cases include buyer phrasings that deliberately do not reuse the
      owner's publication vocabulary.
- [ ] The harness drives the real MCP surface (and, once MON-003 lands, a
      deployed Worker), not a roleplay of it.

## Notes

From the PR #42 discussion: after the rail is proven, "buyer agent getting
good answers" is the last unverified link in the seller-first chain. Related
to MCP-001 (browsing is one proposed fix for the vocabulary gap this eval
would measure — this item provides the measurement either way).

**Prioritization pass 2026-08-03:** both blockers (`XC-002`, `MON-003`) are
`completed`. Promoted `in-review` → `ready` at `P1` — this is the last
unverified link in the seller-first chain per the note above, criteria are
concrete, and `MCP-003` (the paid proxy tier) lists this item as one of its
own blockers, so it's on the critical path for more than itself.

**Rescope 2026-08-17:** this item predates the shipped tool surface — it was
written for `discover` + `answer`, but the deployed node serves `discover` +
`get` (fetch by id), and `answer` is now the redesigned agentic tier in
`MCP-003` / `docs/answer-tier.md`. Split the work into two phases so the
harness lands against what exists:

- **Phase 1 (unblocked now, this item's core):** judge the shipped
  `discover` → `get` path. Buyer-phrased questions that deliberately don't
  reuse owner vocabulary; score teaser honesty ("would a buyer who paid for
  this id after reading its teaser feel cheated?") and whether the fetched
  publication actually serves the question. Drive the real MCP surface and a
  deployed Worker, not a roleplay.
- **Phase 2 (lands with `MCP-003`):** extend the same harness to the answer
  tier's contract — answer quality (owner-voiced and grounded vs.
  generic-model-with-citations), refusal honesty for uncovered questions, and
  citation validity. This phase is the ship gate `MCP-003` names.

The original acceptance criteria read "answer" — for phase 1, read them
against `get`; phase-2 criteria live in `MCP-003` and `docs/answer-tier.md`
§9.

**Implementation pass 2026-08-17:** added `evals/buyer.py` + `evals/buyer_task.json`,
extending `EVAL-001`'s harness one hop outward per the proposed approach.
Deliberately does not call `synthesize()`/`codex exec` the way
`integration.py`'s owner-side path does — `evals/buyer.py`'s `seed()` writes
fixture publications directly via `Store.add_publication` (the same call the
CLI makes after owner approval, and the pattern `tests/test_mcp.py`'s
`_publish` helper already uses), so the harness only needs a Claude-family
executor. Candidate and judge both default to Claude-family models
(`claude-sonnet-5` / `claude-opus-5`) for that reason.

Three cases, all run live against the real `claude` CLI and the real
`lore.mcp.call_tool` path (not mocked) — full JSON output in the PR:

- `relevant-match` — sanity baseline. `M-001` verdicts `pass`.
- `vocabulary-gap` — buyer query phrased with none of the publication's own
  teaser/topic words ("plugin", "account access", "bail" vs. "permission
  model", "OAuth", "pilot", "abandoned"). `V-001` verdicts `pass`: the buyer
  still finds and fetches the right publication. Satisfies criterion 2.
- `misleading-teaser` — one fixture publication whose teaser promises a
  specific fact ("the exact monthly rate") its content never states.
  `T-001` is authored with `expected_verdict: fail` and verdicts `fail` live
  — the harness catches a `discover` that oversells its content. Satisfies
  criterion 1. (`buyer.py`'s report gates pass/fail on matching each
  criterion's `expected_verdict`, defaulting to `pass`, specifically so this
  case's designed-in fail doesn't read as a regression.)

Criterion 3's base clause (drives the real MCP surface, not a roleplay) is
done — every case above calls `lore.mcp.call_tool` directly, no mock. Its
parenthetical (a deployed Worker, now that `MON-003` has landed) is **not**
done and left unchecked rather than silently dropped: the only currently
deployed node is the owner's real production one
(`lore.dipakrkrishnan.workers.dev/mcp`, per `MON-006`'s PR #81), and this
harness cannot safely seed throwaway fixture publications into it without
polluting a live catalog. Pointing at a deployed Worker needs `MON-008`
(stand up a standing QA deployment) to land first — that item is `ready` but
blocked on infra this session doesn't have (Cloudflare account, funded
wallet, a protected GitHub Environment). Added `MON-008` to `related` for
that reason. Left `status: in-progress` rather than `completed` because of
this open box, per `implementation.md`'s "does not mark an item completed
with unchecked acceptance criteria." Re-promote to `completed` once someone
points `evals/buyer.py --model ... ` at a deployed QA Worker (a `--endpoint`
flag and an HTTP-based `call_tool` wrapper is the only code change likely
needed — `evals/buyer.py`'s `discover`/`fetch` functions are the only two
functions that would need an HTTP variant).

**Review-response pass 2026-08-17:** addressed PR #103 round-1 review.
`misleading-teaser`'s `T-001` previously gated `as_expected` on the judge's
verdict alone, so a buyer that never selected the misleading publication (a
`buyer_select` miss, an unrelated bug) would score identically to a buyer that
selected it and got the misleading content back — both hit the
`fetch([])`/"(nothing fetched)" or actual-content path and could plausibly
judge `fail` either way. `seed()` now returns a title -> public_id map, and
criteria can declare `requires_selected_title` to assert the buyer actually
selected that specific fixture before trusting the verdict; `buyer_task.json`'s
`T-001` uses it. Also aligned with `integration.py`'s `PRISTINE_ENV` pattern —
`buyer.py`'s two `run_model` calls now pass a pre-mutation environment
snapshot, so a future step that also sets `CLAUDE_HOME`/`CODEX_HOME` (today
only `LORE_HOME` is touched) won't leak the throwaway home into the agent
CLI's auth/config.

Re-ran all three cases live (`uv run python3 evals/buyer.py`, `claude-sonnet-5`
buyer / `claude-opus-5` judge) after both fixes: `relevant-match` M-001 pass,
`vocabulary-gap` V-001 pass, `misleading-teaser` T-001 fail (expected fail),
`all_pass: true`. `misleading-teaser`'s `selected_ids` in that run
(`["e106be27da80405c4fda4d9f"]`) is non-empty and matches the seeded
publication, confirming the new gate is exercised for real rather than
trivially satisfied. Full JSON output attached as a PR comment. Did not act on
the review's two "minor, non-blocking" notes beyond the `PRISTINE_ENV`
alignment above — the vocabulary-gap query's partial term overlap ("access",
"setup") is a narrative-strength observation about the fixture, not a defect,
and reworking it risked changing what the case actually exercises without a
concrete failure mode to fix.

**Reconciled with the rescope above:** this implementation already targets the
rescoped surface — `evals/buyer.py` calls `discover` and `get`, never
`answer`, so all three cases satisfy Phase 1 as written. Phase 1's "against a
deployed Worker" clause remains the same open box the implementation-pass note
above already tracks under `MON-008`; Phase 2 (the `MCP-003` answer-tier
contract) is unstarted.
