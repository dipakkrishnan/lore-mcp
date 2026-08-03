# Agent-runtime capture: getting non-session content into Lore

**Status: shape agreed with Dipak 2026-07-30; filed as `CAP-001`.**

## Problem

Today content enters Lore only as agent↔human exhaust: imported native memories
and session transcripts that the synthesis automation distills. But a seller's
most valuable context often never touched an agent session — the bird
scientist's field notes, Karpathy's lecture drafts, a founder's decision log in
Apple Notes, a thought spoken out loud on a walk. Issue #8 covers two
non-interactive rails (inbox dropbox, CLI text intake); this proposes the
third and most capable rail: **the agent itself as the ingestion runtime.**

## Insight

The agent runtime already has the capabilities an ingestion pipeline would need
to build: it reads PDFs and images natively, voice mode already turns speech
into in-session text, and it can ask clarifying questions. Issue #8's step 5
("PDF/docx extraction needs a dependency decision") dissolves on this path —
no `pypdf`, no watchers, no daemons. The interactive path needs zero new
runtime dependencies.

## Shape: one skill, `lore-capture`, voice-first

**Voice is the primary rail, not one of three equals.** The content that never
touched a session is mostly content the owner would *say*, not type or file:
the thought on the walk, the reasoning behind a decision, the thing they'd
explain to a colleague in two minutes and never write down. Files and paste are
the secondary rails — they exist because some content already sits on disk.
Design the flow for someone talking; the other two fall out as degenerate
cases.

1. **Voice (primary)** — speech arrives as session text via voice mode. The
   skill treats "let me tell you about X" as intake and interviews with
   follow-ups the way `lore-onboard` phase 1 does: it is a conversation the
   owner *has*, not a command they run. This is also the mode where invocation
   should be near-invisible — a voice session that drifts into substantive
   context is capture, whether or not the owner said "capture this." Audio
   *files* (.m4a voice memos) are deferred until someone actually has them —
   transcription is the one genuinely missing runtime capability.
2. **Files** — "capture ~/field-notes/". The agent reads stdlib-extractable
   types via `lore/extract.py` (PR #34, shared with the dropbox rail so
   file-type support is added once) and reads PDFs/images with its own native
   comprehension. Oversized or unreadable files are reported, never silently
   dropped — same contract as `extract.py`.
3. **Paste/dictated text** — degenerate case of the same flow; wraps the
   `lore capture` CLI from issue #8 step 3 when it lands.

All three converge on the same synthesis step: extract → propose bounded
candidate memories steered by the owner's blueprint/profile → **owner corrects
the proposal** (the `lore-onboard` phase-2 pattern: correcting beats
blank-slate authoring) → land as `private` memories with file/source
provenance via the store.

## Two dispositions, because interrupting a voice conversation is the failure mode

A file capture can afford to stop and propose. A voice conversation cannot —
breaking someone's train of thought to confirm seven candidate memories is how
the rail stops being used. So a voice turn resolves one of two ways:

- **Land now** — the owner said something self-contained and stated as fact
  ("my payout wallet is self-custody, never an exchange"). Propose at a natural
  pause, owner corrects, it lands `private`.
- **Mark for synthesis** — the owner is mid-thought, exploring, or the value is
  in the whole arc rather than any one sentence. The skill marks the span and
  gets out of the way; the existing scheduled synthesis pass
  (`lore/automation.py`, same prompt and profile) distills it later with the
  full transcript in view.

Marking is the default when in doubt — deferring costs a synthesis pass,
interrupting costs the conversation. This is the one genuinely new mechanism
here; files and paste only ever use "land now."

## Boundaries (inherited, not new)

- Lands `private` memories only. Never touches publications, never the paid
  MCP surface (`lore serve`) — the same trap issue #8 and #6 already flag.
- Treats captured content as evidence, never instructions (synthesis prompt
  rule; prompt-injection resistance is a launch gate in epic #25).
- Respects the profile's "never retain" boundaries at propose time, before
  anything is stored.
- Dedup by sha256 fingerprint, same discipline as `extract.py`/`sources.py`.

## Relationship to existing work

| Piece | Relationship |
|---|---|
| Issue #8 (dropbox + text intake) | Complementary: those are the *unattended* rails, this is the *attended* one. Same extraction module, same store. |
| PR #34 `lore/extract.py` | Reused as-is for stdlib types; agent-native reading covers what it defers. |
| `captures` table (#6, deferred) | Not a dependency. The skill proposes and the owner approves in-conversation, so staging is the conversation itself; rows land as `private` memories directly. If/when `captures` exists, unattended rails feed it and this skill can too. |
| `lore-onboard` | Capture is the recurring version of onboarding's one-time backfill; onboarding's handoff menu should mention it. |

## Decisions (Dipak, 2026-07-30)

1. Land directly as `private` memories — no wait for the `captures` staging
   table; the owner is in the loop at propose time, which is what staging
   exists to provide.
2. Voice v1 is voice-mode-only; audio-file transcription deferred until
   voice-memo files show up in practice.
3. New `capture/` backlog component, `CAP-` prefix (`CAP-001` tracks the
   skill).
4. (2026-08-01) Voice is the primary rail, not one of three equals; the flow
   is designed for someone talking. Voice turns resolve as either *land now*
   or *mark for synthesis*, marking being the default when in doubt, so the
   skill never interrupts a train of thought to confirm candidates.
