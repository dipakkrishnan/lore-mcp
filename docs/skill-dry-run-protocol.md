# Owner-skill dry-run protocol

`XC-005`. The skill contract tests (`tests/test_skill_contract.py`, from PR #42)
prove owner skills as *documents*: every command real, every route real, no
line able to carry a secret. They cannot prove the skills as *experiences* —
whether the entry questions read well, whether resume logic actually resumes
cleanly when a session dies mid-flow, whether Codex's plain-text fallback
stays coherent without `AskUserQuestion`, or whether an agent actually follows
a hand-off between skills instead of improvising one. This is the checklist
for catching those failures by hand, before calling a skill done.

Findings get filed against the skill as backlog items or issues — never fixed
inline during the dry-run itself, so the run stays a clean signal of the
skill's current state rather than a moving target.

## What to run

One full pass per skill, per agent path (two passes total per skill):

- **`lore-onboard`** — the persona interview (Phase 1) through the profile
  draft (Phase 2) to the hand-off offer (Phase 3, step 6).
- **`lore-enable-payments`** — start-to-finish, including the branch where
  the owner routes to `lore-publish` first (SKILL.md:77) and resumes.

## On which agents

- **Claude, structured-question path.** Whatever host control the skill
  reaches for (`AskUserQuestion` or equivalent) must actually render —
  multi-select where the skill asks for it, the owner's real projects/domains
  offered as options rather than typed, option limits respected.
- **Codex, plain-text path.** No structured question control exists here.
  Confirm the skill's plain-chat fallback stays a coherent, one-question-at-
  a-time conversation rather than reading like a form dumped into a message.

## Required within each pass

1. **A deliberate mid-flow session kill and resume.** Stop the agent after at
   least one answer has been given but before the skill finishes, start a
   fresh session, and continue. Confirm the checkpoint (`onboarding.json` for
   `lore-onboard`; the equivalent resume state for `lore-enable-payments`)
   picks up from the first thing not yet done — no re-asked question, no
   re-run finished phase.
2. **A crossed skill boundary.** Follow at least one real hand-off instead of
   stopping at the first skill's end screen:
   - `lore-onboard` → `lore-enable-payments` (the Monetize branch offered in
     Phase 3, step 6), or
   - `lore-onboard` → `lore-publish` (the publishing branch offered in the
     same step), or
   - `lore-enable-payments`'s own publish-first branch → `lore-publish` →
     back to `lore-enable-payments` to resume (SKILL.md:77).

   Confirm the receiving skill starts from what the handing-off skill already
   established (blueprint, profile, or publication state) instead of asking
   the owner to repeat themselves.

## What a finding looks like

File it against the skill (or the specific phase/step), not against this
protocol. A finding names: which pass surfaced it (agent, skill, step), what
was expected, what actually happened, and — if the resume or hand-off case
was involved — whether the checkpoint state was inspected and what it held.

## Fixtures

Where practical, keep the transcript of each pass (redacted of anything
private) as a fixture, so a later edit to the skill can be diffed against how
it previously played rather than re-establishing a baseline from memory each
time.

## What this protocol does not decide

Whether any part of this can be honestly automated is still open — an LLM
roleplaying an owner is the same trap `EVAL-001` exists to close for the
answer-quality path. Nothing here requires an automation decision before the
first manual pass: run it by hand, and treat "this should stay a manual
checklist" as an acceptable outcome of running it, not a blocker to starting.
