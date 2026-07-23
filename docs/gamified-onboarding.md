# Gamified persona onboarding

Design notes for [issue #7](https://github.com/dipakkrishnan/lore-mcp/issues/7), extending
its "AI-interview" mode with a persona-driven interview and a new artifact for the shape of
the owner's lore.

## What this is

`docs/onboarding-ux.md` scoped three onboarding modes for `configure_automation` (manual,
AI-drafted, AI-interview) and fixed the biggest gap — the synthesis prompt going live unseen.
This doc is a fourth, **additive** mode: a gamified persona interview, run as a skill inside a
Claude or Codex session, whose goal is to get the owner to sketch the initial *shape* of their
lore and feel invested in the product from the first conversation.

It does not touch `configure_automation` (`lore/cli.py:258-307`), `profile.json`, or
`build_prompt()` (`lore/automation.py:44-94`). It ships a new artifact, a new command, and a
new skill alongside the existing flow.

## The core idea: persona as structural archetype

The interview opens with a single question — pick a persona: Storyteller, elementary
schoolteacher, college professor, business executive, or wise sage — but that choice is not a
voice skin over identical questions. **The persona is a structural archetype.** Choosing
"Professor" proposes that the owner's lore is organized by domain of knowledge, goes deep
where they have expertise, and stays survey-level elsewhere. Choosing "Storyteller" proposes a
chronological arc instead. The interview states this out loud and lets the owner keep the
default or override it, so the choice does real work rather than decorating a question.

### Persona → lore structure

| Dimension | storyteller | schoolteacher | professor | executive | sage |
|---|---|---|---|---|---|
| Metaphor | Story in chapters | Classroom curriculum | University field of study | Executive briefing | Book of distilled wisdom |
| Default axis | `chronological` | `theme` | `knowledge` | `project` | `theme` |
| Depth posture | narrative | broad | deep | prioritized | distilled |
| Section unit | chapters/arcs | subjects→units | domains→topics | initiatives/deals | themes/teachings |
| Foregrounds | evolution, turning points, people | fundamentals, basics | rationale, evidence, "why" | decisions, outcomes, tradeoffs | lessons, principles, judgment |
| Voice | first-person, anecdotal | plain, welcoming | precise, analytical | crisp, bottom-line-first | reflective, aphoristic |

This mapping lives in code as `PERSONA_PROFILES` in `lore/blueprint.py` and is the single
source of truth the CLI, the validator, and the skill all read from.

## Requirements

### Functional — the interview (skill)
- **FR1** The skill SHALL open with a single prompt capturing the user's **name** and
  **persona** from exactly: Storyteller, elementary schoolteacher, college professor,
  business executive, wise sage.
- **FR2** On persona choice, the skill SHALL present how that archetype shapes the lore
  (its axis, depth posture, and voice) and SHALL frame all later questions in that voice.
- **FR3** The skill SHALL elicit a **topic outline** (non-exhaustive list of areas).
- **FR4** The skill SHALL elicit which areas are **granular/focus** vs. **okay-to-generalize**,
  seeded by the persona's depth posture.
- **FR5** The skill SHALL present the persona's default **organizing axis** and let the user
  keep it or override it with one of: chronological, theme, project, knowledge.
- **FR6** The skill SHALL elicit **how the user tells/shares** content, seeded by persona voice.
- **FR7** The skill SHALL map every free-text answer to canonical enum values before
  assembling the blueprint JSON.
- **FR8** The skill SHALL show the user the assembled map and get confirmation **before**
  persisting.
- **FR9** The skill SHALL persist ONLY by writing a temp file and invoking
  `lore blueprint apply <file>` — never writing any `~/.lore/` artifact directly.

### Functional — the command (`lore blueprint`)
- **FR10** `lore blueprint apply <file>` SHALL read JSON, validate + normalize, and be the
  single write path for the blueprint artifact.
- **FR11** The command SHALL resolve persona-derived structure: `organizing_axis` = user
  override if provided else `PERSONA_PROFILES[persona].axis`; and SHALL inject the persona's
  `depth_default` and `section_labels` into the output.
- **FR12** Validation SHALL reject: non-object input, `version != 1`, empty `name`, empty
  `topic_outline`, unknown `persona`, an overridden `organizing_axis` not in the axis enum,
  and any unexpected top-level input field — each with a clear `lore:`-prefixed error and
  non-zero exit. Command-authored fields (`captured_at`, `depth_default`, `section_labels`)
  are NOT accepted from input.
- **FR13** Normalization SHALL trim, scrub control characters, drop empties, dedupe list
  items in order, and apply length/count caps.
- **FR14** The command SHALL stamp `captured_at` itself and SHALL NOT trust any input
  timestamp.
- **FR15** Applying again SHALL cleanly overwrite (latest wins; single artifact file).
- **FR16** `lore blueprint show` SHALL print the human-readable map if present, else the
  JSON, else a friendly "no blueprint yet" message, always returning 0.

### Non-functional / constraints
- **NFR1** The blueprint SHALL be a separate, `version`-gated, **self-contained** artifact
  (resolved axis/depth/labels written in) — NOT merged into `profile.json`.
- **NFR2** The blueprint MUST NOT be wired into `build_prompt()`/synthesis or `profile.json`
  in this PR; a test asserts `build_prompt` output references no blueprint field.
- **NFR3** Artifact files SHALL be owner-private (dir `0700`, files `0600`), mirroring
  `automation.save_profile`.
- **NFR4** `configure_automation` onboarding SHALL remain functionally unchanged (additive).
- **NFR5** Implementation SHALL use only the Python standard library.
- **NFR6** The onboarding SHALL be extensible without touching control flow (see below).

## Why a separate artifact, not `profile.json`

`profile.json` is write-only outside `lore setup` — only `build_prompt()`/`setup_prompt()`
read it, and only at setup time (`automation.py:44-126`). The blueprint answers a different
question (the *shape* of the owner's lore, not what steers the synthesis prompt) and the
owner has already said storage is likely to be redesigned soon. Keeping the blueprint separate
and version-gated means a future storage layer can read it in isolation — it doesn't need
`profile.json`, `PERSONA_PROFILES`, or any of Lore's other internals, because the resolved
`organizing_axis`, `depth_default`, and `section_labels` are written directly into the
artifact. That is also why `apply` rejects those three fields from *input*: they are the
command's output, not the skill's input, and letting the skill supply them would let stale or
spoofed structure leak into a "resolved" record.

## Extensibility (NFR6)

**New persona.** `PERSONA_PROFILES` is the single source of truth; `PERSONAS` derives from its
keys. Nothing in `normalize()`, `render_map()`, or the CLI branches on a specific persona name
— they all read `axis`/`depth_default`/`section_labels` out of the registry entry for whatever
persona was chosen. Adding a sixth archetype (e.g. `journalist`, `coach`) is:
1. one `PERSONA_PROFILES[...]` entry (axis, depth_default, section_labels);
2. one column in the skill's persona × goal question table, plus one crosswalk row;
3. nothing else. A registry-completeness test parametrized over `PERSONAS` fails loudly if a
   new entry is missing a field.

**New feature / field.** New optional fields flow through the one `normalize`/`apply` path
with an empty default — no `version` bump, existing artifacts stay valid. A genuinely breaking
change bumps `version` to `2` and adds a versioned branch in `normalize`; the hard `version`
gate (FR12) is what makes that clean rather than a silent format drift.

**One write path stays one write path.** Because `apply` is the only writer, every future
feature extends a single function instead of scattered call sites — the same property that
keeps disclosure safe (per `docs/onboarding-ux.md`'s reasoning about `apply`) keeps the schema
evolvable.

## Following the existing `apply` pattern

`docs/onboarding-ux.md` proposed `lore automation apply <file>` for its AI-interview mode
specifically so the agent never writes the private profile directly — it hands a file to a
validating command that is the sole write path. `lore blueprint apply <file>` is the same
pattern applied to the blueprint: the skill assembles JSON, writes it to a temp file, and
`apply` is the only thing that touches `~/.lore/blueprint/*`.

## What this intentionally does not do

- **No synthesis integration.** The blueprint is not read by `build_prompt()` or any
  scheduled job in this PR. The owner's stated plan to rethink storage means wiring the shape
  into synthesis now would likely need to be redone; capturing it durably and self-contained
  is the higher-leverage move today.
- **No literal folder trees.** `organizing_axis`/`depth_default` describe an intent, not a
  directory layout. Building `~/.lore/topics/<name>/` now would be a real architectural
  commitment ahead of the storage redesign.

## Open follow-ups

- **Skill distribution.** `install.sh:29` copies only `lore/` into the install dir; a
  top-level `skills/` directory does not currently reach an installed user. Options: copy
  `skills/` in the installer, ship the skill text inside the package with a
  `lore blueprint skill` emitter, or publish it as a separate plugin. Decide once the command
  has real usage.
- **Codex parity.** The skill is markdown an agent follows inside an interactive session;
  whether Codex loads and follows `SKILL.md` the way Claude does is unverified. May ship
  Claude-first, matching the open Codex question already flagged in `docs/onboarding-ux.md`.
- **Edit history.** v1 overwrites on every `apply` (latest capture only). If the storage
  redesign wants a history of how the owner's stated shape changed over time, that's a v2
  concern.
- **Storage redesign consumption.** `organizing_axis`, `depth_default`, `focus_topics` /
  `general_areas`, and `section_labels` are the stable contract intended for whatever storage
  layer comes next to build against.
