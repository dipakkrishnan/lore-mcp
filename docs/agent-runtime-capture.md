# Agent-runtime capture: getting non-session content into Lore

**Status: proposal, checking in before building.**

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

## Shape: one skill, `lore-capture`, three intake modes

One conversational flow. The user invokes it with content in hand; the skill
routes by what arrives:

1. **Files** — "capture ~/field-notes/". The agent reads stdlib-extractable
   types via `lore/extract.py` (PR #34, shared with the dropbox rail so
   file-type support is added once) and reads PDFs/images with its own native
   comprehension. Oversized or unreadable files are reported, never silently
   dropped — same contract as `extract.py`.
2. **Voice** — free today via voice mode: speech arrives as session text, and
   the skill treats "let me tell you about X" as intake, interviewing with
   follow-ups the way `lore-onboard` phase 1 does. Audio *files* (.m4a voice
   memos) are deferred until someone actually has them — transcription is the
   one genuinely missing runtime capability.
3. **Paste/dictated text** — degenerate case of the same flow; wraps the
   `lore capture` CLI from issue #8 step 3 when it lands.

All three converge on the same synthesis step: extract → propose bounded
candidate memories steered by the owner's blueprint/profile → **owner corrects
the proposal** (the `lore-onboard` phase-2 pattern: correcting beats
blank-slate authoring) → land as `private` memories with file/source
provenance via the store.

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

## Open questions for Dipak

1. Land directly as `private` memories (proposed) vs. wait for the `captures`
   staging table? Direct is buildable today and the owner is in the loop at
   propose time, which is what staging exists to provide.
2. Audio files: defer (proposed) vs. shell out to a local transcriber now?
3. Backlog placement: new `capture/` component (`CAP-` prefix) vs. filing
   under onboarding?
