---
id: EVAL-001
title: Evaluate the real Lore pipeline instead of a roleplay prompt
priority: P2
effort: L
component: evals
status: in-review
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-08-01
---

## Problem

The benchmark's candidate roleplays "Lore's synthesis and answer layer" from
a JSON blob: it never runs the shipped synthesis prompt, the `lore` CLI, the
store, or the MCP surface. A green run proves a frontier model can follow a
synthesis-flavored rubric — not that Lore's actual pipeline produces good
memories or safe answers. Shane's review of PR #27 asked exactly this: "Is
having a model pretend to be lore good enough? Could it at least run the
python scripts?"

## Proposed approach

Per case: seed a throwaway `LORE_HOME` with the case's source history as real
memories, run the candidate agent with the *generated* synthesis prompt
(`lore/automation.py:build_prompt` with a synthetic profile) and workspace
write access to that home, let it run the real `lore` commands, then read
what actually landed — synthesized topic files, and `call_tool("answer")`
output against owner-approved publications — and judge those artifacts
against the same criteria. `run.py`'s `--sandbox read-only` becomes
`workspace-write` scoped to the throwaway home.

This makes the bench a regression test for the shipped prompt (PR #37) and
the publish/answer path (XC-002), and shares its machinery with epic #25's
"automation-quality dogfood" launch gate (cold start, no-op rerun, injection
resistance) and the lore-test skill (ONB-003 in PR #33).

## Acceptance criteria

- [ ] A case run leaves inspectable artifacts in a throwaway `LORE_HOME`
      (memories in the store, topic files, publications) rather than only
      returned strings.
- [ ] The judged `answer` comes from `lore`'s real MCP `call_tool` path over
      approved publications, not from candidate prose.
- [ ] The injected-content case's assertion holds at the system level: the
      injection string never lands in the store, a publication, or an answer.
- [ ] Changing `build_prompt` can change benchmark results (demonstrated once
      by a deliberate prompt regression flipping a criterion).

## Notes

Deferred from PR #27 review (Shane, 2026-07-30) — merged with the roleplay
harness plus an independent default judge as the value-accretive first step.
Executor portability (candidate/judge on Claude Code for users without
Codex, judge resolution ladder) is deliberately out of scope here; note it
for a follow-up item when a second executor is actually needed. When that
lands, promote `run.py`'s CLI-invocation helpers (`_run_claude` and the
codex exec incantation) into windup as a one-shot `run_json(prompt, agent,
model, schema)` — windup's `_agent_command` already owns per-agent CLI
knowledge, and today three copies of it exist across run.py and windup.
Model invocation stays out of `lore/` core, which is stdlib-only by design.

Prioritization pass 2026-08-01 held this at `P2` and `in-review`, reasoning that
building against the `answer` surface now would mean rebuilding it after
`XC-002`. A closer look the same day found that reasoning obsolete: most of this
item is already built on `main`. `evals/integration.py` (commit `0b15ebf`, "Add
the full-pipeline integration eval") seeds a throwaway `LORE_HOME`, runs the
shipped prompt via `lore.automation.build_prompt`, queries the real MCP surface
via `lore.mcp.call_tool("answer")`, and carries a deterministic
`forbidden_scan` at the external boundary — criteria 1, 2, and 3.

What is not evident is criterion 4: that a deliberate `build_prompt` regression
has been demonstrated to flip a benchmark result. Verify that one, then this is
`completed` rather than `in-review`. Left for `implementation` or `audit` to
resolve, since prioritization does not move items to `completed`.
