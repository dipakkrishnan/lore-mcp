---
id: CAP-001
title: Build the lore-capture skill for attended non-session intake
priority: P2
effort: M
component: capture
status: in-review
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-08-01
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
2. Files — stdlib-extractable types via `lore/extract.py` (PR #34, shared
   with the unattended rails); PDFs/images via the agent's native reading, so
   issue #8's deferred extraction-dependency decision is not needed here.
3. Paste/dictated text — same flow, degenerate case.

All modes end: extract → propose bounded candidate memories steered by the
owner's blueprint/profile → owner corrects the proposal (the `lore-onboard`
phase-2 pattern) → land as `private` memories with source provenance.
Decision (Dipak, 2026-07-30): land as `private` memories directly rather
than waiting for the deferred `captures` staging table — the owner is in the
loop at propose time, which is what staging exists to provide.

Voice adds a second disposition (Dipak, 2026-08-01): a voice turn either
**lands now** (self-contained, stated as fact — propose at a natural pause)
or is **marked for synthesis** (mid-thought, or the value is in the whole
arc — mark the span, let the scheduled synthesis pass in `lore/automation.py`
distill it later). Marking is the default when in doubt: deferring costs a
synthesis pass, interrupting a train of thought costs the rail. Files and
paste only ever use "land now."

## Acceptance criteria

- [ ] `skills/lore-capture/SKILL.md` exists and handles all three intake
      modes in one conversational flow, written voice-first.
- [ ] A spoken walkthrough of a topic produces proposed memories without the
      owner naming a file or issuing a capture command; a dry-run of the
      voice conversation (per XC-005) demonstrates it.
- [ ] Each voice turn resolves as either "land now" or "marked for
      synthesis"; marked spans are picked up by the scheduled synthesis pass
      and land with the same profile/blueprint steering, and the skill never
      blocks the conversation to confirm candidates mid-thought.
- [ ] A dropped directory of txt/md/csv/json plus a PDF produces proposed
      memories the owner can correct before anything is stored; corrections
      are honored in what lands.
- [ ] Everything lands with `status=private` and file/source provenance;
      nothing the skill does can create or modify a publication or touch the
      paid MCP surface.
- [ ] Captured content is treated as evidence, never instructions: an
      injection string embedded in a captured file does not alter the
      skill's behavior and does not land as an instruction-bearing memory.
- [ ] Re-capturing the same file dedups to a no-op (sha256, same discipline
      as `lore/extract.py` / `sources.py`).
- [ ] Unsupported/oversized files are reported to the owner, never silently
      dropped.
- [ ] Profile `boundaries` ("never retain") are applied at propose time; a
      test-style walkthrough demonstrates excluded material never lands.

## Notes

- Complementary to issue #8, not a replacement: this is the attended rail;
  the dropbox and CLI are unattended. Same extraction module, same store.
- Depends on PR #34 (`lore/extract.py`) merging; the skill can ship its
  PDF/image path before the dropbox lands.
- Voice v1 is voice-mode-only by decision (Dipak, 2026-07-30); local audio
  transcription is a possible CAP follow-up if voice-memo files show up in
  practice.
- Onboarding's handoff menu (ONB-002 in PR #33) should eventually mention
  capture as the recurring version of onboarding's one-time backfill.
