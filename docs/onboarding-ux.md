# Onboarding UX

Design notes for [issue #7](https://github.com/dipakkrishnan/lore-mcp/issues/7).

## The problem is the leverage, not the terminal

The issue frames this as a polish problem: the coding-agent onboarding questions feel
static and should be AI-guided. That's true, but a friendlier prompt widget wouldn't fix
what's actually wrong.

`configure_automation` (`lore/cli.py:258-307`) asks six free-text questions cold, in a
terminal, with no examples and no indication of what a good answer looks like:

- "What kind of work do you do?"
- "Which projects or domains matter most right now?"
- "What experience might be unusually valuable to others?"
- "Which working preferences should every agent learn?"
- "What should Lore never retain?"
- cadence / hour / per-agent model

Those answers are string-interpolated verbatim into `automation.build_prompt()`
(`lore/automation.py:44-94`) — the literal prompt a native scheduled task runs daily or
weekly, indefinitely, deciding what personal context to write about the owner. `setup()`
calls `save_profile` and then `run_setup` (`lore/automation.py:160-181`) immediately after
the answers are collected; the owner never sees the resulting prompt before it goes live.

So the real failure isn't the interface, it's leverage without a checkpoint: five terse
sentences, answered once, blind, become the entire steering signal for an unattended job
that runs forever. Three compounding gaps make this worse:

- **No middle ground.** `--yes` skips the whole thing with blank fields; interactive mode
  demands all six answers plus per-agent confirms in one uninterruptible pass.
- **No lifecycle.** There is no `lore automation` command. The profile only exists inside
  the first-run `setup` path (`lore/cli.py:17-45` has no subparser for it); revisiting it
  means re-running the whole import flow.
- **It's circular.** Lore's premise is extracting durable context about the owner from
  agent activity, yet configuring the job that does that extraction requires the owner to
  hand-type a cold mini-bio — when the agents Lore already shells out to
  (`automation.run_setup`) could plausibly draft or gather that context themselves.

One terminology note worth resolving separately: the issue describes the automation as
analyzing "your sessions," but `build_prompt` says "use your native memory and recent
context" and the README commits to never reading conversation transcripts on import. Worth
confirming this is loose phrasing rather than a real ambiguity about what the scheduled job
is allowed to look at.

## Two axes, not three separate features

The instinct is to design three onboarding modes (interview / AI-drafted / manual). But
manual and AI-drafted are the same interaction — a sequence of `ask(prompt, default)`
calls — differing only in whether `default` starts blank or pre-filled. The real fork is
one axis:

- **Who drives the conversation** — Lore's own `ask()` loop, or a foreground handoff to
  the installed agent.
- **Where each answer starts** — blank, or drafted from context — which only applies when
  Lore is driving.

That collapses to three selectable modes sharing one mechanism and one landing path.

## Shared fix: preview before install

Regardless of mode, `configure_automation` should stop going straight from answers to a
live scheduled task. Insert a checkpoint between `save_profile` and `run_setup`: render
`build_prompt()` for each selected agent and require confirmation before installing the
native schedule. This is the single highest-leverage fix — it applies to all three modes,
requires no new concepts, and closes the gap where the owner never sees the prompt that
runs unsupervised, indefinitely.

## The three modes

**1. Manual (today's flow, improved).** Same `ask()` calls, blank defaults, but each
paired with a short example so the owner understands what a useful answer looks like
before committing to it.

**2. AI-drafted.** One headless call to the installed agent —
`automation.draft_profile(agent, memories)` — using memories already imported into Lore's
own store as context, **excluding `pending`-status memories by default** since those
haven't been owner-reviewed yet. An explicit flag (e.g. `--include-pending`) opts back in
for owners who want a richer draft on a fresh install where little has been reviewed yet.
`draft_profile` returns a dict shaped like `profile`; each field becomes the `default=` for
the corresponding `ask()` call, so accepting a draft is literally pressing enter — no new
interaction pattern, just reusing today's `ask(prompt, default)` signature. This reuses the
exact subprocess pattern `run_setup` already uses for headless agent calls
(`automation.setup_command`, `lore/automation.py:129-157`).

**3. AI-interview.** A foreground (non-headless) handoff to the installed agent: it reads
imported memories, interviews the owner conversationally in the same terminal, and hands
the result back through a new `lore automation apply <file>` command rather than writing
`~/.lore/automation/profile.json` directly. Routing through `apply` — rather than letting
the agent write the profile file itself — mirrors the reasoning already used for the
captures table in issue #6's design: make the unsafe thing impossible to express, rather
than trusting every future writer to get it right. `apply` validates and normalizes before
calling `save_profile`, and is the single path all three modes converge on.

## Shared plumbing

- `automation.draft_profile(agent, memories, include_pending=False) -> dict | None` — one
  headless call, used internally by mode 2 and optionally by mode 3 for context-gathering.
  Falls back to blank defaults on failure (timeout, agent not installed, refusal); never
  blocks onboarding on an optional enhancement.
- `automation.profile_prompt_preview(profile)` — renders `build_prompt()` output for
  confirmation, used by all three modes.
- `lore automation` command family: `show` (print current profile + generated prompts),
  `edit` (re-run the mode menu without full `setup`), `apply <file>` (validate + save,
  used internally by mode 3, usable directly).

## Sequence

1. Add the preview-before-install checkpoint to today's static flow. Small, immediately
   useful, no new concepts — fixes the "prompt goes live unseen" gap for every mode.
2. Add `lore automation show/edit/apply`, giving the profile a lifecycle independent of
   first-run `setup`.
3. Add mode 2 (`draft_profile` feeding `ask()` defaults, pending excluded by default).
4. Add the mode-choice menu to `configure_automation`.
5. Add mode 3 (foreground interactive handoff, landing via `apply`).

Steps 1 and 2 are independently useful and don't commit to the rest.

## Open questions

- Codex parity is unresolved. Mode 3 needs a foreground, conversational handoff; whether
  `codex` supports that the way `claude` does hasn't been checked. Interview mode may need
  to launch Claude-only at first, same as the open Codex question already flagged in
  issue #6's design notes.
- Should `draft_profile`, when `include_pending` is set, weight pending memories any
  differently than reviewed ones, or treat them identically as context?
- Should the chosen mode be remembered so `lore automation edit` defaults to whichever mode
  was used last, or should it always re-prompt?
- What signal, if any, should `draft_profile` use beyond the memory store itself (e.g. repo
  or git context) — or should it stay scoped to Lore's own library to keep the "local
  first, no reads beyond what's already imported with consent" property intact?
