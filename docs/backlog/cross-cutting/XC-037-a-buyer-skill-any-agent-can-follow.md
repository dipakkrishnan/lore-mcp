---
id: XC-037
title: A buyer skill any agent can follow
priority: P1
effort: S
component: cross-cutting
status: completed
related: [XC-033, XC-034]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-27
updated: 2026-09-27
---

## Problem

Every shipped skill serves the seller. A buyer's agent has the registry, the
free `discover` tool and the bridge, but nothing tells it when buying is worth
it, how to find a seller, how to stay inside a budget, or what to report after
paying. Each buyer re-derives that from the README, or does not buy.

## Proposed approach

Ship `lore-buy` next to the owner skills: plain Markdown any runtime can read.
It walks registry → shortlist → free `discover` → judge → budget → `get` →
cite and report the receipt, with payment setup per runtime (bridge for MCP
runtimes, direct `/mcp` for runtimes with an x402 wallet, a plain limit for
shell-only runtimes). No code change.

## Acceptance criteria

- [x] `plugins/lore/skills/lore-buy/SKILL.md` with `agents/openai.yaml`,
      linked into `.agents/skills` and `.claude/skills`
- [x] Skill contract tests cover it
- [x] Steps dry-run against the live registry and a live node's `discover`
- [x] README points buyers at it

## Notes

Shell-only runtimes can browse but not pay. A one-shot `call` mode on the
bridge would close that gap if a real buyer needs it.
