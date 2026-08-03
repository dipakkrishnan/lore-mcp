---
id: EVAL-003
title: Run the bench without requiring both agent CLIs installed
priority: P2
effort: M
component: evals
status: in-review
related: [EVAL-001, EVAL-002]
blockers: []
dependencies: ["windup (separate repo) — `run_json` lands there, not in lore-mcp"]
github_issue: null
created: 2026-08-01
updated: 2026-08-03
---

## Problem

Running the evals today requires both the `codex` CLI and the `claude` CLI to be
installed and authenticated. `evals/run.py` dispatches on the model name —
Claude-family prefixes go to `_run_claude` (`claude -p`), everything else to
`codex exec` — and its two defaults straddle that split: `DEFAULT_MODEL =
"gpt-5.6-sol"` needs codex, `DEFAULT_JUDGE_MODEL = "claude-opus-5"` needs claude.
A contributor with one of the two cannot run the bench with default arguments.

`evals/integration.py` is worse: its `synthesize()` hardcodes `codex exec` at
line 90 with no Claude branch at all, so the full-pipeline eval — the one that
runs the real synthesis prompt and the real MCP surface — is codex-only, full
stop.

When a CLI is missing, `subprocess.run` raises an uncaught `FileNotFoundError`
and the contributor gets a bare traceback rather than "codex is not installed".
`windup/tasks.py` already does the `shutil.which("claude")` preflight that would
have said so; `evals/` does not use it.

The two executor paths are also not equivalent, which makes results depend on
which one ran. The codex path passes `--output-schema` and gets structured
output enforced by the runtime. `_run_claude` has no schema at all — it asks for
JSON in the prompt, then strips markdown fences off the reply
(`text.strip("`").removeprefix("json")`) and hopes. A model that wraps or
prefixes its answer fails as a `JSONDecodeError` on the Claude path where codex
would have enforced the shape.

## Proposed approach

`EVAL-001`'s notes already specify the direction: promote the CLI-invocation
helpers out of `evals/` into windup as a one-shot `run_json(prompt, agent,
model, schema)`, because windup's `_agent_command` already owns per-agent CLI
knowledge and does the preflight.

Four copies of that knowledge exist today — `run.py`'s `_run_claude`, `run.py`'s
inline `codex exec` block, `integration.py`'s inline `codex exec` block, and
windup's `_agent_command`. (EVAL-001's note counted three; `integration.py`
landed after it was written.)

1. **`run_json` in windup**, taking the agent, model, prompt, and schema, and
   returning parsed JSON — with schema enforcement on both paths, not just
   codex. On the Claude path that means either a structured-output flag or, if
   none exists, validating the parsed result against the schema and retrying
   once, so the two executors fail the same way.
2. **Preflight and a resolution ladder.** Before running anything, check which
   agent CLIs exist. If the requested one is missing, say so by name. If neither
   is available, fail with instructions rather than a traceback. Decide whether
   a missing judge CLI falls back to the other lab automatically or refuses —
   the judge is deliberately a different lab than the candidate, and a silent
   fallback would quietly turn a run into the candidate grading its own
   homework.
3. **Give `integration.py` the same dispatch as `run.py`**, so the full-pipeline
   eval is runnable on either agent.

## Acceptance criteria

- [ ] Both `evals/run.py` and `evals/integration.py` run end to end with only
      one agent CLI installed, given matching `--model`/`--judge-model`
- [ ] A missing CLI produces a message naming the missing binary and how to get
      it, never an uncaught `FileNotFoundError`
- [ ] The Claude and codex paths enforce the same output schema, and a reply
      wrapped in a markdown fence succeeds on both rather than only on codex
- [ ] The candidate and judge cannot silently end up on the same lab — either
      the ladder refuses, or it warns and records the substitution in the run
      output
- [ ] Exactly one copy of the per-agent CLI invocation remains reachable from
      `evals/`, and it lives in windup

## Notes

Filed 2026-08-01 from a prioritization-pass finding, against the follow-up
`EVAL-001`'s notes deferred: "Executor portability (candidate/judge on Claude
Code for users without Codex, judge resolution ladder) is deliberately out of
scope here; note it for a follow-up item when a second executor is actually
needed."

Filed at `P2` rather than `P3` because the trigger has arrived. This is not
hypothetical portability work: `integration.py` is codex-only today, so a
contributor on Claude Code cannot run the full-pipeline eval at all.

Most of the work lands in windup, a separate repository, which is why it is a
`dependency` rather than a blocker — the lore-mcp side is small once `run_json`
exists. If the windup change turns out to be unwelcome or slow, the fallback is
a single shared helper inside `evals/` and one copy fewer instead of three; say
so here if that is what happens.
