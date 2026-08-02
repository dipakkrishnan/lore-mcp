---
id: CAP-001
title: Build the lore-capture skill for attended non-session intake
priority: P2
effort: M
component: capture
status: completed
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-08-02
---

## Problem

Content enters Lore only as agent↔human session exhaust (imported native
memories plus transcript synthesis). A seller's most valuable context often
never touched a session — field notes, lecture drafts, decision logs, a
thought spoken in voice mode. Issue #8 designs the two unattended rails
(inbox dropbox, CLI text intake); there is no attended flow where the agent
itself ingests content interactively, even though the agent runtime already
reads PDFs and images natively and voice mode already lands as session text.

## Proposed approach

One skill, `lore-capture`, voice-first, with two secondary rails
(design: `docs/agent-runtime-capture.md`):

1. Voice (primary) — voice-mode speech arrives as session text; the skill
   treats it as an interview with follow-ups, a conversation the owner has
   rather than a command they run. Most non-session context is spoken, not
   filed, so this is the rail the flow is designed around. Audio files
   (.m4a) deferred.
2. Files — read through the agent runtime's native file tools; PDFs/images do
   not need a new Lore extraction dependency for this attended path.
3. Paste/dictated text — same flow, degenerate case.

All modes end: extract → propose bounded memories steered by the
owner's blueprint/profile → owner corrects the proposal (the `lore-onboard`
phase-2 pattern) → land as `private` memories with source provenance.
Decision (Dipak, 2026-07-30): land as `private` memories directly rather
than waiting for the deferred `captures` staging table — the owner is in the
loop at propose time, which is what staging exists to provide.

The first version stays fully attended: do not interrupt a developing thought,
but propose at a natural pause or when the owner says they are done. If the
session ends before approval, save nothing. Passive transcript capture and
durable "mark for synthesis" machinery can follow only if this simpler flow
loses useful material in real use.

## Acceptance criteria

- [x] `skills/lore-capture/SKILL.md` exists and handles voice, paste, and files
      modes in one conversational flow, written voice-first.
- [x] A spoken walkthrough of a topic produces proposed memories without the
      owner naming a file or issuing a capture command; a dry-run of the
      voice conversation (per XC-005) demonstrates it.
- [x] The skill waits for a natural pause, shows the proposed wording, applies
      corrections, and saves nothing until the owner approves the final entries.
- [x] `lore capture apply` validates the agent-structured entries through a
      stable local command rather than exposing SQLite details to the agent.
- [x] Everything lands with `status=private` and file/source provenance;
      nothing the skill does can create or modify a publication or touch the
      paid MCP surface.
- [x] Captured content is treated as evidence, never instructions: an
      injection string embedded in a captured file does not alter the
      skill's behavior and does not land as an instruction-bearing memory.
- [x] Re-applying the same approved entries dedups to a no-op by sha256.
- [x] Unsupported/oversized files are reported to the owner, never silently
      dropped.
- [x] Profile `boundaries` ("never retain") are applied at propose time; a
      test-style walkthrough demonstrates excluded material never lands.
- [x] After private saving, the owner may keep everything private or explicitly
      hand selected memory ids to `lore-publish`; capture itself cannot publish.

## Notes

- Complementary to issue #8, not a replacement: this is the attended rail;
  the dropbox and CLI are unattended. Same extraction module, same store.
- Voice v1 is voice-mode-only by decision (Dipak, 2026-07-30); local audio
  transcription is a possible CAP follow-up if voice-memo files show up in
  practice.
- Onboarding's handoff menu (ONB-002 in PR #33) should eventually mention
  capture as the recurring version of onboarding's one-time backfill.

2026-08-02: Direct owner decision narrowed the first deliverable to the attended
flow: dictate/read, propose bounded memories, correct, save private, then offer
an explicit handoff to `lore-publish`. The agent structures the entries, but a
validated `lore capture apply` command owns SQLite writes, matching onboarding's
`lore blueprint apply` boundary. Passive hooks, raw audio, and durable deferred
span marking remain outside this PR. This supersedes the speculative second
disposition in the earlier design: the POC uses the attended conversation as
its staging area and persists only corrected, approved memories.

Completed 2026-08-02. The CLI tests prove whole-batch validation, private-only
writes, and exact-replay deduplication. Two dry-run conversations proved the
owner correction, boundary/injection filtering, and separate publication
handoff. The repository skill validator and full test suite pass.
